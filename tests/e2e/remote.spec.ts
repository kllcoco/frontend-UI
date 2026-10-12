import { test, expect, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCiro, startMockModel } from "./mock-upstream";

// Work mode end to end: a "phone" signed in to the cloud server drives a "home computer" (its own local Ciro)
// that was paired with a one-time code and only allows one project folder.
const ACCOUNT = { email: "remote@example.com", password: "a-very-secure-long-password" };
const BOOT = "remote-bootstrap-token-of-32-characters";
let mock: Server, cloud: { url: string; stop: () => void }, home: { url: string; stop: () => void }, project: string;

test.beforeAll(async () => {
  mock = await startMockModel(8887);
  cloud = await startCiro(8786, 8887, { CIRO_ACCOUNTS_ENABLED: "true", CIRO_BOOTSTRAP_TOKEN: BOOT,
    CIRO_API_KEY_PEPPER: "remote-api-key-pepper-more-than-24-bytes", CIRO_ACCOUNT_DATA_KEY: Buffer.alloc(32, 7).toString("base64") });
  home = await startCiro(8785, 8887);
  project = realpathSync(mkdtempSync(join(tmpdir(), "ciro-home-project-")));
  const boot = await fetch(cloud.url + "/api/account/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...ACCOUNT, displayName: "Me", bootstrapToken: BOOT }) });
  expect(boot.status).toBe(201);
});
test.afterAll(() => { cloud?.stop(); home?.stop(); mock?.close(); rmSync(project, { recursive: true, force: true }); });

async function openWorkMode(page: Page) {
  const menu = page.locator(".cx-mobile-menu:visible");
  if (await menu.count()) { await menu.first().click(); await page.waitForTimeout(300); }
  await page.locator(".cx-sidebar .cx-nav").getByRole("button", { name: "协作空间", exact: true }).click();
  await page.locator(".wb-nav").getByRole("button", { name: "工作模式" }).click();
  await expect(page.getByRole("heading", { name: "工作模式" })).toBeVisible();
}

test("phone pairs a home computer and runs commands and an approved AI task in its project folder", async ({ browser }) => {
  test.setTimeout(120_000);
  const phoneContext = await browser.newContext({ baseURL: cloud.url, viewport: { width: 390, height: 844 }, hasTouch: true });
  const shot = (page: Page, name: string) => process.env.SHOT_DIR ? page.screenshot({ path: process.env.SHOT_DIR + "/rw-" + name + ".png" }) : Promise.resolve();
  expect((await phoneContext.request.post("/api/account/login", { data: ACCOUNT })).ok()).toBeTruthy();
  const phone = await phoneContext.newPage();
  await phone.goto("/");
  await openWorkMode(phone);
  await expect(phone.getByText("还没有连接电脑")).toBeVisible();
  await phone.getByRole("button", { name: "添加电脑" }).click();
  const code = (await phone.locator(".rw-code strong").innerText()).trim();
  await shot(phone, "code");
  expect(code).toMatch(/^[A-Z0-9]{8}$/);
  // The phone (a remote browser of the cloud) never sees the cloud host's own "this computer" card.
  await expect(phone.locator(".rw-card--local")).toHaveCount(0);

  const pc = await (await browser.newContext()).newPage();
  await pc.goto(home.url + "/");
  await openWorkMode(pc);
  const card = pc.locator(".rw-card--local");
  await card.getByLabel("服务器地址").fill(cloud.url);
  await card.getByLabel("配对码").fill(code);
  await card.getByLabel("电脑名称").fill("家里的台式机");
  await card.getByRole("button", { name: "连接" }).click();
  await card.getByLabel("文件夹路径").fill(project);
  await card.getByRole("button", { name: "添加", exact: true }).click();
  await expect(card.locator(".rw-folder")).toContainText(project);
  await expect(card.locator(".rw-pill")).toHaveText("已连接，可被远程控制", { timeout: 20_000 });
  await shot(pc, "pc");

  // Phone: the computer shows up online with its folder.
  await phone.getByRole("button", { name: "完成" }).click();
  await expect(phone.locator(".rw-device")).toContainText("家里的台式机", { timeout: 20_000 });
  await expect(phone.locator(".rw-device")).toContainText("在线", { timeout: 20_000 });

  await shot(phone, "devices");
  // Command mode.
  await phone.getByRole("radio", { name: "命令" }).click();
  await phone.getByLabel("要执行的内容").fill("node -e \"console.log('来自家里电脑的输出', process.cwd())\"");
  await phone.getByRole("button", { name: "开始" }).click();
  await expect(phone.locator(".rw-log")).toContainText("来自家里电脑的输出", { timeout: 20_000 });
  await expect(phone.locator(".rw-log")).toContainText(project);
  await phone.getByLabel("继续输入").fill("node -e \"console.log(1 + 1)\"");
  await phone.keyboard.press("Enter");
  await expect(phone.locator(".rw-log pre").filter({ hasText: /^2\s*$/ })).toHaveCount(1, { timeout: 20_000 });
  await phone.getByRole("button", { name: "返回" }).click();

  // AI task: the write and the command each wait for approval on the phone.
  await phone.getByRole("radio", { name: "AI 任务" }).click();
  await phone.getByLabel("要执行的内容").fill("在项目里写一个问候文件");
  await phone.getByRole("button", { name: "开始" }).click();
  const approval = phone.locator(".rw-approval").filter({ has: phone.getByRole("button", { name: "批准" }) });
  await expect(approval).toContainText("请求写入文件 hello.txt", { timeout: 20_000 });
  await shot(phone, "approval");
  await approval.getByRole("button", { name: "批准" }).click();
  await expect(approval).toContainText("请求运行命令", { timeout: 20_000 });
  await approval.getByRole("button", { name: "批准" }).click();
  await expect(phone.locator(".rw-ev--final")).toContainText("已在项目里创建 hello.txt", { timeout: 20_000 });
  await expect(phone.locator(".rw-log")).toContainText("你好，来自手机");
  await expect(phone.locator(".rw-sv-head")).toContainText("150 CWU");
  await shot(phone, "done");
  expect(readFileSync(join(project, "hello.txt"), "utf8")).toBe("你好，来自手机");
});

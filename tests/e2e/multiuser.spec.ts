import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// One hosted server, many people: the owner invites, a member registers with the code and gets their
// own space without the server-wide tools; the owner can disable the member.
const OWNER = { email: "owner@example.com", password: "a-very-secure-long-password" };
const MEMBER = { email: "member@example.com", password: "member-secure-password-1" };
const BOOT = "multi-bootstrap-token-of-32-characters";
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => {
  mock = await startMockModel(8884);
  ciro = await startCiro(8783, 8884, { CIRO_ACCOUNTS_ENABLED: "true", CIRO_BOOTSTRAP_TOKEN: BOOT, CIRO_REGISTRATION: "invite",
    CIRO_API_KEY_PEPPER: "multi-user-pepper-more-than-24-bytes", CIRO_ACCOUNT_DATA_KEY: Buffer.alloc(32, 7).toString("base64") });
  const boot = await fetch(ciro.url + "/api/account/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...OWNER, displayName: "Owner", bootstrapToken: BOOT }) });
  expect(boot.status).toBe(201);
});
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("owner invites, member registers in the app, sees only their own space; owner disables them", async ({ browser }) => {
  const ownerCtx = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 860 } });
  const owner = await ownerCtx.newPage();
  expect((await owner.request.post(ciro.url + "/api/account/login", { data: OWNER })).status()).toBe(200);
  await owner.goto(ciro.url + "/");
  await owner.keyboard.press("Control+,");
  await owner.locator(".sc-nav").getByRole("button", { name: "用户管理" }).click();
  await expect(owner.locator(".ua-mode")).toContainText("邀请注册");
  await owner.getByRole("button", { name: "生成邀请码" }).click();
  const code = (await owner.locator(".ua-invite code").first().innerText({ timeout: 10_000 })).trim();
  expect(code).toMatch(/^[A-Z0-9]{8}$/);

  // The member signs up from the account page of the app.
  const memberCtx = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 860 } });
  const member = await memberCtx.newPage();
  await member.goto(ciro.url + "/");
  await member.keyboard.press("Control+,");
  await member.locator(".sc-nav").getByRole("button", { name: "账户与安全" }).click();
  await member.getByRole("button", { name: "没有账户？注册" }).click({ timeout: 10_000 });
  await member.getByLabel("邮箱").fill(MEMBER.email);
  await member.getByLabel("显示名称").fill("小王");
  await member.getByLabel("登录密码").fill(MEMBER.password);
  await member.getByLabel("邀请码").fill(code);
  await member.getByRole("button", { name: "注册", exact: true }).click({ timeout: 10_000 });
  await expect(member.locator(".acc-metadata").first()).toContainText(MEMBER.email);
  // Server-wide tools are not offered to members; their own pages are.
  await member.reload();
  await member.keyboard.press("Control+,");
  const nav = member.locator(".sc-nav");
  // Members see their own CWU balance and API keys (API calls are billed in CWU), not server-wide tools.
  await expect(nav.getByRole("button", { name: "CWU 额度" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "API 控制台" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "插件管理" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "用户管理" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "账单与用量" })).toHaveCount(0);
  await member.getByRole("button", { name: "关闭设置" }).first().click();
  await expect(member.locator(".cx-nav").getByRole("button", { name: "融合工作台" })).toHaveCount(0);
  await member.locator(".cx-nav").getByRole("button", { name: "工作模式" }).click();
  await expect(member.locator(".cx-owner-only")).toHaveCount(0);
  expect((await member.request.get(ciro.url + "/api/workbench/state")).status()).toBe(403);
  // Members cannot publish announcements.
  expect((await member.request.post(ciro.url + "/api/announcements", { data: { title: "x" },
    headers: { "X-Ciro-Csrf": (await (await member.request.get(ciro.url + "/api/account/session")).json()).csrf } })).status()).toBe(403);

  // The owner sees the member and disables them; the member is signed out.
  await owner.reload();
  await owner.keyboard.press("Control+,");
  await owner.locator(".sc-nav").getByRole("button", { name: "用户管理" }).click();
  await expect(owner.locator(".ua-user")).toHaveCount(2);
  await owner.getByRole("button", { name: "停用账户 " + MEMBER.email }).click();
  await expect(owner.locator(".ua-user--off")).toContainText(MEMBER.email);
  expect((await (await member.request.get(ciro.url + "/api/account/session")).json()).authenticated).toBe(false);
  await ownerCtx.close(); await memberCtx.close();
});

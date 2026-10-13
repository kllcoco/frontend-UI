import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// A second server with accounts enabled; two browser contexts act as two devices of the same account.
const PORT = 8797, URL_ = "http://127.0.0.1:" + PORT;
const ACCOUNT = { email: "sync@example.com", password: "a-very-secure-long-password" };
let server: ChildProcess, dir: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ciro-sync-e2e-"));
  server = spawn(process.execPath, ["server/index.mjs"], { stdio: "ignore", env: {
    ...process.env, PORT: String(PORT), HOST: "127.0.0.1", NODE_ENV: "production", CIRO_API_BASE_URL: "",
    CIRO_WORKSPACE_DATA_DIR: dir, CIRO_ACCOUNTS_ENABLED: "true", CIRO_BOOTSTRAP_TOKEN: "sync-bootstrap-token-of-32-characters",
    CIRO_API_KEY_PEPPER: "sync-api-key-pepper-more-than-24-bytes", CIRO_ACCOUNT_DATA_KEY: randomBytes(32).toString("base64") } });
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(URL_ + "/api/account/session")).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const boot = await fetch(URL_ + "/api/account/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...ACCOUNT, displayName: "Sync", bootstrapToken: "sync-bootstrap-token-of-32-characters" }) });
  expect(boot.status).toBe(201);
});
test.afterAll(() => { server?.kill(); rmSync(dir, { recursive: true, force: true }); });

async function device(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: URL_ });
  const login = await context.request.post("/api/account/login", { data: ACCOUNT });
  expect(login.ok()).toBeTruthy();
  return context;
}

test("two signed-in devices sync conversations, edits and deletions", async ({ browser }) => {
  const a = await (await device(browser)).newPage();
  const b = await (await device(browser)).newPage();
  await a.goto("/");
  await a.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("来自设备 A 的问题");
  await a.keyboard.press("Enter");
  await expect(a.locator(".message--assistant")).toBeVisible();

  await b.goto("/");
  await expect(b.locator(".cx-nav, .cx-sidebar").getByText("来自设备 A 的问题").first()).toBeVisible({ timeout: 20_000 });

  // Rename on B, see it on A without reloading (A syncs on focus / interval).
  await b.locator(".cx-row").filter({ hasText: "来自设备 A 的问题" }).getByRole("button", { name: /管理对话/ }).click();
  await b.getByRole("menuitem", { name: "重命名" }).click();
  await b.getByRole("textbox", { name: "重命名对话" }).fill("B 改过的标题");
  await b.keyboard.press("Enter");
  await expect.poll(async () => (await (await b.request.get("/api/account/sync/v2/changes?since=0")).json()).items
    .some((x: { data?: { title?: string } }) => x.data?.title === "B 改过的标题"), { timeout: 15_000 }).toBe(true);
  await a.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(a.locator(".cx-row").filter({ hasText: "B 改过的标题" })).toBeVisible({ timeout: 20_000 });

  // Delete on A, it disappears on B.
  a.on("dialog", (d) => void d.accept());
  await a.locator(".cx-row").filter({ hasText: "B 改过的标题" }).getByRole("button", { name: /管理对话/ }).click();
  await a.getByRole("menuitem", { name: "删除对话" }).click();
  await expect(a.locator(".cx-row").filter({ hasText: "B 改过的标题" })).toHaveCount(0);
  await expect.poll(async () => (await (await a.request.get("/api/account/sync/v2/changes?since=0")).json()).count, { timeout: 15_000 }).toBe(1);
  await b.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(b.locator(".cx-row").filter({ hasText: "B 改过的标题" })).toHaveCount(0, { timeout: 20_000 });
});

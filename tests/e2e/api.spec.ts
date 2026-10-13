import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Selling the API: an account owner mints a key, calls the OpenAI-compatible /v1 endpoint with it
// (from code and from the console's in-browser test) and sees per-key CWU usage and the call log.
const ACCOUNT = { email: "api@example.com", password: "a-very-secure-long-password" };
const BOOT = "api-bootstrap-token-of-32-characters!!";
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => {
  mock = await startMockModel(8883);
  ciro = await startCiro(8782, 8883, { CIRO_ACCOUNTS_ENABLED: "true", CIRO_BOOTSTRAP_TOKEN: BOOT,
    CIRO_API_KEY_PEPPER: "api-console-pepper-more-than-24-bytes", CIRO_ACCOUNT_DATA_KEY: Buffer.alloc(32, 9).toString("base64") });
  const boot = await fetch(ciro.url + "/api/account/bootstrap", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...ACCOUNT, displayName: "Owner", bootstrapToken: BOOT }) });
  expect(boot.status).toBe(201);
});
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("API console: create a key, call /v1 from code and the browser, see CWU per key and the call log", async ({ page }) => {
  expect((await page.request.post(ciro.url + "/api/account/login", { data: ACCOUNT })).status()).toBe(200);
  await page.goto(ciro.url + "/");
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "API 控制台" }).click();
  await expect(page.locator(".api-base code")).toHaveText(ciro.url + "/v1");
  await page.getByRole("textbox", { name: "密钥名称" }).fill("服务端集成");
  await page.getByRole("button", { name: "创建密钥" }).click();
  const secret = (await page.locator(".acc-one-time code").innerText()).trim();
  expect(secret).toMatch(/^ciro_sk_/);

  // From code, exactly like the OpenAI SDK would.
  const models = await (await fetch(ciro.url + "/v1/models", { headers: { Authorization: "Bearer " + secret } })).json();
  expect(models.data.map((m: { id: string }) => m.id)).toContain("ciro");
  const reply = await (await fetch(ciro.url + "/v1/chat/completions", { method: "POST",
    headers: { Authorization: "Bearer " + secret, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "ciro-pro", stream: true, messages: [{ role: "user", content: "你好" }] }) })).text();
  const text = reply.split("\n").filter((l) => l.startsWith("data:") && !l.includes("[DONE]"))
    .map((l) => JSON.parse(l.slice(5)).choices?.[0]?.delta?.content ?? "").join("");
  expect(text).toContain("来自 ciro-pro 的回答");
  expect((await fetch(ciro.url + "/v1/models", { headers: { Authorization: "Bearer ciro_sk_wrong" } })).status).toBe(401);

  // From the console's in-browser test.
  await page.getByRole("textbox", { name: "API 密钥" }).fill(secret);
  await page.getByRole("button", { name: "发送请求" }).click();
  await expect(page.locator(".api-out pre")).toContainText("来自 ciro 的回答");
  await expect(page.locator(".api-out small")).toContainText("1234 CWU");

  await page.locator(".api-card").filter({ hasText: "各密钥用量" }).getByRole("button", { name: "刷新" }).click();
  const usage = page.locator(".api-key-usage").first();
  await expect(usage).toContainText("服务端集成");
  await expect(usage).toContainText("3,734 CWU · 2 次调用"); // 2,500 + 1,234
  await expect(page.locator(".api-table tbody tr")).toHaveCount(2);
  await expect(page.locator(".api-table tbody tr").first()).toContainText("ciro");
  await page.getByRole("tab", { name: "Python" }).click();
  await expect(page.locator(".api-code pre")).toContainText('base_url="' + ciro.url + '/v1"');
});

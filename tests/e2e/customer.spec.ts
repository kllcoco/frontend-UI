import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Customers never see model / server plumbing: no "connect a model" card, no model settings, no preview notes.
// The operator turns developer options on (About → tap the version 7 times).
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8893); ciro = await startCiro(8792, 8893, { CIRO_API_BASE_URL: "", CIRO_SETUP_HINTS: "" }); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("customer view hides the model connection; developer options bring it back", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await expect(page.getByText("暂时连不上 Ciro 服务")).toBeVisible();
  await expect(page.getByText("还差一步：连接模型")).toHaveCount(0);
  await expect(page.getByText("当前为客户端预览，尚未连接真实 CIRO 推理服务")).toHaveCount(0);
  await page.keyboard.press("Control+,");
  // 模型设置 only offers "我的模型" (their own API keys) to customers; the Ciro service settings stay hidden.
  await page.locator(".sc-nav").getByRole("button", { name: "模型设置", exact: true }).click();
  await expect(page.getByRole("button", { name: "添加模型" })).toBeVisible();
  await expect(page.getByText("等待 CIRO 推理服务接入")).toHaveCount(0);
  await page.locator(".sc-nav").getByRole("button", { name: "关于 Ciro", exact: true }).click();
  await expect(page.getByText("推理服务", { exact: true })).toHaveCount(0);
  const version = page.getByText(/Ciro · v\d/);
  for (let i = 0; i < 7; i += 1) await version.click();
  await expect(page.getByRole("switch", { name: "开发者选项" })).toBeVisible();
});

test("customers add their own model by API and chat with it, even while the Ciro service is down", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("button", { name: "添加模型" }).click();
  await page.getByRole("button", { name: "DeepSeek" }).click();
  await page.getByLabel("接口地址").fill("http://127.0.0.1:8893/v1");
  await page.getByLabel("API Key").fill("sk-test");
  await page.getByLabel("模型名").fill("my-model");
  await page.getByRole("button", { name: "添加并测试" }).click();
  await expect(page.getByText("「DeepSeek」可以用了。")).toBeVisible();
  await page.getByRole("button", { name: "关闭设置" }).first().click();
  await expect(page.getByRole("button", { name: "切换模型" })).toContainText("DeepSeek");
  await expect(page.getByText("暂时连不上 Ciro 服务")).toHaveCount(0);
  await page.locator("textarea").first().fill("你好");
  await page.keyboard.press("Enter");
  await expect(page.getByText("来自 my-model 的回答：你好")).toBeVisible();
  // the key stays on this device
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.custom-models.v1") || "[]")[0].apiKey)).toBe("sk-test");
});

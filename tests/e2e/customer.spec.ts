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
  await expect(page.locator(".sc-nav").getByRole("button", { name: "模型设置", exact: true })).toHaveCount(0);
  await page.locator(".sc-nav").getByRole("button", { name: "关于 Ciro", exact: true }).click();
  await expect(page.getByText("推理服务", { exact: true })).toHaveCount(0);
  const version = page.getByText(/Ciro · v\d/);
  for (let i = 0; i < 7; i += 1) await version.click();
  await expect(page.locator(".sc-nav").getByRole("button", { name: "模型设置", exact: true })).toBeVisible();
  await expect(page.getByRole("switch", { name: "开发者选项" })).toBeVisible();
});

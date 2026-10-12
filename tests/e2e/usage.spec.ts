import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8898); ciro = await startCiro(8796, 8898); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("replies show reported CWU and the usage page totals them (tokens are never converted)", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("统计用量");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message--assistant .message-prose")).toContainText("来自 ciro 的回答");
  await expect(page.locator(".cx-usage-tag")).toHaveText("1,234 CWU");
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "用量统计", exact: true }).click();
  const today = page.locator(".us-card").first();
  // chat 1234 + auto title 1234 + follow-ups 1234
  await expect(today).toContainText("3,702");
  await expect(today).toContainText("3 次调用");
  await expect(page.locator(".us-grid")).toContainText("对话回答");
  await expect(page.locator(".us-grid")).toContainText("ciro");
  await expect(page.locator(".us-root")).not.toContainText("176");
});

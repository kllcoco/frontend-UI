import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8879); ciro = await startCiro(8778, 8879, { CIRO_WEB_SEARCH: "on" }); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("web search answers show source cards (deduplicated, only http links) that survive a reload", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.getByRole("button", { name: "联网搜索" }).click();
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("今天有什么新闻");
  await page.keyboard.press("Enter");
  const cards = page.getByLabel("参考来源");
  await expect(cards.locator(".cx-source")).toHaveCount(2);
  await expect(cards.locator(".cx-source").first()).toContainText("新闻：今日要闻");
  await expect(cards.locator(".cx-source").first()).toContainText("news.example.com");
  await expect(cards.locator(".cx-source").nth(1)).toContainText("这是摘要");
  await expect(cards.locator(".cx-source").first()).toHaveAttribute("href", "https://news.example.com/a");
  await page.reload();
  await expect(page.getByLabel("参考来源").locator(".cx-source")).toHaveCount(2);
});

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

test("scheduled task results become system notifications (once each) and tapping opens the schedules page", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__shown = [];
    w.CiroNotify = { status: () => "granted", request: () => {}, background: () => true,
      show: (title: string, body: string, tag: string) => (w.__shown as unknown[]).push({ title, body, tag }) };
  });
  let calls = 0;
  await page.route("**/api/workbench/schedule-events*", (route) => {
    calls += 1;
    const events = calls === 1 ? [] : [
      { id: "e2", at: "2026-10-13T08:00:02.000Z", title: "定时任务「日报」已完成", body: "已生成今天的日报" },
      { id: "e1", at: "2026-10-13T08:00:01.000Z", title: "定时任务「备份」等待你批准", body: "" }];
    return route.fulfill({ json: { events, now: "2026-10-13T08:00:00.000Z" } });
  });
  await page.goto(ciro.url + "/");
  await expect.poll(() => calls).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  type Shown = { title: string; body: string; tag: string };
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shown: Shown[] }).__shown.map((x) => x.title))).toEqual(
    ["定时任务「备份」等待你批准", "定时任务「日报」已完成"]);
  const seen = await page.evaluate(() => localStorage.getItem("ciro.schedule-seen.v1"));
  expect(seen).toBe("2026-10-13T08:00:02.000Z");
  expect(await page.evaluate(() => (window as unknown as { __shown: Shown[] }).__shown[0].body)).toBe("打开协作空间查看详情");
});

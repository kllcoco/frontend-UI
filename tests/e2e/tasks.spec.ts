import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Timed tasks: asked in a chat, the model sets one with a <task> tag; when due, the app runs it in its own chat and
// the pet comes out with the result. The list lives in Settings → 桌宠 → 定时任务.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8897); ciro = await startCiro(8796, 8897); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("a task set by talking to Ciro runs on time and the pet reports the result", async ({ page }) => {
  await page.clock.install();
  await page.goto(ciro.url + "/");
  await page.evaluate(() => localStorage.setItem("ciro.pet.v1", "on"));
  await page.reload();
  await page.locator("textarea").first().fill("1 分钟后提醒我喝水");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByText("好的，一分钟后提醒你。")).toBeVisible();
  await expect(page.getByText("<task")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ciro.tasks.v1") || "[]").length)).toBe(1);
  await expect(page.getByText("已设定定时任务：喝水")).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.tasks.v1") || "[]"));
  expect(saved).toHaveLength(1);
  expect(saved[0].title).toBe("喝水");

  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "桌宠", exact: true }).click();
  await expect(page.locator(".task-list")).toContainText("喝水");
  await page.getByRole("button", { name: "关闭设置" }).first().click();

  // Time passes: the task runs in its own chat and she tells you it is done.
  await page.clock.fastForward("01:20");
  await expect(page.getByText("⏰ 喝水").first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".pet-root--inline")).toContainText("喝水", { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("ciro.tasks.v1") || "[]").length)).toBe(0);
});

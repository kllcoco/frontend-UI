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

test("compare two models side by side and keep one answer (others become versions)", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  await page.getByRole("menuitem", { name: /对比模型/ }).click();
  const picker = page.getByRole("dialog", { name: "选择要对比的模型" });
  await picker.getByLabel("ciro", { exact: true }).check();
  await picker.getByLabel("ciro-pro").check();
  await picker.getByRole("button", { name: "完成" }).click();
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("比较一下");
  await page.keyboard.press("Enter");
  const grid = page.getByRole("group", { name: "模型对比" });
  await expect(grid.locator(".cx-compare-col")).toHaveCount(2);
  await expect(grid.locator(".cx-compare-col").nth(1)).toContainText("来自 ciro-pro 的回答");
  await expect(grid.locator(".cx-compare-col").nth(1)).toContainText("2,500 CWU");
  await grid.locator(".cx-compare-col").nth(1).getByRole("button", { name: "使用这个回答" }).click();
  await expect(grid).toHaveCount(0);
  await expect(page.locator(".message--assistant .message-prose")).toContainText("来自 ciro-pro 的回答");
  await expect(page.locator(".cx-model-tag")).toHaveText("ciro-pro");
  const nav = page.locator(".message--assistant .cx-version");
  await expect(nav).toContainText("2 / 2");
  await nav.getByRole("button", { name: "上一个版本" }).click();
  await expect(page.locator(".message--assistant .message-prose")).toContainText("来自 ciro 的回答");
  await expect(page.locator(".cx-model-tag")).toHaveText("ciro");
});

test("Ciro writes lasting preferences to memory by itself, and the user can undo it", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("我喜欢简洁的回答，以后都这样");
  await page.keyboard.press("Enter");
  const chip = page.locator(".cx-memory-chip--auto");
  await expect(chip).toContainText("用户喜欢简洁的回答");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.memories.v1") || "[]").map((m: { content: string }) => m.content))).toEqual(["用户喜欢简洁的回答"]);
  // An ordinary question saves nothing.
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("今天天气怎么样");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message--assistant")).toHaveCount(2);
  await expect(page.locator(".cx-memory-chip--auto")).toHaveCount(1);
  await chip.getByRole("button", { name: "撤销" }).click();
  await expect(chip).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.memories.v1") || "[]").length)).toBe(0);
});

test("attached files show as chips while the model still receives their text", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.locator('input[type=file]').first().setInputFiles({ name: "plan.md", mimeType: "text/markdown", buffer: Buffer.from("# 计划\n- 第一步") });
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("总结这个文件");
  await page.keyboard.press("Enter");
  await expect(page.locator(".cx-msg-file")).toContainText("plan.md");
  await expect(page.locator(".user-bubble")).toHaveText("总结这个文件");
  await expect(page.locator(".message--assistant .message-prose")).toContainText("（已收到附件）");
});

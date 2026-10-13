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

test("Android app: reply notifications go through the native bridge and tapping one opens the chat", async ({ page }) => {
  // The Android WebView has no web Notification API; MainActivity exposes window.CiroNotify instead.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let state = "default";
    w.__shown = [];
    delete (w as { Notification?: unknown }).Notification;
    w.CiroNotify = {
      status: () => state,
      request: () => { state = "granted"; setTimeout(() => (w.ciroNotifyResult as (s: string) => void)?.(state), 10); },
      show: (title: string, body: string, tag: string) => (w.__shown as unknown[]).push({ title, body, tag }),
      background: () => true,
    };
  });
  await page.goto(ciro.url + "/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "对话设置", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "回答完成时通知" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("通知测试");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message--assistant .message-prose")).toContainText("来自 ciro 的回答");
  type Shown = { title: string; body: string; tag: string };
  await expect.poll(() => page.evaluate(() => (window as unknown as { __shown: Shown[] }).__shown.length)).toBe(1);
  const shown = await page.evaluate(() => (window as unknown as { __shown: Shown[] }).__shown[0]);
  expect(shown.title).toContain("Ciro 已回答");
  expect(shown.body).toContain("来自 ciro 的回答");
  await page.keyboard.press("Control+Shift+O");
  await expect(page.locator(".message--assistant")).toHaveCount(0);
  await page.evaluate((id) => (window as unknown as { ciroOpenChat: (id: string) => void }).ciroOpenChat(id), shown.tag);
  await expect(page.locator(".message--assistant .message-prose")).toContainText("来自 ciro 的回答");
});

test.describe("plans", () => {
  let limited: { url: string; stop: () => void };
  test.beforeAll(async () => {
    limited = await startCiro(8797, 8898, {
      CIRO_PLAN: "basic",
      CIRO_PLANS: JSON.stringify([
        { id: "basic", name: "基础版", nameEn: "Basic", monthlyCwu: 3000, price: "¥19 / 月", features: ["日常对话"] },
        { id: "pro", name: "专业版", monthlyCwu: 30000 },
        { id: "max", name: "旗舰版", monthlyCwu: null }
      ])
    });
  });
  test.afterAll(() => limited?.stop());

  test("monthly CWU allowance: counted on the server, shown in usage, new requests paused when used up", async ({ page }) => {
    await page.goto(limited.url + "/");
    await page.keyboard.press("Control+,");
    await page.locator(".sc-nav").getByRole("button", { name: "用量统计", exact: true }).click();
    const plan = page.getByRole("region", { name: "套餐与额度" });
    await expect(plan).toContainText("基础版");
    await expect(plan).toContainText("已用 0 / 3,000 CWU");
    await expect(plan.locator(".us-plan-card")).toHaveCount(3);
    await expect(plan.locator(".us-plan-card--current")).toContainText("¥19 / 月");
    await expect(plan.locator(".us-plan-card").nth(2)).toContainText("额度即将公布");
    await page.keyboard.press("Escape");
    // One question = answer + auto title + follow-ups = 3 × 1,234 CWU, which uses up the 3,000 CWU.
    await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("用掉额度");
    await page.keyboard.press("Enter");
    await expect(page.locator(".message--assistant .message-prose").first()).toContainText("来自 ciro 的回答");
    await expect.poll(async () => (await (await page.request.get(limited.url + "/api/plan")).json()).used.cwu).toBe(3702);
    await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("再问一个");
    await page.keyboard.press("Enter");
    await expect(page.locator(".message--assistant .message-prose").last()).toContainText("本月套餐的 CWU 额度已用完");
    await page.keyboard.press("Control+,");
    await page.locator(".sc-nav").getByRole("button", { name: "用量统计", exact: true }).click();
    await expect(plan).toContainText("额度已用完");
    await expect(plan.getByRole("meter")).toHaveAttribute("aria-valuenow", "3000");
  });
});

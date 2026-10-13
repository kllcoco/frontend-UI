import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
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

test("desktop quick ask: copied text is quoted, the answer streams in, and the chat is handed to the main window", async ({ page, context }) => {
  // Stand-in for the Electron preload bridge.
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__continued = ""; w.__hidden = 0;
    let quick: ((i: { clipboard: string }) => void) | null = null;
    w.ciroDesktop = { platform: "win32", version: "0", setLanguage() {}, onCommand: () => () => {},
      onQuick: (h: typeof quick) => { quick = h; return () => {}; }, quickHide: () => { (w.__hidden as number)++; },
      quickContinue: (id: string) => { w.__continued = id; }, __fire: (c: string) => quick?.({ clipboard: c }) };
  });
  await page.goto(ciro.url + "/?quick=1");
  await page.evaluate(() => (window as unknown as { ciroDesktop: { __fire: (c: string) => void } }).ciroDesktop.__fire("The quick brown fox"));
  await expect(page.locator(".qa-quote")).toContainText("The quick brown fox");
  await page.getByRole("textbox", { name: "快速提问" }).fill("翻译成中文");
  const sent = page.waitForRequest((r) => r.url().endsWith("/api/chat"));
  await page.keyboard.press("Enter");
  expect(((await sent).postDataJSON() as { messages: { content: string }[] }).messages[0].content).toContain("> The quick brown fox");
  await expect(page.locator(".qa-answer")).toContainText("来自 ciro 的回答");
  await page.getByRole("button", { name: "在主窗口继续这个对话" }).click();
  const id = await page.evaluate(() => (window as unknown as { __continued: string }).__continued);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.chats.v1") || "[]") as { id: string; title: string }[]);
  expect(saved[0]).toMatchObject({ id, title: "翻译成中文" });
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => (window as unknown as { __hidden: number }).__hidden)).toBe(1);
  // The main window opens that chat.
  const main = await context.newPage();
  await main.goto(ciro.url + "/");
  await main.getByRole("button", { name: /翻译成中文/ }).first().click();
  await expect(main.locator(".message--assistant .message-prose")).toContainText("来自 ciro 的回答");
});

test("share an answer as an image: preview is generated and can be saved", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.getByRole("textbox", { name: "向 Ciro 发送消息" }).fill("用一句话介绍杭州");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message--assistant .message-prose").last()).toContainText("来自 ciro 的回答");
  await page.getByRole("button", { name: "分享为图片" }).last().click();
  const dialog = page.getByRole("dialog", { name: "分享为图片" });
  const img = dialog.getByRole("img", { name: "分享图片预览" });
  await expect(img).toBeVisible({ timeout: 15000 });
  const size = await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight]);
  expect(size[0]).toBe(1120); // 560 px card at 2x
  expect(size[1]).toBeGreaterThan(300);
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "保存图片" }).click();
  // (Headless Chromium drops non-ASCII file names, so check the bytes rather than the name.)
  const file = await (await download).path();
  expect(readFileSync(file!).subarray(1, 4).toString()).toBe("PNG");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Android app updates itself: newer release offered, downloaded, installer asked for permission, then started", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    let polls = 0, allowed = false;
    w.__dl = null; w.__installs = [];
    w.CiroUpdate = {
      version: () => "0.9.6",
      download: (url: string, name: string) => { w.__dl = { url, name }; return true; },
      progress: () => JSON.stringify(++polls < 3 ? { status: "running", bytes: polls * 40, total: 100 } : { status: "done", bytes: 100, total: 100 }),
      install: () => { const r = allowed ? "started" : "need-permission"; allowed = true; (w.__installs as string[]).push(r); return r; }
    };
  });
  await page.route("https://api.github.com/repos/kllcoco/frontend-UI/releases/latest", (route) => route.fulfill({ json: {
    tag_name: "v0.9.7", html_url: "https://github.com/kllcoco/frontend-UI/releases/tag/v0.9.7",
    assets: [{ name: "Android-Ciro-0.9.7.apk", browser_download_url: "https://github.com/kllcoco/frontend-UI/releases/download/v0.9.7/Android-Ciro-0.9.7.apk", size: 11534336 },
      { name: "Windows-Ciro-0.9.7-x64.exe", browser_download_url: "https://example.com/x.exe", size: 1 }] } }));
  await page.goto(ciro.url + "/");
  const banner = page.locator(".cx-aupdate");
  await expect(banner).toContainText("发现新版本 v0.9.7 · 11.0 MB", { timeout: 10000 });
  await banner.getByRole("button", { name: "更新" }).click();
  expect(await page.evaluate(() => (window as unknown as { __dl: { name: string } }).__dl.name)).toBe("Android-Ciro-0.9.7.apk");
  await expect(banner).toContainText("允许 Ciro 安装应用");
  await banner.getByRole("button", { name: "安装" }).click();
  expect(await page.evaluate(() => (window as unknown as { __installs: string[] }).__installs)).toEqual(["need-permission", "started"]);
});

test("Android app on the latest version: no banner; About → Check for updates says so", async ({ page }) => {
  await page.addInitScript(() => { (window as unknown as Record<string, unknown>).CiroUpdate = { version: () => "0.9.7", download: () => true, progress: () => "{}", install: () => "missing" }; });
  await page.route("https://api.github.com/repos/kllcoco/frontend-UI/releases/latest", (route) => route.fulfill({ json: { tag_name: "v0.9.7", assets: [{ name: "Android-Ciro-0.9.7.apk", browser_download_url: "https://github.com/kllcoco/frontend-UI/releases/download/v0.9.7/Android-Ciro-0.9.7.apk", size: 1 }] } }));
  await page.goto(ciro.url + "/");
  await page.waitForTimeout(4500);
  await expect(page.locator(".cx-aupdate")).toHaveCount(0);
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "关于 Ciro" }).click();
  await page.getByRole("button", { name: "检查更新" }).click();
  await expect(page.getByText("已是最新版本")).toBeVisible();
});

test("announcements entry is always findable; without owner rights it explains how to publish", async ({ page }) => {
  await page.goto(ciro.url + "/");
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "公告推送" }).click();
  await expect(page.getByText("公告推送需要服务器所有者权限")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开 announcements.json" })).toBeVisible();
});

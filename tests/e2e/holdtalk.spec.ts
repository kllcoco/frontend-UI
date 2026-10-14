import { test, expect, type Page } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Phone hold-to-talk: press and hold the voice button, release to send; slide up to cancel; a short tap says how; voice mode is in the + menu.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8877); ciro = await startCiro(8776, 8877); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, permissions: ["microphone"],
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    ...(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {}) } });

async function hold(page: Page, ms: number, slideUp = 0) {
  const box = (await page.getByRole("button", { name: "按住说话" }).boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
  await page.waitForTimeout(ms);
  if (slideUp) for (let i = 1; i <= 5; i += 1) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - slideUp * i / 5, id: 1 }] }); await page.waitForTimeout(30); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

test("hold to talk sends what was said; sliding up cancels; a tap explains, voice mode from the + menu", async ({ page }) => {
  let transcribed = 0;
  await page.route("**/api/status", async (route) => { const r = await route.fetch(); route.fulfill({ response: r, json: { ...(await r.json()), stt: true } }); });
  await page.route("**/api/voice/transcribe*", (route) => { transcribed += 1; return route.fulfill({ json: { text: "语音测试内容" } }); });
  // No browser speech service in CI: use the server speech-to-text path (recorded audio).
  await page.addInitScript(() => { delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition; delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition; });
  await page.goto(ciro.url + "/");
  await hold(page, 1200);
  await expect(page.locator(".user-bubble").last()).toHaveText("语音测试内容");
  await expect(page.locator(".message--assistant .message-prose").last()).toContainText("来自 ciro 的回答：语音测试内容");
  // Slide up while holding: nothing is transcribed or sent.
  const before = transcribed;
  await hold(page, 1000, 160);
  await page.waitForTimeout(500);
  expect(transcribed).toBe(before);
  await expect(page.locator(".cx-hold")).toHaveCount(0);
  // A short tap only explains how; the full-screen voice mode is in the + menu.
  await hold(page, 60);
  await expect(page.getByText("按住说话，松开发送，上滑取消")).toBeVisible();
  await expect(page.getByRole("dialog", { name: /语音对话/ })).toHaveCount(0);
  await page.getByRole("button", { name: "添加附件与模式" }).click();
  await page.getByRole("menuitem", { name: /语音对话/ }).click();
  await expect(page.getByRole("dialog", { name: /语音对话/ })).toBeVisible();
});

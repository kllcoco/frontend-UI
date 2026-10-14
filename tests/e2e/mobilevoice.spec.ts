import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// Android app on a phone: the composer's voice button must react to a tap (open voice mode, start listening,
// which asks for the microphone) — it used to do nothing at all.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8909); ciro = await startCiro(8806, 8909); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("phone: holding the voice button starts the phone's recogniser right away", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36 CiroMobile/0.10.11" });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { ciroListenEvent?: (t: string, d: string) => void };
    w.__starts = 0;
    w.CiroListen = { available: () => true, engine: () => "offline",
      start: () => { (w.__starts as number)++; setTimeout(() => w.ciroListenEvent?.("start", ""), 20); },
      stop: () => setTimeout(() => w.ciroListenEvent?.("end", ""), 10), abort: () => setTimeout(() => w.ciroListenEvent?.("end", ""), 10) };
  });
  await page.goto(ciro.url + "/");
  const voice = page.getByRole("button", { name: "按住说话" });
  await expect(voice).toBeVisible();
  const box = (await voice.boundingBox())!;
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
  await expect(page.locator(".cx-hold")).toBeVisible(); // "松开发送" shows while held
  await expect.poll(() => page.evaluate(() => (window as unknown as { __starts: number }).__starts)).toBeGreaterThan(0);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await ctx.close();
});

import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// "Ciro, set an alarm…" from the Android wake service: answered in the 语音助手 chat, the phone action carried out
// through the native bridge (unknown actions ignored), the answer read aloud without the tags.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8886); ciro = await startCiro(8786, 8886); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("voice command sets an alarm through the phone bridge and speaks the answer", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__ran = []; w.__spoken = [];
    w.CiroPhone = { run: (json: string) => { (w.__ran as string[]).push(json); return "ok"; } };
    w.CiroVoice = { speak: (text: string) => { (w.__spoken as string[]).push(text); }, setWake: () => "ok", wakeOn: () => false, available: () => true };
  });
  await page.goto(ciro.url + "/");
  await page.waitForFunction(() => typeof (window as unknown as { ciroVoiceCommand?: unknown }).ciroVoiceCommand === "function");
  await page.evaluate(() => (window as unknown as { ciroVoiceCommand: (t: string) => void }).ciroVoiceCommand("明早七点半的闹钟"));
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken)).toEqual(["好的，明早七点半叫你起床。"]);
  const ran = await page.evaluate(() => (window as unknown as { __ran: string[] }).__ran.map((x) => JSON.parse(x)));
  expect(ran).toEqual([{ action: "alarm", hour: 7, minute: 30, label: "起床" }]);
  await expect(page.locator(".cx-history").getByText("语音助手")).toBeVisible();
  await page.locator(".cx-history").getByText("语音助手").click();
  await expect(page.getByText("好的，明早七点半叫你起床。")).toBeVisible();
  await expect(page.getByText("<phone")).toHaveCount(0);
  // Settings → 语音唤醒 shows the switch only in the Android app (the bridge is there).
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "语音唤醒", exact: true }).click();
  await expect(page.getByRole("switch", { name: "语音唤醒" })).toBeVisible();
});

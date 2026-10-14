import { test, expect } from "@playwright/test";
import type { Server } from "node:http";
import { startCiro, startMockModel } from "./mock-upstream";

// v0.10.9: thinking depth reaches your own API models; the Android app's speech input (composer mic, hold to talk)
// uses the phone's recogniser; the floating pet's window is her size plus exactly the room her bubble takes.
let mock: Server, ciro: { url: string; stop: () => void };
test.beforeAll(async () => { mock = await startMockModel(8906); ciro = await startCiro(8805, 8906); });
test.afterAll(() => { ciro?.stop(); mock?.close(); });

test("thinking depth is sent to your own model as reasoning_effort; a service that refuses it still answers", async ({ page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route("http://127.0.0.1:8906/v1/chat/completions", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    bodies.push(body);
    if (body.model === "picky-model" && body.reasoning_effort) { await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { message: "Unrecognized request argument: reasoning_effort" } }) }); return; }
    await route.fulfill({ status: 200, contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"想好了"}}]}\n\ndata: [DONE]\n\n' });
  });
  await page.addInitScript(() => {
    localStorage.setItem("ciro.custom-models.v1", JSON.stringify([
      { id: "a1", name: "Deep", baseUrl: "http://127.0.0.1:8906/v1", apiKey: "k", model: "deep-model", api: "openai" },
      { id: "b2", name: "Picky", baseUrl: "http://127.0.0.1:8906/v1", apiKey: "k", model: "picky-model", api: "openai" }]));
    localStorage.setItem("ciro.thinking-level.v1", "3");
  });
  await page.goto(ciro.url + "/");
  await page.getByRole("button", { name: "切换模型" }).click();
  await page.getByRole("button", { name: "Deep" }).first().click();
  await page.locator("textarea").first().fill("难题");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-prose", { hasText: "想好了" })).toHaveCount(1);
  const asked = (text: string) => bodies.filter((b) => JSON.stringify(b.messages).includes(text));
  expect(asked("难题")[0].reasoning_effort).toBe("high");
  await page.getByRole("button", { name: "切换模型" }).click();
  await page.getByRole("button", { name: "Picky" }).first().click();
  await page.locator("textarea").first().fill("再来");
  await page.keyboard.press("Enter");
  await expect(page.locator(".message-prose", { hasText: "想好了" })).toHaveCount(2);
  const picky = asked("再来").filter((b) => b.model === "picky-model");
  expect(picky[0].reasoning_effort).toBe("high"); // refused with 400 …
  expect(picky[1].reasoning_effort).toBeUndefined(); // … and asked again without it
});

test("Android app: the composer mic uses the phone's recogniser and asks for nothing more", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown> & { ciroListenEvent?: (t: string, d: string) => void };
    let starts = 0;
    w.__starts = () => starts;
    w.CiroListen = {
      available: () => true,
      start: () => { starts += 1; const first = starts === 1;
        setTimeout(() => { w.ciroListenEvent?.("start", ""); if (first) { w.ciroListenEvent?.("partial", "你好"); w.ciroListenEvent?.("final", "你好世界"); } else w.ciroListenEvent?.("error", "no-speech"); w.ciroListenEvent?.("end", ""); }, 30); },
      stop: () => setTimeout(() => w.ciroListenEvent?.("end", ""), 10),
      abort: () => setTimeout(() => w.ciroListenEvent?.("end", ""), 10),
    };
  });
  await page.goto(ciro.url + "/");
  const mic = page.getByRole("button", { name: "语音输入" });
  await expect(mic).toBeVisible();
  await mic.click();
  await expect(page.locator("textarea").first()).toHaveValue(/你好世界/);
  // continuous: it keeps listening through silence until stopped
  await expect.poll(() => page.evaluate(() => (window as unknown as { __starts: () => number }).__starts())).toBeGreaterThan(1);
  await page.getByRole("button", { name: "停止语音输入" }).click();
  await expect(page.getByRole("button", { name: "语音输入" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "语音对话" })).toBeVisible();
});

test("floating pet: the window grows by exactly her bubble, which sits right above her, and shrinks back", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as typeof window & { CiroPetHost: unknown; fits: number[][] };
    w.fits = [];
    w.CiroPetHost = { beginDrag: () => {}, dragTo: () => {}, dragEnd: () => {}, moveBy: () => {}, resize: () => {}, expand: () => {}, edge: () => {}, action: () => {},
      fit: (x: number, y: number) => w.fits.push([x, y]) };
  });
  await page.setViewportSize({ width: 300, height: 420 });
  await page.goto(ciro.url + "/?pet=1&overlay=1&scale=1");
  await page.waitForTimeout(400);
  await page.evaluate(() => (window as unknown as { ciroPetHost: (k: string, j: string) => void }).ciroPetHost("progress", JSON.stringify({ text: "我在，你说～", attention: true })));
  const bubble = page.locator(".pet-say");
  await expect(bubble).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { fits: number[][] }).fits.at(-1)?.[1] || 0)).toBeGreaterThan(20);
  const [w, h] = await page.evaluate(() => (window as unknown as { fits: number[][] }).fits.at(-1)!);
  const b = (await bubble.boundingBox())!, s = (await page.locator(".pet-sprite").boundingBox())!;
  expect(h).toBeLessThan(b.height + 30); // no more than the bubble
  expect(w).toBeLessThan(200);
  expect(s.y - (b.y + b.height)).toBeLessThan(40); // right above her, not across the window
});

test("使用我的数据改进模型 is off by default and only then sends the opt-in", async ({ page }) => {
  const sent: Record<string, unknown>[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/chat") && r.method() === "POST") sent.push(JSON.parse(r.postData() || "{}")); });
  await page.goto(ciro.url + "/");
  await page.locator("textarea").first().fill("第一句");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.some((b) => JSON.stringify(b.messages).includes("第一句"))).toBeTruthy();
  expect(sent.find((b) => JSON.stringify(b.messages).includes("第一句"))!.improve).toBeUndefined();
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "隐私与安全", exact: true }).click();
  const toggle = page.getByRole("switch", { name: "使用我的数据改进模型" });
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await page.locator('button[aria-label="关闭设置"]:visible').click();
  await page.locator("textarea").first().fill("第二句");
  await page.keyboard.press("Enter");
  await expect.poll(() => sent.some((b) => JSON.stringify(b.messages).includes("第二句"))).toBeTruthy();
  expect(sent.find((b) => JSON.stringify(b.messages).includes("第二句"))!.improve).toBe(true);
});

test("a Claude key outside any workspace: the Workspace ID is asked for right there and then sent", async ({ page }) => {
  const seen: (string | undefined)[] = [];
  await page.route("http://127.0.0.1:8907/v1/messages", async (route) => {
    const ws = route.request().headers()["anthropic-workspace-id"];
    seen.push(ws);
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" } }); return; }
    if (!ws) { await route.fulfill({ status: 400, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header." } }) }); return; }
    await route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"m","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"OK"}}\n\n',
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'].join("") });
  });
  await page.addInitScript(() => localStorage.setItem("ciro.custom-models.v1", JSON.stringify([
    { id: "c1", name: "Claude", baseUrl: "http://127.0.0.1:8907", apiKey: "sk-ant-x", model: "claude-opus-5-5", api: "anthropic" }])));
  await page.goto(ciro.url + "/");
  await page.keyboard.press("Control+,");
  await page.locator(".sc-nav").getByRole("button", { name: "模型设置", exact: true }).click();
  await page.getByRole("button", { name: "测试" }).click();
  await expect(page.getByRole("status")).toContainText("Workspace ID");
  await page.getByLabel("Workspace ID").fill("wrkspc_123");
  await page.getByRole("button", { name: "保存并测试" }).click();
  await expect(page.getByText("「Claude」可以用了。")).toBeVisible();
  expect(seen).toContain("wrkspc_123");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("ciro.custom-models.v1")!)[0].workspace)).toBe("wrkspc_123");
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createMediaRouter, mediaFeatures } from "../server/media.mjs";
import { validateChat, ValidationError } from "../server/validate.mjs";

async function serve(env, fetchFn) {
  const app = express();
  app.use(express.json());
  app.use("/api", createMediaRouter({ apiBase: "https://model.example/v1", apiKey: "k", env, fetchFn }));
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  return { url: "http://127.0.0.1:" + server.address().port, close: () => server.close() };
}

test("media features are off unless enabled and an inference base exists", () => {
  assert.deepEqual(mediaFeatures({}), { stt: false, tts: false, images: false, team: false });
  assert.deepEqual(mediaFeatures({ CIRO_API_BASE_URL: "x", CIRO_VOICE: "on", CIRO_IMAGES: "on", CIRO_TEAM_URL: "t" }), { stt: true, tts: true, images: true, team: true });
});

test("disabled media endpoints answer 503 and team reports enabled:false", async () => {
  const s = await serve({}, fetch);
  try {
    assert.equal((await fetch(s.url + "/api/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{\"prompt\":\"cat\"}" })).status, 503);
    assert.equal((await fetch(s.url + "/api/voice/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{\"text\":\"hi\"}" })).status, 503);
    assert.deepEqual(await (await fetch(s.url + "/api/team")).json(), { enabled: false });
    assert.equal((await fetch(s.url + "/api/team/invites", { method: "POST" })).status, 501);
  } finally { s.close(); }
});

test("image generation and transcription proxy to OpenAI-compatible endpoints", async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/images/generations")) return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200 });
    if (url.endsWith("/audio/transcriptions")) { assert.ok(init.body instanceof FormData); return new Response(JSON.stringify({ text: "你好" }), { status: 200 }); }
    return new Response("{}", { status: 404 });
  };
  const s = await serve({ CIRO_API_BASE_URL: "https://model.example/v1", CIRO_IMAGES: "on", CIRO_VOICE: "on" }, fake);
  try {
    const img = await (await fetch(s.url + "/api/images", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "a cat", size: "1024x1024" }) })).json();
    assert.equal(img.images[0], "data:image/png;base64,aGVsbG8=");
    const stt = await (await fetch(s.url + "/api/voice/transcribe?lang=zh", { method: "POST", headers: { "Content-Type": "audio/webm" }, body: new Uint8Array(400) })).json();
    assert.equal(stt.text, "你好");
    assert.deepEqual(calls, ["https://model.example/v1/images/generations", "https://model.example/v1/audio/transcriptions"]);
  } finally { s.close(); }
});

test("memories become a bounded system message", () => {
  const ok = validateChat({ model: "ciro", messages: [{ role: "user", content: "hi" }], memories: ["我喜欢简洁的回答"] }, ["ciro"]);
  assert.equal(ok.messages[0].role, "system");
  assert.match(ok.messages[0].content, /简洁/);
  assert.throws(() => validateChat({ model: "ciro", messages: [{ role: "user", content: "hi" }], memories: ["x".repeat(301)] }, ["ciro"]), ValidationError);
  assert.throws(() => validateChat({ model: "ciro", messages: [{ role: "user", content: "hi" }], memories: Array(51).fill("a") }, ["ciro"]), ValidationError);
});

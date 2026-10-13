import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiGateway, validateApiRequest } from "../server/api-gateway.mjs";

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: "http://127.0.0.1:" + server.address().port };
}

test("OpenAI-compatible /v1: API keys, validation, JSON and streamed replies, per-key CWU log", async () => {
  const upstream = express();
  upstream.use(express.json());
  let seen = null;
  upstream.post("/v1/chat/completions", (req, res) => {
    seen = req.body;
    if (req.body.stream) {
      res.set("Content-Type", "text/event-stream");
      res.write('data: {"choices":[{"delta":{"content":"he"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"llo"}}],"usage":{"cwu":42,"total_tokens":999}}\n\n');
      return res.end("data: [DONE]\n\n");
    }
    res.json({ id: "x", object: "chat.completion", model: req.body.model, choices: [{ index: 0, message: { role: "assistant", content: "hi" } }], usage: { cwu: 7 } });
  });
  const up = await listen(upstream);
  const dir = mkdtempSync(join(tmpdir(), "apigw-"));
  const accounts = { enabled: true, principal: (req) => {
    const h = req.get("authorization");
    if (h === "Bearer ciro_sk_good") return { mode: "api-key", keyId: "k1", scopes: ["chat:invoke"] };
    if (h === "Bearer ciro_sk_sync") return { mode: "api-key", keyId: "k2", scopes: ["sync:read"] };
    return null;
  } };
  const gw = createApiGateway({ accounts, dir, upstreamUrl: up.url + "/v1/chat/completions", apiKey: "", models: ["ciro", "ciro-pro"], configured: true });
  const app = express();
  app.use(express.json());
  app.use("/v1", gw.v1);
  app.use("/api/apiconsole", (req, _res, next) => { req.principal = { mode: "session" }; next(); }, gw.consoleRouter);
  const ciro = await listen(app);
  const call = (path, key, body) => fetch(ciro.url + path, { method: body ? "POST" : "GET",
    headers: { ...(key ? { Authorization: "Bearer " + key } : {}), "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  try {
    assert.equal((await call("/v1/models")).status, 401);
    assert.equal((await call("/v1/models", "ciro_sk_bad")).status, 401);
    assert.equal((await call("/v1/chat/completions", "ciro_sk_sync", { model: "ciro", messages: [{ role: "user", content: "hi" }] })).status, 403);
    const models = await (await call("/v1/models", "ciro_sk_good")).json();
    assert.deepEqual(models.data.map((m) => m.id), ["ciro", "ciro-pro"]);
    const bad = await call("/v1/chat/completions", "ciro_sk_good", { model: "gpt-x", messages: [{ role: "user", content: "hi" }] });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error.message, /Unknown model/);

    const plain = await call("/v1/chat/completions", "ciro_sk_good", { model: "ciro", messages: [{ role: "user", content: "hi" }], temperature: 0.2, secret_param: 1 });
    assert.equal(plain.status, 200);
    assert.equal((await plain.json()).choices[0].message.content, "hi");
    assert.equal(seen.temperature, 0.2);
    assert.equal(seen.secret_param, undefined, "unknown parameters are not forwarded");

    const streamed = await call("/v1/chat/completions", "ciro_sk_good", { model: "ciro-pro", stream: true, messages: [{ role: "user", content: "hi" }] });
    const text = await streamed.text();
    assert.match(text, /"llo"/);
    assert.deepEqual(seen.stream_options, { include_usage: true });

    await new Promise((r) => setTimeout(r, 50));
    const usage = await (await fetch(ciro.url + "/api/apiconsole/usage")).json();
    assert.equal(usage.keys.k1.today.calls, 3);
    assert.equal(usage.keys.k1.today.errors, 1);
    assert.equal(usage.keys.k1.today.cwu, 49, "7 + 42 CWU; tokens are ignored");
    assert.equal(usage.log[0].model, "ciro-pro");
    assert.equal(usage.log[0].cwu, 42);
    assert.ok(!JSON.stringify(usage).includes("hello") && !JSON.stringify(usage).includes('"hi"'), "message contents are never stored");
  } finally { ciro.server.close(); up.server.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("request validation", () => {
  assert.throws(() => validateApiRequest({ model: "ciro", messages: [] }, ["ciro"]), /non-empty/);
  assert.throws(() => validateApiRequest({ model: "ciro", messages: [{ role: "robot", content: "x" }] }, ["ciro"]), /role/);
  assert.throws(() => validateApiRequest({ model: "ciro", n: 2, messages: [{ role: "user", content: "x" }] }, ["ciro"]), /n = 1/);
  const ok = validateApiRequest({ model: "ciro", messages: [{ role: "user", content: [{ type: "text", text: "x" }, { type: "image_url", image_url: { url: "data:image/png;base64,AA" } }] }] }, ["ciro"]);
  assert.equal(ok.stream, false);
});

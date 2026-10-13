// Public, OpenAI-compatible API for Ciro customers: POST /v1/chat/completions and GET /v1/models,
// authenticated with the account's API keys (Bearer ciro_sk_..., scope chat:invoke).
// Usage is recorded per key in Ciro's native units (CWU / GWU as reported by the model service);
// tokens are never converted. Request and response bodies are never stored, only metadata.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { meterOf, sseMeter } from "./metering.mjs";

const ROLES = new Set(["system", "user", "assistant", "tool", "developer"]);
const PASS = ["temperature", "top_p", "max_tokens", "max_completion_tokens", "stop", "presence_penalty", "frequency_penalty",
  "seed", "response_format", "reasoning_effort", "tools", "tool_choice", "parallel_tool_calls", "user"];
const MAX_MESSAGES = 200, MAX_BODY_CHARS = 4_000_000, LOG_LIMIT = 300, DAYS_KEPT = 90;

const fail = (res, status, message, type = "invalid_request_error") =>
  res.status(status).json({ error: { message, type, code: status } });

/** Checks an OpenAI chat.completions body and returns what is forwarded upstream. */
export function validateApiRequest(body, models) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Request body must be a JSON object");
  if (typeof body.model !== "string" || !models.includes(body.model)) throw new Error("Unknown model. Available: " + models.join(", "));
  const { messages } = body;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) throw new Error("messages must be a non-empty array (max " + MAX_MESSAGES + ")");
  for (const m of messages) {
    if (!m || typeof m !== "object" || !ROLES.has(m.role)) throw new Error("Each message needs a role: system, developer, user, assistant or tool");
    const okContent = typeof m.content === "string" || m.content === null && (m.role === "assistant" || m.role === "tool") ||
      Array.isArray(m.content) && m.content.every((p) => p && (p.type === "text" && typeof p.text === "string" ||
        p.type === "image_url" && typeof p.image_url?.url === "string"));
    if (!okContent) throw new Error("Message content must be a string or an array of text / image_url parts");
  }
  if (body.n !== undefined && body.n !== 1) throw new Error("Only n = 1 is supported");
  const out = { model: body.model, messages, stream: body.stream === true };
  for (const k of PASS) if (body[k] !== undefined) out[k] = body[k];
  if (out.stream) out.stream_options = { include_usage: true };
  return out;
}

export function createApiGateway({ accounts, dir, upstreamUrl, apiKey, models, configured, now = () => new Date() }) {
  const file = join(dir, "api-usage.json");
  let data = { keys: {}, log: [] };
  try { if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8")) || data; } catch { data = { keys: {}, log: [] }; }
  data.keys ||= {}; data.log ||= [];
  let saveTimer = null;
  const save = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try { mkdirSync(dir, { recursive: true }); writeFileSync(file + ".tmp", JSON.stringify(data), { mode: 0o600 }); renameSync(file + ".tmp", file); }
      catch { /* disk full: keep counting in memory */ }
    }, 250);
  };

  function record(keyId, entry) {
    const day = now().toISOString().slice(0, 10);
    const k = (data.keys[keyId] ||= { days: {} });
    const d = (k.days[day] ||= { calls: 0, errors: 0, cwu: 0, gwu: 0 });
    d.calls += 1; if (entry.status >= 400) d.errors += 1;
    d.cwu += entry.cwu || 0; d.gwu += entry.gwu || 0;
    for (const old of Object.keys(k.days).sort().slice(0, -DAYS_KEPT)) delete k.days[old];
    data.log.unshift({ at: now().toISOString(), keyId, ...entry });
    data.log.length = Math.min(data.log.length, LOG_LIMIT);
    save();
  }

  // Bearer ciro_sk_... with the chat:invoke scope; nothing else is accepted here.
  function authenticate(req, res) {
    if (!accounts.enabled) { fail(res, 503, "The Ciro API needs accounts turned on for this server (CIRO_ACCOUNTS_ENABLED=true)", "server_error"); return null; }
    if (!(req.get("authorization") || "").startsWith("Bearer ciro_sk_")) { fail(res, 401, "Missing API key. Send Authorization: Bearer ciro_sk_...", "authentication_error"); return null; }
    const p = accounts.principal(req);
    if (!p || p.mode !== "api-key") { fail(res, 401, "Invalid, expired or revoked API key", "authentication_error"); return null; }
    if (!p.scopes.includes("chat:invoke")) { fail(res, 403, "This API key lacks the chat:invoke scope", "permission_error"); return null; }
    return p;
  }

  const v1 = express.Router();
  v1.use(express.json({ limit: "25mb" }));
  v1.use((req, res, next) => { res.set("Access-Control-Allow-Origin", "*"); res.set("Access-Control-Allow-Headers", "Authorization, Content-Type"); next(); });
  v1.options("*", (_req, res) => res.sendStatus(204));

  v1.get("/models", (req, res) => {
    if (!authenticate(req, res)) return;
    res.json({ object: "list", data: models.map((id) => ({ id, object: "model", created: 0, owned_by: "ciro" })) });
  });

  v1.post("/chat/completions", async (req, res) => {
    const p = authenticate(req, res);
    if (!p) return;
    const started = Date.now();
    let payload;
    try {
      if (JSON.stringify(req.body || {}).length > MAX_BODY_CHARS) throw new Error("Request too large");
      payload = validateApiRequest(req.body, models);
    } catch (e) {
      record(p.keyId, { model: String(req.body?.model || "").slice(0, 60), status: 400, ms: 0, cwu: 0, gwu: 0, stream: false, error: e.message.slice(0, 160) });
      return fail(res, 400, e.message);
    }
    if (!configured) {
      record(p.keyId, { model: payload.model, status: 503, ms: 0, cwu: 0, gwu: 0, stream: payload.stream, error: "inference not configured" });
      return fail(res, 503, "No inference service is configured on this server", "server_error");
    }
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    const log = (status, meter, error) => record(p.keyId, { model: payload.model, status, ms: Date.now() - started,
      cwu: meter?.cwu || 0, gwu: meter?.gwu || 0, stream: payload.stream, ...(error ? { error: String(error).slice(0, 160) } : {}) });
    try {
      const upstream = await fetch(upstreamUrl, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: "Bearer " + apiKey } : {}) },
        body: JSON.stringify(payload) });
      const type = upstream.headers.get("content-type") || "";
      if (!upstream.ok) {
        const text = await upstream.text().catch(() => "");
        log(upstream.status, null, "upstream HTTP " + upstream.status);
        return fail(res, upstream.status >= 500 ? 502 : upstream.status, "Model service error (HTTP " + upstream.status + ")" + (text ? ": " + text.slice(0, 300) : ""), "upstream_error");
      }
      if (payload.stream && type.includes("event-stream") && upstream.body) {
        res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" });
        res.flushHeaders();
        const meter = sseMeter();
        for await (const chunk of upstream.body) { meter.push(chunk); if (res.writableEnded) break; res.write(chunk); }
        res.end();
        return log(200, meter.result());
      }
      const json = JSON.parse(await upstream.text());
      log(200, meterOf(json));
      if (payload.stream) {
        // Upstream ignored stream=true: send the reply as a single SSE chunk so clients still work.
        res.status(200).set({ "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache" });
        const content = json?.choices?.[0]?.message?.content ?? "";
        res.write("data: " + JSON.stringify({ id: json.id, object: "chat.completion.chunk", model: json.model || payload.model,
          choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }], usage: json.usage }) + "\n\n");
        res.end("data: [DONE]\n\n");
        return;
      }
      res.json(json);
    } catch (e) {
      if (controller.signal.aborted) return log(499, null, "client closed the connection");
      log(502, null, e.message);
      if (!res.headersSent) fail(res, 502, "Could not reach the model service: " + e.message, "upstream_error");
      else res.end();
    }
  });

  // Console data for the signed-in owner (browser session only).
  const consoleRouter = express.Router();
  consoleRouter.get("/usage", (req, res) => {
    if (req.principal?.mode !== "session" && req.principal?.mode !== "local") return res.status(403).json({ error: "Browser session required" });
    const today = now().toISOString().slice(0, 10);
    const daysBack = (n) => Array.from({ length: n }, (_, i) => new Date(now().getTime() - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10));
    const keys = Object.fromEntries(Object.entries(data.keys).map(([id, k]) => {
      const sum = (list) => list.reduce((a, d) => { const x = k.days[d]; if (x) { a.calls += x.calls; a.errors += x.errors; a.cwu += x.cwu; a.gwu += x.gwu; } return a; }, { calls: 0, errors: 0, cwu: 0, gwu: 0 });
      return [id, { today: sum([today]), last30: sum(daysBack(30)), daily: daysBack(14).map((d) => ({ day: d, cwu: k.days[d]?.cwu || 0, calls: k.days[d]?.calls || 0 })) }];
    }));
    res.set("Cache-Control", "no-store").json({ keys, log: data.log.slice(0, 100), models, baseUrlPath: "/v1", configured, accountsEnabled: Boolean(accounts.enabled) });
  });
  return { v1, consoleRouter, record };
}

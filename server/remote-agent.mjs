// Work mode, computer side. Runs inside this Ciro server (desktop app or ciro-client) once it has signed in to
// the user's Ciro account. It long-polls for commands, runs them only inside folders allowed on THIS computer,
// asks the phone for approval before an AI task writes files or runs commands (unless auto-approve is on),
// and streams output back. Local control endpoints accept requests from this machine only.
import { reportWork } from "./activity.mjs";
import express from "express";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";

const MAX_OUTPUT = 5_000_000;
const AGENT_STEPS = 40;
const RUN_TIMEOUT_MS = 30 * 60_000;
const AGENT_RUN_TIMEOUT_MS = 10 * 60_000;

function cwuOf(usage) {
  if (!usage || typeof usage !== "object") return 0;
  const n = usage.cwu ?? usage.CWU ?? usage.compute_units ?? usage.work_units ?? usage.total_work_units;
  return typeof n === "number" && n >= 0 ? Math.round(n) : 0;
}
/** Resolve `p` inside `root`; refuses anything that escapes it (including through symlinks). */
export function insideFolder(root, p, { mustExist = false } = {}) {
  const base = realpathSync(root);
  const target = resolve(base, String(p || "."));
  let probe = target;
  while (!existsSync(probe)) { const up = dirname(probe); if (up === probe) break; probe = up; }
  const real = realpathSync(probe);
  const realTarget = join(real, relative(probe, target));
  if (realTarget !== base && !realTarget.startsWith(base + sep)) throw new Error("路径超出了允许的文件夹：" + p);
  if (mustExist && !existsSync(realTarget)) throw new Error("文件不存在：" + p);
  return realTarget;
}
function killTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGTERM");
  } catch { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
}

const AGENT_PROMPT = (folder, platform) => `You are Ciro working on the user's computer (${platform}) inside the project folder: ${folder}
You act through tools. Reply with EXACTLY ONE JSON object and nothing else:
{"thought":"short reason","action":"list","path":"."}
{"thought":"…","action":"read","path":"relative/file"}
{"thought":"…","action":"write","path":"relative/file","content":"full new file content"}
{"thought":"…","action":"run","command":"shell command run in the project folder"}
{"thought":"…","action":"done","summary":"what you did and the result, in the user's language"}
Rules: paths are relative to the project folder and may not leave it. Prefer small, safe steps; read before you edit.
The user may reject a write or command — then choose another way or finish with done. Never run destructive commands
(rm -rf, format, force-push, deleting databases) unless the user explicitly asked for exactly that.`;

export function createRemoteAgent({ dir, version = "", fetchFn = fetch, localAllowed = () => true }) {
  const file = join(dir, "remote-agent.json");
  const router = express.Router();
  /** @type {{serverUrl:string, deviceId:string, token:string, name:string, folders:string[], enabled:boolean} | null} */
  let config = null;
  try { config = JSON.parse(readFileSync(file, "utf8")); } catch { config = null; }
  const save = () => { mkdirSync(dir, { recursive: true }); writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 }); };
  let status = { online: false, lastError: "", lastContact: 0 };
  const sessions = new Map();
  let loopToken = 0;

  const api = async (path, body, { method = body === undefined ? "GET" : "POST", signal } = {}) => {
    const res = await fetchFn(config.serverUrl.replace(/\/+$/, "") + "/api/remote" + path, {
      method, signal, headers: { Authorization: "Bearer " + config.token, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || "HTTP " + res.status), { status: res.status });
    return data;
  };

  /* ── event outbox per session (batched, ordered) ── */
  function emitter(sessionId, info = {}) {
    let buffer = [], timer = null, chain = Promise.resolve(), sent = 0;
    const flush = () => {
      timer = null;
      const batch = buffer.splice(0, 200);
      if (!batch.length) return chain;
      chain = chain.then(() => api("/device/events", { sessionId, events: batch })).catch(() => { /* server unreachable: drop, the phone sees a gap */ });
      if (buffer.length) flush();
      return chain;
    };
    const emit = (type, data) => {
      reportWork(info, type, data);
      if (type === "stdout" || type === "stderr") {
        if (sent > MAX_OUTPUT) return;
        sent += data.text.length;
        if (sent > MAX_OUTPUT) { buffer.push({ type: "stderr", data: { text: "\n[输出超过 5 MB，后续内容不再传回手机]\n" } }); }
        const last = buffer.at(-1);
        if (last && last.type === type && last.data.text.length < 30_000) { last.data.text += data.text; }
        else buffer.push({ type, data: { text: data.text.slice(0, 30_000) } });
      } else buffer.push({ type, data });
      if (!timer) timer = setTimeout(flush, 150);
    };
    return { emit, flush: () => { if (timer) clearTimeout(timer); return flush(); } };
  }

  /* ── shell sessions: each command runs in the folder; input goes to a running program's stdin ── */
  function runShell(session, command) {
    const { emit } = session.out;
    emit("status", { status: "running" });
    const child = spawn(command, { cwd: session.folder, shell: true, detached: process.platform !== "win32", windowsHide: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
    session.child = child;
    const timeout = setTimeout(() => { emit("stderr", { text: "\n[超过 30 分钟，已停止]\n" }); killTree(child); }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (d) => emit("stdout", { text: d.toString("utf8") }));
    child.stderr.on("data", (d) => emit("stderr", { text: d.toString("utf8") }));
    child.on("error", (e) => emit("stderr", { text: e.message + "\n" }));
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      session.child = null;
      emit("exit", { code, signal });
      emit("status", { status: session.stopped ? "stopped" : "idle" });
      void session.out.flush();
    });
  }

  /* ── AI task sessions ── */
  function waitApproval(session, request) {
    const requestId = randomUUID();
    session.out.emit("approval_request", { requestId, ...request });
    session.out.emit("status", { status: "waiting" });
    return new Promise((resolveApproval) => session.approvals.set(requestId, resolveApproval));
  }
  function runCapture(session, command) {
    return new Promise((done) => {
      const child = spawn(command, { cwd: session.folder, shell: true, detached: process.platform !== "win32", windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
      session.child = child;
      let out = "";
      const add = (stream) => (d) => { const text = d.toString("utf8"); out = (out + text).slice(-12_000); session.out.emit(stream, { text }); };
      child.stdout.on("data", add("stdout")); child.stderr.on("data", add("stderr"));
      const timer = setTimeout(() => killTree(child), AGENT_RUN_TIMEOUT_MS);
      child.on("error", (e) => { out += "\n" + e.message; });
      child.on("close", (code) => { clearTimeout(timer); session.child = null; done({ code, out }); });
    });
  }
  async function agentLoop(session) {
    if (session.busy) return;
    session.busy = true;
    const { emit } = session.out;
    emit("status", { status: "running" });
    let invalid = 0;
    try {
      for (let step = 0; step < AGENT_STEPS && !session.stopped; step += 1) {
        const reply = await api("/device/chat", { messages: session.messages });
        const cwu = cwuOf(reply.usage);
        if (cwu) emit("usage", { cwu });
        const text = String(reply.content || "");
        session.messages.push({ role: "assistant", content: text });
        let act = null;
        try { act = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { act = null; }
        if (!act || typeof act.action !== "string") {
          if (++invalid > 2) { emit("agent", { text }); break; }
          session.messages.push({ role: "user", content: "Reply with exactly one JSON object as described." });
          continue;
        }
        invalid = 0;
        if (act.thought) emit("agent", { text: String(act.thought).slice(0, 2000) });
        let result = "";
        try {
          if (act.action === "done") { emit("agent", { text: String(act.summary || "完成").slice(0, 8000), final: true }); session.finished = true; break; }
          if (act.action === "list") {
            const target = insideFolder(session.folder, act.path, { mustExist: true });
            result = readdirSync(target, { withFileTypes: true }).slice(0, 300).map((e) => e.name + (e.isDirectory() ? "/" : "")).join("\n") || "(empty)";
            emit("tool", { action: "list", path: act.path || "." });
          } else if (act.action === "read") {
            const target = insideFolder(session.folder, act.path, { mustExist: true });
            if (statSync(target).size > 400_000) throw new Error("文件太大（超过 400 KB）");
            result = readFileSync(target, "utf8").slice(0, 40_000);
            emit("tool", { action: "read", path: act.path });
          } else if (act.action === "write") {
            const target = insideFolder(session.folder, act.path);
            const content = String(act.content ?? "");
            const ok = session.autoApprove || await waitApproval(session, { action: "write", path: act.path, preview: content.slice(0, 4000), bytes: content.length });
            emit("status", { status: "running" });
            if (session.stopped) break;
            if (!ok) result = "The user rejected this write.";
            else { mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content); result = "Written " + content.length + " characters."; emit("tool", { action: "write", path: act.path, bytes: content.length }); }
          } else if (act.action === "run") {
            const command = String(act.command || "").slice(0, 4000);
            const ok = session.autoApprove || await waitApproval(session, { action: "run", command });
            emit("status", { status: "running" });
            if (session.stopped) break;
            if (!ok) result = "The user rejected this command.";
            else { emit("tool", { action: "run", command }); const r = await runCapture(session, command); result = "Exit code " + r.code + "\n" + r.out; emit("exit", { code: r.code }); }
          } else result = "Unknown action " + act.action;
        } catch (error) { result = "Error: " + (error instanceof Error ? error.message : String(error)); emit("stderr", { text: result + "\n" }); }
        session.messages.push({ role: "user", content: "RESULT of " + act.action + ":\n" + result.slice(0, 40_000) });
      }
      emit("status", { status: session.stopped ? "stopped" : "idle" });
    } catch (error) {
      emit("stderr", { text: "任务出错：" + (error instanceof Error ? error.message : String(error)) + "\n" });
      emit("status", { status: "failed" });
    } finally { session.busy = false; void session.out.flush(); }
  }

  /* ── commands from the phone ── */
  function handle(item) {
    let session = sessions.get(item.sessionId);
    if (item.type === "start") {
      const { kind, folder, text, autoApprove } = item.payload;
      const info = { kind, title: String(text || "").split("\n")[0].slice(0, 80) };
      const out = emitter(item.sessionId, info);
      if (!config.folders.includes(folder) || !existsSync(folder)) { out.emit("stderr", { text: "这个文件夹不在本机允许的列表中。\n" }); out.emit("status", { status: "failed" }); void out.flush(); return; }
      session = { id: item.sessionId, kind, folder, autoApprove, out, approvals: new Map(), child: null, stopped: false, busy: false, startedAt: Date.now(), title: text.split("\n")[0].slice(0, 80),
        messages: [{ role: "system", content: AGENT_PROMPT(folder, process.platform) }, { role: "user", content: text }] };
      sessions.set(item.sessionId, session);
      if (kind === "shell") runShell(session, text); else void agentLoop(session);
      return;
    }
    if (!session) return;
    if (item.type === "stop") {
      session.stopped = true;
      killTree(session.child);
      session.approvals.forEach((fn) => fn(false)); session.approvals.clear();
      if (!session.child && !session.busy) { session.out.emit("status", { status: "stopped" }); void session.out.flush(); }
      return;
    }
    if (item.type === "approve") {
      const fn = session.approvals.get(item.payload.requestId);
      if (fn) { session.approvals.delete(item.payload.requestId); fn(Boolean(item.payload.approve)); }
      return;
    }
    if (item.type === "input") {
      const text = String(item.payload.text ?? "");
      session.stopped = false;
      if (session.kind === "shell") {
        if (session.child?.stdin?.writable) { session.child.stdin.write(text + "\n"); session.out.emit("stdin", { text }); }
        else runShell(session, text);
      } else {
        session.messages.push({ role: "user", content: text });
        void agentLoop(session);
      }
    }
  }

  async function loop(token) {
    let backoff = 2000, lastHello = 0;
    while (token === loopToken && config?.enabled) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 40_000);
      try {
        if (Date.now() - lastHello > 15_000) {
          await api("/device/hello", { folders: config.folders, version, name: config.name, enabled: true, active: [...sessions.keys()].filter((id) => { const s = sessions.get(id); return s.child || s.busy || s.approvals.size; }) });
          lastHello = Date.now();
          status = { online: true, lastError: "", lastContact: lastHello };
        }
        const { items } = await api("/device/inbox?wait=1", undefined, { signal: controller.signal });
        status = { online: true, lastError: "", lastContact: Date.now() };
        backoff = 2000;
        for (const item of items) { try { handle(item); } catch (e) { status.lastError = e.message; } }
      } catch (error) {
        if (token !== loopToken) break;
        status = { ...status, online: false, lastError: error.name === "AbortError" ? "" : String(error.message || error) };
        if (error.status === 401) { status.lastError = "这台电脑已被移除，请重新配对"; break; }
        if (error.name !== "AbortError") { await new Promise((r) => setTimeout(r, backoff)); backoff = Math.min(backoff * 2, 30_000); }
      } finally { clearTimeout(timer); }
    }
  }
  const restart = () => { loopToken += 1; status.online = false; if (config?.enabled && config.token) void loop(loopToken); };
  restart();

  /* ── local control API: this machine only, never cross-site ── */
  router.use((req, res, next) => {
    const addr = req.socket.remoteAddress || "";
    // Behind a reverse proxy every request arrives from 127.0.0.1: forwarded requests are never "local".
    const proxied = Boolean(req.get("x-forwarded-for") || req.get("forwarded") || req.get("x-real-ip"));
    const loopback = !proxied && localAllowed() && (addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1");
    const origin = req.get("origin");
    const sameOrigin = !origin || origin.replace(/^https?:\/\//, "") === req.get("host");
    if (!loopback || !sameOrigin) return res.status(403).json({ error: "只能在这台电脑上设置工作模式" });
    if (req.method !== "GET" && req.get("x-ciro-local") !== "1") return res.status(403).json({ error: "Missing local header" });
    next();
  });
  const view = () => ({ paired: Boolean(config?.token), serverUrl: config?.serverUrl || "", name: config?.name || hostname(), account: config?.account || "", folders: config?.folders || [],
    enabled: Boolean(config?.enabled), online: status.online, lastError: status.lastError, lastContact: status.lastContact,
    active: [...sessions.values()].filter((s) => s.child || s.busy || s.approvals.size).map((s) => ({ id: s.id, kind: s.kind, folder: s.folder, title: s.title, startedAt: s.startedAt })) });
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => res.status(e.statusCode || 400).json({ error: e.message }));
  router.get("/status", (_req, res) => res.json(view()));
  // Or: enter the 8-character code a phone made under 协作空间 → 工作模式 → 添加电脑 (no password on this computer).
  router.post("/pair", wrap(async (req, res) => {
    const serverUrl = String(req.body?.serverUrl || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/]+/.test(serverUrl)) throw new Error("请输入服务器地址，例如 https://ciro.example.com");
    const name = String(req.body?.name || hostname()).trim().slice(0, 60) || hostname();
    const reply = await fetchFn(serverUrl + "/api/remote/pair", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: String(req.body?.code || "").trim(), name, platform: process.platform, version }) });
    const data = await reply.json().catch(() => ({}));
    if (!reply.ok) throw new Error(data.error || "配对失败（HTTP " + reply.status + "）");
    config = { serverUrl, deviceId: data.deviceId, token: data.token, name, account: "", folders: config?.folders || [], enabled: true };
    save(); restart();
    res.json(view());
  }));
  // Sign in once with the Ciro account to add this computer; only the device token is kept, never the password.
  router.post("/login", wrap(async (req, res) => {
    const serverUrl = String(req.body?.serverUrl || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\/[^\s/]+/.test(serverUrl)) throw new Error("请输入服务器地址，例如 https://ciro.example.com");
    const name = String(req.body?.name || hostname()).trim().slice(0, 60) || hostname();
    const email = String(req.body?.email || "").trim();
    const login = await fetchFn(serverUrl + "/api/account/login", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: String(req.body?.password || "") }) });
    const auth = await login.json().catch(() => ({}));
    if (!login.ok) throw new Error(login.status === 401 ? "邮箱或密码不正确" : auth.error || "登录失败（HTTP " + login.status + "）");
    const setCookie = (login.headers.getSetCookie?.() || [login.headers.get("set-cookie") || ""]).find(Boolean) || "";
    const headers = { "Content-Type": "application/json", Cookie: setCookie.split(";")[0], "X-Ciro-Csrf": String(auth.csrf || "") };
    const reg = await fetchFn(serverUrl + "/api/remote/devices/register", { method: "POST", headers, body: JSON.stringify({ name, platform: process.platform, version }) });
    const data = await reg.json().catch(() => ({}));
    await fetchFn(serverUrl + "/api/account/logout", { method: "POST", headers, body: "{}" }).catch(() => undefined);
    if (!reg.ok) throw new Error(data.error || "无法添加这台电脑（HTTP " + reg.status + "）");
    config = { serverUrl, deviceId: data.deviceId, token: data.token, name, account: email, folders: config?.folders || [], enabled: true };
    save(); restart();
    res.json(view());
  }));
  // QR code for phones of the same account: scanning it authorizes that phone to control this computer.
  router.get("/qr", wrap(async (_req, res) => {
    if (!config?.token) throw new Error("请先登录");
    const code = await api("/device/connect-code");
    res.json({ ...code, url: config.serverUrl + "/remote/connect?device=" + encodeURIComponent(code.deviceId) + "&nonce=" + encodeURIComponent(code.nonce) });
  }));
  router.get("/grants", wrap(async (_req, res) => {
    if (!config?.token) throw new Error("请先登录");
    res.json(await api("/device/grants"));
  }));
  router.post("/grants/revoke", wrap(async (req, res) => {
    if (!config?.token) throw new Error("请先登录");
    res.json(await api("/device/grants/revoke", { id: String(req.body?.id || "") }));
  }));
  router.post("/folders", wrap((req, res) => {
    if (!config) throw new Error("请先配对");
    const list = Array.isArray(req.body?.folders) ? req.body.folders : [];
    const folders = [...new Set(list.map((f) => {
      const p = String(f || "").trim();
      if (!isAbsolute(p) || !existsSync(p) || !statSync(p).isDirectory()) throw new Error("不是有效的文件夹：" + p);
      return realpathSync(p);
    }))].slice(0, 30);
    config.folders = folders; save(); restart();
    res.json(view());
  }));
  router.post("/enabled", wrap((req, res) => {
    if (!config) throw new Error("请先配对");
    config.enabled = Boolean(req.body?.enabled);
    if (!config.enabled) for (const s of sessions.values()) handle({ sessionId: s.id, type: "stop", payload: {} });
    save(); restart();
    res.json(view());
  }));
  router.post("/unpair", wrap((_req, res) => {
    for (const s of sessions.values()) handle({ sessionId: s.id, type: "stop", payload: {} });
    loopToken += 1; config = null; status = { online: false, lastError: "", lastContact: 0 };
    rmSync(file, { force: true });
    res.json(view());
  }));
  return { router, stop: () => { loopToken += 1; for (const s of sessions.values()) killTree(s.child); } };
}

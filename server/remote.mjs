// Work mode relay. A Ciro on a computer (desktop app / ciro-client) signs in to the account and keeps an
// outbound long-poll connection here. Every signed-in device of the same account can SEE it, but a phone
// may only CONTROL it after scanning the QR code shown on that computer (a grant for the phone's session).
// The server queues commands and keeps the event log; the computer decides what it may run.
import express from "express";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const ONLINE_MS = 45_000;
const WAIT_MS = 25_000;
const LIMITS = { devices: 20, sessions: 300, eventsPerSession: 6000, chunk: 32_000, text: 20_000, batch: 200 };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const bad = (message, status = 400) => Object.assign(new Error(message), { statusCode: status });

export function createRemoteStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, "remote.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT, platform TEXT, token_hash TEXT UNIQUE, created_at INTEGER,
      last_seen INTEGER, folders TEXT, version TEXT, enabled INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, device_id TEXT, kind TEXT, folder TEXT, title TEXT, status TEXT,
      auto_approve INTEGER, created_at INTEGER, updated_at INTEGER, last_seq INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS events(session_id TEXT, seq INTEGER, at INTEGER, type TEXT, data TEXT, PRIMARY KEY(session_id, seq));
    CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT, session_id TEXT, type TEXT, payload TEXT, delivered INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS grants(device_id TEXT, controller TEXT, label TEXT, created_at INTEGER, PRIMARY KEY(device_id, controller));`);
  // Rows belong to an account so the same relay can serve many users.
  for (const table of ["devices", "sessions"]) { try { db.exec("ALTER TABLE " + table + " ADD COLUMN user_id TEXT"); } catch { /* already there */ } }
  return db;
}

function rowDevice(r, now = Date.now(), connected = false) {
  return { id: r.id, connected, name: r.name, platform: r.platform, createdAt: r.created_at, lastSeen: r.last_seen,
    online: Boolean(r.enabled) && now - Number(r.last_seen || 0) < ONLINE_MS, folders: JSON.parse(r.folders || "[]"), version: r.version || "",
    enabled: Boolean(r.enabled) };
}
function rowSession(r) {
  return { id: r.id, deviceId: r.device_id, kind: r.kind, folder: r.folder, title: r.title, status: r.status,
    autoApprove: Boolean(r.auto_approve), createdAt: r.created_at, updatedAt: r.updated_at, lastSeq: Number(r.last_seq) };
}

/**
 * @param {{dir:string, enabled:()=>boolean, complete:(messages:{role:string,content:string}[])=>Promise<{content:string,usage?:object}>}} options
 */
export function createRemoteRouter({ dir, enabled, complete }) {
  const db = createRemoteStore(dir);
  const router = express.Router();
  const nonces = new Map(); // QR nonce or 8-character code shown on a computer -> { deviceId, exp }
  const pairing = new Map(); // 8-character code made on a phone -> { userId, controller, label, exp }
  const newCode = () => Array.from(randomBytes(8), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
  const grant = (deviceId, controller, who) => db.prepare("INSERT OR REPLACE INTO grants(device_id,controller,label,created_at) VALUES(?,?,?,?)").run(deviceId, controller, who, Date.now());
  const waiters = new Map();
  const wake = (key) => { const set = waiters.get(key); if (!set) return; waiters.delete(key); set.forEach((fn) => fn()); };
  const waitFor = (key, ms, req) => new Promise((resolve) => {
    const set = waiters.get(key) ?? new Set();
    const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
    const timer = setTimeout(done, ms);
    set.add(done); waiters.set(key, set);
    req.on("close", done);
  });
  const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => res.status(e.statusCode || 400).json({ error: e.message || "Request failed" }));
  const requireUser = (req) => {
    if (!enabled()) throw bad("工作模式需要服务器开启账户（CIRO_ACCOUNTS_ENABLED=true）", 503);
    if (!req.principal || req.principal.mode === "local") throw bad("Please sign in", 401);
    if (req.principal.mode === "api-key") throw bad("A browser session is required", 403);
  };
  const deviceFrom = (req) => {
    const auth = req.get("authorization") || "";
    if (!auth.startsWith("Bearer ciro_dev_")) throw bad("Device token required", 401);
    const row = db.prepare("SELECT * FROM devices WHERE token_hash=?").get(hash(auth.slice(7)));
    if (!row) throw bad("Unknown or revoked device", 401);
    return row;
  };
  const appendEvents = (sessionId, events) => {
    const session = db.prepare("SELECT * FROM sessions WHERE id=?").get(sessionId);
    if (!session) throw bad("Unknown session", 404);
    let seq = Number(session.last_seq);
    const now = Date.now();
    const insert = db.prepare("INSERT INTO events(session_id,seq,at,type,data) VALUES(?,?,?,?,?)");
    db.exec("BEGIN");
    try {
      for (const e of events) {
        seq += 1;
        insert.run(sessionId, seq, now, String(e.type).slice(0, 40), JSON.stringify(e.data ?? {}).slice(0, LIMITS.chunk + 2000));
      }
      const status = [...events].reverse().find((e) => e.type === "status")?.data?.status;
      db.prepare("UPDATE sessions SET last_seq=?, updated_at=?" + (status ? ", status=?" : "") + " WHERE id=?")
        .run(...(status ? [seq, now, String(status).slice(0, 30), sessionId] : [seq, now, sessionId]));
      // Bound the log: drop the oldest events of very chatty sessions.
      db.prepare("DELETE FROM events WHERE session_id=? AND seq<=?").run(sessionId, seq - LIMITS.eventsPerSession);
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    wake("ses:" + sessionId);
    return seq;
  };
  const queue = (deviceId, sessionId, type, payload) => {
    db.prepare("INSERT INTO inbox(device_id,session_id,type,payload) VALUES(?,?,?,?)").run(deviceId, sessionId, type, JSON.stringify(payload ?? {}));
    wake("dev:" + deviceId);
  };
  const ownSession = (id, userId) => {
    const s = db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
    if (!s || (userId !== undefined && s.user_id !== userId)) throw bad("Unknown session", 404);
    return s;
  };
  const ownDevice = (req, id) => {
    const d = db.prepare("SELECT * FROM devices WHERE id=? AND user_id=?").get(String(id || ""), req.principal.id);
    if (!d) throw bad("Unknown computer", 404);
    return d;
  };
  // Seeing a computer needs only the same account; controlling it needs this phone's QR authorization.
  const isConnected = (req, deviceId) => Boolean(db.prepare("SELECT 1 FROM grants WHERE device_id=? AND controller=?").get(deviceId, req.principal.sessionId));
  const requireConnected = (req, deviceId) => { if (!isConnected(req, deviceId)) throw bad("请先扫码连接这台电脑", 403); };
  const label = (req) => {
    const ua = req.get("user-agent") || "";
    const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "设备";
    return (/CiroMobile/.test(ua) ? "Ciro App · " : "") + os;
  };

  /* ── User side (signed-in phone / browser) ── */
  // A signed-in Ciro (desktop app / ciro-client) adds itself to the account and gets a device token.
  router.post("/devices/register", wrap((req, res) => {
    requireUser(req);
    if (db.prepare("SELECT COUNT(*) n FROM devices WHERE user_id=?").get(req.principal.id).n >= LIMITS.devices) throw bad("最多添加 20 台电脑", 409);
    const id = randomUUID(), token = "ciro_dev_" + randomBytes(32).toString("base64url"), now = Date.now();
    db.prepare("INSERT INTO devices(id,user_id,name,platform,token_hash,created_at,last_seen,folders,version) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, req.principal.id, String(req.body?.name || "电脑").slice(0, 60), String(req.body?.platform || "").slice(0, 20), hash(token), now, now, "[]", String(req.body?.version || "").slice(0, 20));
    res.status(201).json({ deviceId: id, token });
  }));
  router.get("/devices", wrap((req, res) => {
    requireUser(req);
    res.json({ devices: db.prepare("SELECT * FROM devices WHERE user_id=? ORDER BY created_at").all(req.principal.id).map((r) => rowDevice(r, Date.now(), isConnected(req, r.id))) });
  }));
  router.delete("/devices/:id", wrap((req, res) => {
    requireUser(req);
    const d = ownDevice(req, req.params.id);
    db.prepare("DELETE FROM devices WHERE id=?").run(d.id);
    db.prepare("DELETE FROM inbox WHERE device_id=?").run(d.id);
    db.prepare("DELETE FROM grants WHERE device_id=?").run(d.id);
    wake("dev:" + d.id);
    res.json({ deleted: true });
  }));
  // Scanning the computer's QR code authorizes THIS phone (its signed-in session) to control the computer.
  router.post("/devices/:id/connect", wrap((req, res) => {
    requireUser(req);
    const d = ownDevice(req, req.params.id);
    const key = String(req.body?.nonce || req.body?.code || "").trim();
    const entry = nonces.get(key) ?? nonces.get(key.toUpperCase());
    if (!entry || entry.deviceId !== d.id || entry.exp < Date.now()) throw bad("二维码或配对码已过期，请在电脑上刷新后重试", 403);
    for (const [k, e] of nonces) if (e === entry) nonces.delete(k);
    grant(d.id, req.principal.sessionId, label(req));
    wake("dev:" + d.id);
    res.json({ device: rowDevice(db.prepare("SELECT * FROM devices WHERE id=?").get(d.id), Date.now(), true) });
  }));
  // Typing the 8-character code shown under the computer's QR code works like scanning it.
  router.post("/connect", wrap((req, res) => {
    requireUser(req);
    const code = String(req.body?.code || "").trim().toUpperCase();
    const entry = nonces.get(code);
    const d = entry && entry.exp >= Date.now() ? db.prepare("SELECT * FROM devices WHERE id=? AND user_id=?").get(entry.deviceId, req.principal.id) : null;
    if (!d) throw bad("配对码无效或已过期，请在电脑上刷新后重试", 403);
    for (const [k, e] of nonces) if (e === entry) nonces.delete(k);
    grant(d.id, req.principal.sessionId, label(req));
    wake("dev:" + d.id);
    res.json({ device: rowDevice(d, Date.now(), true) });
  }));
  // Other direction: a phone makes a code, the computer types it in (no password needed on the computer).
  router.post("/pairing-code", wrap((req, res) => {
    requireUser(req);
    if (db.prepare("SELECT COUNT(*) n FROM devices WHERE user_id=?").get(req.principal.id).n >= LIMITS.devices) throw bad("最多添加 20 台电脑", 409);
    const now = Date.now();
    for (const [c, e] of pairing) if (e.exp < now) pairing.delete(c);
    const code = newCode();
    pairing.set(code, { userId: req.principal.id, controller: req.principal.sessionId, label: label(req), exp: now + 10 * 60_000 });
    res.status(201).json({ code, expiresAt: now + 10 * 60_000 });
  }));
  router.post("/devices/:id/disconnect", wrap((req, res) => {
    requireUser(req);
    const d = ownDevice(req, req.params.id);
    db.prepare("DELETE FROM grants WHERE device_id=? AND controller=?").run(d.id, req.principal.sessionId);
    res.json({ connected: false });
  }));
  router.get("/sessions", wrap((req, res) => {
    requireUser(req);
    const rows = req.query.deviceId
      ? db.prepare("SELECT * FROM sessions WHERE device_id=? AND user_id=? ORDER BY updated_at DESC LIMIT 50").all(String(req.query.deviceId), req.principal.id)
      : db.prepare("SELECT * FROM sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 50").all(req.principal.id);
    res.json({ sessions: rows.map(rowSession) });
  }));
  router.post("/sessions", wrap((req, res) => {
    requireUser(req);
    const { deviceId, folder, kind, text, autoApprove } = req.body || {};
    const device = ownDevice(req, deviceId);
    requireConnected(req, device.id);
    if (!["shell", "agent"].includes(kind)) throw bad("Invalid mode");
    if (typeof text !== "string" || !text.trim() || text.length > LIMITS.text) throw bad("Command must contain 1-20000 characters");
    if (typeof folder !== "string" || !JSON.parse(device.folders || "[]").includes(folder)) throw bad("这个文件夹没有在电脑上被允许");
    const id = randomUUID(), now = Date.now();
    db.prepare("INSERT INTO sessions(id,user_id,device_id,kind,folder,title,status,auto_approve,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, req.principal.id, device.id, kind, folder, text.trim().split("\n")[0].slice(0, 120), "queued", autoApprove ? 1 : 0, now, now);
    appendEvents(id, [{ type: "user", data: { text: text.trim() } }, { type: "status", data: { status: "queued" } }]);
    queue(device.id, id, "start", { kind, folder, text: text.trim(), autoApprove: Boolean(autoApprove) });
    const old = db.prepare("SELECT id FROM sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT -1 OFFSET ?").all(req.principal.id, LIMITS.sessions);
    for (const o of old) { db.prepare("DELETE FROM events WHERE session_id=?").run(o.id); db.prepare("DELETE FROM sessions WHERE id=?").run(o.id); }
    res.status(201).json({ session: rowSession(db.prepare("SELECT * FROM sessions WHERE id=?").get(id)) });
  }));
  router.get("/sessions/:id/events", wrap(async (req, res) => {
    requireUser(req);
    const after = Number(req.query.after || 0);
    const read = () => db.prepare("SELECT seq,at,type,data FROM events WHERE session_id=? AND seq>? ORDER BY seq LIMIT 500").all(req.params.id, after);
    let session = ownSession(req.params.id, req.principal.id);
    let rows = read();
    if (!rows.length && req.query.wait) { await waitFor("ses:" + req.params.id, WAIT_MS, req); rows = read(); session = ownSession(req.params.id, req.principal.id); }
    res.json({ session: rowSession(session), events: rows.map((r) => ({ seq: Number(r.seq), at: Number(r.at), type: r.type, data: JSON.parse(r.data) })) });
  }));
  for (const [path, type] of [["input", "input"], ["approve", "approve"], ["stop", "stop"]]) {
    router.post("/sessions/:id/" + path, wrap((req, res) => {
      requireUser(req);
      const s = ownSession(req.params.id, req.principal.id);
      requireConnected(req, s.device_id);
      const body = req.body || {};
      if (type === "input" && (typeof body.text !== "string" || body.text.length > LIMITS.text)) throw bad("Invalid input");
      if (type === "approve" && (typeof body.requestId !== "string" || typeof body.approve !== "boolean")) throw bad("Invalid approval");
      if (type === "input") appendEvents(s.id, [{ type: "user", data: { text: body.text } }]);
      if (type === "approve") appendEvents(s.id, [{ type: "approval_result", data: { requestId: body.requestId, approve: body.approve } }]);
      queue(s.device_id, s.id, type, body);
      res.json({ queued: true });
    }));
  }

  /* ── Computer side (device token) ── */
  // QR code payload for the computer's screen: a single-use nonce, valid for two minutes.
  router.get("/device/connect-code", wrap((req, res) => {
    const d = deviceFrom(req);
    const now = Date.now();
    for (const [n, e] of nonces) if (e.exp < now || e.deviceId === d.id) nonces.delete(n);
    const nonce = randomBytes(18).toString("base64url"), code = newCode();
    const entry = { deviceId: d.id, exp: now + 120_000 };
    nonces.set(nonce, entry); nonces.set(code, entry);
    res.json({ deviceId: d.id, nonce, code, expiresAt: entry.exp });
  }));
  router.post("/pair", wrap((req, res) => {
    if (!enabled()) throw bad("工作模式需要服务器开启账户", 503);
    const code = String(req.body?.code || "").trim().toUpperCase();
    const entry = pairing.get(code);
    if (!entry || entry.exp < Date.now()) throw bad("配对码无效或已过期", 403);
    pairing.delete(code);
    const id = randomUUID(), token = "ciro_dev_" + randomBytes(32).toString("base64url"), now = Date.now();
    db.prepare("INSERT INTO devices(id,user_id,name,platform,token_hash,created_at,last_seen,folders,version) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, entry.userId, String(req.body?.name || "电脑").slice(0, 60), String(req.body?.platform || "").slice(0, 20), hash(token), now, now, "[]", String(req.body?.version || "").slice(0, 20));
    grant(id, entry.controller, entry.label); // the phone that made the code is connected right away
    res.status(201).json({ deviceId: id, token });
  }));
  router.get("/device/grants", wrap((req, res) => {
    const d = deviceFrom(req);
    res.json({ grants: db.prepare("SELECT controller,label,created_at FROM grants WHERE device_id=? ORDER BY created_at").all(d.id)
      .map((g) => ({ id: hash(g.controller).slice(0, 16), label: g.label, createdAt: Number(g.created_at) })) });
  }));
  router.post("/device/grants/revoke", wrap((req, res) => {
    const d = deviceFrom(req);
    const target = String(req.body?.id || "");
    for (const g of db.prepare("SELECT controller FROM grants WHERE device_id=?").all(d.id)) {
      if (target === "all" || hash(g.controller).slice(0, 16) === target) db.prepare("DELETE FROM grants WHERE device_id=? AND controller=?").run(d.id, g.controller);
    }
    res.json({ ok: true });
  }));
  router.post("/device/hello", wrap((req, res) => {
    const d = deviceFrom(req);
    const folders = Array.isArray(req.body?.folders) ? req.body.folders.filter((f) => typeof f === "string" && f.length < 500).slice(0, 30) : [];
    db.prepare("UPDATE devices SET last_seen=?, folders=?, version=?, enabled=?, name=COALESCE(?, name) WHERE id=?")
      .run(Date.now(), JSON.stringify(folders), String(req.body?.version || "").slice(0, 20), req.body?.enabled === false ? 0 : 1,
        typeof req.body?.name === "string" ? req.body.name.slice(0, 60) : null, d.id);
    // Sessions the computer no longer runs (restart, crash) are marked interrupted.
    const active = new Set(Array.isArray(req.body?.active) ? req.body.active : []);
    for (const s of db.prepare("SELECT id, updated_at FROM sessions WHERE device_id=? AND status IN ('running','waiting')").all(d.id)) {
      if (!active.has(s.id) && Date.now() - Number(s.updated_at) > 15_000) appendEvents(s.id, [{ type: "status", data: { status: "interrupted" } }]);
    }
    res.json({ deviceId: d.id });
  }));
  router.get("/device/inbox", wrap(async (req, res) => {
    let d = deviceFrom(req);
    const take = () => {
      const rows = db.prepare("SELECT * FROM inbox WHERE device_id=? AND delivered=0 ORDER BY id LIMIT 50").all(d.id);
      if (rows.length) db.prepare("UPDATE inbox SET delivered=1 WHERE id IN (" + rows.map(() => "?").join(",") + ")").run(...rows.map((r) => r.id));
      return rows.map((r) => ({ id: Number(r.id), sessionId: r.session_id, type: r.type, payload: JSON.parse(r.payload) }));
    };
    db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(Date.now(), d.id);
    let items = take();
    if (!items.length && req.query.wait) { await waitFor("dev:" + d.id, WAIT_MS, req); d = deviceFrom(req); items = take(); }
    db.prepare("UPDATE devices SET last_seen=? WHERE id=?").run(Date.now(), d.id);
    db.prepare("DELETE FROM inbox WHERE delivered=1 AND id < (SELECT COALESCE(MAX(id),0)-500 FROM inbox)").run();
    res.json({ items });
  }));
  router.post("/device/events", wrap((req, res) => {
    const d = deviceFrom(req);
    const { sessionId, events } = req.body || {};
    const s = ownSession(String(sessionId || ""));
    if (s.device_id !== d.id) throw bad("Session belongs to another computer", 403);
    if (!Array.isArray(events) || !events.length || events.length > LIMITS.batch) throw bad("Invalid events");
    res.json({ seq: appendEvents(s.id, events.map((e) => ({ type: e?.type, data: e?.data }))) });
  }));
  router.post("/device/chat", wrap(async (req, res) => {
    deviceFrom(req);
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || !messages.length || messages.length > 120) throw bad("Invalid messages");
    const clean = messages.map((m) => ({ role: ["system", "user", "assistant"].includes(m?.role) ? m.role : "user", content: String(m?.content ?? "").slice(0, 60_000) }));
    res.json(await complete(clean));
  }));
  return router;
}

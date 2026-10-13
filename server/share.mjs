// Read-only shared conversation snapshots, stored next to the other runtime state.
import express from "express";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAX_SHARES = 500;
const MAX_MESSAGES = 200;
const MAX_CHARS = 400_000;
const ID = /^[A-Za-z0-9_-]{16,40}$/;

export class ShareError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function validateShare(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ShareError("Invalid share payload");
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 120) : "";
  if (!title) throw new ShareError("A title is required");
  if (!Array.isArray(input.messages) || input.messages.length < 1 || input.messages.length > MAX_MESSAGES)
    throw new ShareError("A shared conversation needs 1-200 messages");
  let chars = 0;
  const messages = input.messages.map((m) => {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") throw new ShareError("Invalid message");
    chars += m.content.length;
    return { role: m.role, content: m.content };
  });
  if (chars > MAX_CHARS) throw new ShareError("Conversation is too large to share", 413);
  return { title, messages };
}

export function createShareStore(dir) {
  const folder = dir || process.env.CIRO_WORKSPACE_DATA_DIR || join(process.cwd(), ".ciro-runtime");
  const file = join(folder, "shares.json");
  let cache = null;
  function read() {
    if (cache) return cache;
    try { cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; } catch { cache = {}; }
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) cache = {};
    return cache;
  }
  function write() {
    mkdirSync(folder, { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(cache), { mode: 0o600 });
    renameSync(tmp, file);
  }
  return {
    create(snapshot, owner) {
      const all = read();
      if (Object.keys(all).length >= MAX_SHARES) throw new ShareError("Share limit reached; delete old links first", 409);
      const id = randomBytes(18).toString("base64url");
      all[id] = { ...snapshot, owner: owner || "local", createdAt: new Date().toISOString() };
      write();
      return id;
    },
    get(id) { return ID.test(id) ? read()[id] || null : null; },
    remove(id, owner) {
      const all = read();
      const entry = ID.test(id) ? all[id] : null;
      if (!entry) return false;
      if (entry.owner !== (owner || "local")) throw new ShareError("Not allowed", 403);
      delete all[id];
      write();
      return true;
    }
  };
}

/** Public read route must be mounted before the account guard; write routes after it. */
export function createShareRouters(store = createShareStore()) {
  const publicRouter = express.Router();
  publicRouter.get("/:id", (req, res) => {
    const entry = store.get(req.params.id);
    if (!entry) return res.status(404).json({ error: "Shared conversation not found" });
    res.set("Cache-Control", "no-store").json({ title: entry.title, messages: entry.messages, createdAt: entry.createdAt });
  });
  const privateRouter = express.Router();
  const fail = (res, error) => res.status(error instanceof ShareError ? error.status : 500).json({ error: error.message });
  privateRouter.post("/", (req, res) => {
    try { res.status(201).json({ id: store.create(validateShare(req.body), req.principal?.id) }); }
    catch (error) { fail(res, error); }
  });
  privateRouter.delete("/:id", (req, res) => {
    try { res.json({ deleted: store.remove(req.params.id, req.principal?.id) }); }
    catch (error) { fail(res, error); }
  });
  return { publicRouter, privateRouter };
}

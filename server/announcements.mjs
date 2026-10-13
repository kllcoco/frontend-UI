// Announcements pushed to apps that are already installed (new plans, notices, maintenance), without an app update.
// Two sources, merged:
//   1. this server's own list, edited by the owner in Settings → 公告推送 (stored in announcements.json)
//   2. a central feed (CIRO_ANNOUNCEMENTS_URL, default: announcements.json on the project's main branch;
//      "off" disables it) so every install — including desktop apps running their own local server — sees it.
// Items are plain text plus an optional https link; nothing is executed or rendered as HTML.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";

const DEFAULT_FEED = "https://raw.githubusercontent.com/kllcoco/frontend-UI/main/announcements.json";
const LEVELS = new Set(["info", "promo", "warning"]);
const PLATFORMS = new Set(["web", "desktop", "android"]);
const FEED_TTL = 10 * 60 * 1000;

const text = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";
const time = (v) => { const t = typeof v === "string" && v ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const version = (v) => typeof v === "string" && /^\d+(\.\d+){0,3}$/.test(v.trim()) ? v.trim() : null;

/** Validates one announcement; returns null when it is unusable. */
export function cleanAnnouncement(raw, source) {
  if (!raw || typeof raw !== "object") return null;
  const title = text(raw.title, 80), body = text(raw.body, 600);
  if (!title) return null;
  const url = text(raw.link?.url, 500);
  const link = /^https:\/\/[^\s]+$/i.test(url) ? { label: text(raw.link?.label, 24) || "查看详情", url } : null;
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.filter((p) => PLATFORMS.has(p)) : [];
  return {
    id: (text(raw.id, 60).replace(/[^A-Za-z0-9_-]/g, "") || randomUUID().slice(0, 12)),
    title, body, level: LEVELS.has(raw.level) ? raw.level : "info", link,
    platforms: platforms.length ? platforms : null,
    minVersion: version(raw.minVersion), maxVersion: version(raw.maxVersion),
    start: time(raw.start), end: time(raw.end), source
  };
}

function newer(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
/** Whether an announcement applies to this app right now. */
export function applies(a, { platform, appVersion, now = new Date() }) {
  if (a.platforms && !a.platforms.includes(platform)) return false;
  if (a.minVersion && appVersion && newer(a.minVersion, appVersion)) return false;
  if (a.maxVersion && appVersion && newer(appVersion, a.maxVersion)) return false;
  if (a.start && now < new Date(a.start)) return false;
  if (a.end && now > new Date(a.end)) return false;
  return true;
}

export function createAnnouncements({ dir, env = process.env, fetchFn = fetch, canEdit }) {
  const file = join(dir, "announcements.json");
  let local = [];
  try { if (existsSync(file)) local = (JSON.parse(readFileSync(file, "utf8")) || []).map((x) => cleanAnnouncement(x, "server")).filter(Boolean); } catch { local = []; }
  const save = () => { mkdirSync(dir, { recursive: true }); writeFileSync(file + ".tmp", JSON.stringify(local, null, 2), { mode: 0o600 }); renameSync(file + ".tmp", file); };
  const feedUrl = (env.CIRO_ANNOUNCEMENTS_URL ?? DEFAULT_FEED).trim();
  let feed = { at: 0, items: [] };

  async function central() {
    if (!feedUrl || feedUrl === "off" || !/^https:\/\//i.test(feedUrl)) return [];
    if (Date.now() - feed.at < FEED_TTL) return feed.items;
    try {
      const r = await fetchFn(feedUrl, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
      const data = r.ok ? await r.json() : [];
      const list = Array.isArray(data) ? data : Array.isArray(data?.announcements) ? data.announcements : [];
      feed = { at: Date.now(), items: list.slice(0, 20).map((x) => cleanAnnouncement(x, "central")).filter(Boolean) };
    } catch { feed = { at: Date.now(), items: feed.items }; } // offline: keep the last good copy
    return feed.items;
  }

  const router = express.Router();
  router.get("/", async (req, res) => {
    const platform = PLATFORMS.has(req.query.platform) ? req.query.platform : "web";
    const appVersion = version(String(req.query.version || "")) || "";
    const items = [...local, ...await central()].filter((a) => applies(a, { platform, appVersion })).slice(0, 10);
    res.set("Cache-Control", "no-store").json({ announcements: items, editable: Boolean(canEdit(req)), all: canEdit(req) ? local : undefined });
  });
  router.post("/", (req, res) => {
    if (!canEdit(req)) return res.status(403).json({ error: "只有服务器所有者可以发布公告" });
    const item = cleanAnnouncement({ ...req.body, id: req.body?.id || undefined }, "server");
    if (!item) return res.status(400).json({ error: "公告需要标题" });
    local = [item, ...local.filter((x) => x.id !== item.id)].slice(0, 30);
    save();
    res.status(201).json({ announcement: item });
  });
  router.delete("/:id", (req, res) => {
    if (!canEdit(req)) return res.status(403).json({ error: "只有服务器所有者可以删除公告" });
    local = local.filter((x) => x.id !== req.params.id);
    save();
    res.json({ ok: true });
  });
  return { router };
}

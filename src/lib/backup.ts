/* Full local backup: every "ciro.*" setting/collection in localStorage, full-size images from IndexedDB
   and the custom wallpaper, in one JSON file. Restore can merge (keep both, newer copy wins per item)
   or replace everything on this device. */
import { allImages, putImage } from "./attachments";
import { loadCustomWallpaper, saveCustomWallpaper } from "./appearance";
import { suspendSaves } from "./storage";

export type Backup = {
  format: "ciro-backup"; version: 1; createdAt: string; app: string;
  storage: Record<string, string>; images: Record<string, string>; wallpaper: string | null;
};
export type BackupSummary = { conversations: number; projects: number; prompts: number; memories: number; images: number; wallpaper: boolean; createdAt: string };

// Device-specific bookkeeping that must not travel with a backup.
const SKIP = new Set(["ciro.sync.v2", "ciro.mobile.server.v1"]);
const COLLECTIONS: Record<string, "updatedAt" | "createdAt"> = {
  "ciro.chats.v1": "updatedAt", "ciro.projects.v1": "updatedAt", "ciro.prompts.v1": "createdAt", "ciro.memories.v1": "createdAt"
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
const count = (raw: string | undefined) => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v.length : 0; } catch { return 0; } };

export async function createBackup(appVersion: string): Promise<Backup> {
  const storage: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith("ciro.") && !SKIP.has(key)) storage[key] = localStorage.getItem(key) ?? "";
  }
  const wallpaperBlob = await loadCustomWallpaper().catch(() => null);
  return { format: "ciro-backup", version: 1, createdAt: new Date().toISOString(), app: appVersion,
    storage, images: await allImages(), wallpaper: wallpaperBlob ? await blobToDataUrl(wallpaperBlob) : null };
}

export function parseBackup(text: string): Backup {
  const value = JSON.parse(text) as Partial<Backup>;
  if (value?.format !== "ciro-backup" || value.version !== 1 || !value.storage || typeof value.storage !== "object")
    throw new Error("这不是 Ciro 备份文件");
  const storage: Record<string, string> = {};
  Object.entries(value.storage).forEach(([k, v]) => { if (k.startsWith("ciro.") && !SKIP.has(k) && typeof v === "string") storage[k] = v; });
  const images: Record<string, string> = {};
  Object.entries(value.images || {}).forEach(([k, v]) => { if (typeof v === "string" && v.startsWith("data:image/")) images[k] = v; });
  return { format: "ciro-backup", version: 1, createdAt: String(value.createdAt || ""), app: String(value.app || ""), storage, images,
    wallpaper: typeof value.wallpaper === "string" && value.wallpaper.startsWith("data:image/") ? value.wallpaper : null };
}

export function summarize(b: Backup): BackupSummary {
  return { conversations: count(b.storage["ciro.chats.v1"]), projects: count(b.storage["ciro.projects.v1"]), prompts: count(b.storage["ciro.prompts.v1"]),
    memories: count(b.storage["ciro.memories.v1"]), images: Object.keys(b.images).length, wallpaper: !!b.wallpaper, createdAt: b.createdAt };
}

function mergeList(current: string | null, incoming: string, stamp: "updatedAt" | "createdAt"): string {
  try {
    const mine = JSON.parse(current || "[]"), theirs = JSON.parse(incoming);
    if (!Array.isArray(mine) || !Array.isArray(theirs)) return incoming;
    const map = new Map<string, Record<string, unknown>>();
    for (const item of [...mine, ...theirs]) {
      if (!item || typeof item.id !== "string") continue;
      const prev = map.get(item.id);
      if (!prev || Number(item[stamp] || 0) > Number(prev[stamp] || 0)) map.set(item.id, item);
    }
    return JSON.stringify([...map.values()]);
  } catch { return incoming; }
}

/** Writes the backup into this device. Caller reloads the page afterwards. */
export async function restoreBackup(b: Backup, mode: "merge" | "replace"): Promise<void> {
  suspendSaves();
  // Forget sync bookkeeping so the next sync merges with the cloud instead of treating gaps as deletions.
  localStorage.removeItem("ciro.sync.v2");
  if (mode === "replace") {
    const old: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); if (k?.startsWith("ciro.") && !SKIP.has(k)) old.push(k); }
    old.forEach((k) => localStorage.removeItem(k));
  }
  Object.entries(b.storage).forEach(([key, value]) => {
    const stamp = COLLECTIONS[key];
    if (mode === "merge" && stamp) localStorage.setItem(key, mergeList(localStorage.getItem(key), value, stamp));
    else if (mode === "replace" || stamp || localStorage.getItem(key) === null) localStorage.setItem(key, value);
  });
  await Promise.all(Object.entries(b.images).map(([id, url]) => putImage(id, url)));
  if (b.wallpaper && (mode === "replace" || !(await loadCustomWallpaper().catch(() => null)))) {
    const blob = await (await fetch(b.wallpaper)).blob();
    await saveCustomWallpaper(new File([blob], "wallpaper", { type: blob.type })).catch(() => { /* unsupported type */ });
  }
}

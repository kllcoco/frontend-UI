/* Incremental cross-device sync (server: /api/account/sync/v2).
   Each conversation, project, saved prompt and the settings bundle is one item. The device remembers a
   hash of every item as last synced: a changed hash means a local edit to push, a missing item that was
   synced before means a local deletion (sent as a tombstone). Remote changes are pulled by revision.
   Conflicts: the newer modification time wins. */
import { accountApi, getAccountSession } from "./account-api";

export type SyncKind = "conversation" | "project" | "prompt" | "settings";
export type SyncItem = { kind: SyncKind; id: string; mtime: number; data: Record<string, unknown> };
type RemoteItem = { kind: SyncKind; id: string; rev: number; mtime: number; deleted: boolean; data: Record<string, unknown> | null };
type Known = Record<string, { h: string; m: number }>;
type SyncState = { owner: string; since: number; known: Known; dirtyAt: Record<string, number> };

export type SyncStatus = "off" | "local" | "unauthenticated" | "syncing" | "ready" | "error";
export type SyncSignal = { status: SyncStatus; lastSyncedAt: number | null; message: string; cloudCount: number | null; pushed: number; pulled: number };

export type SyncHost = {
  /** Current local items (from React state / storage). */
  collect: () => SyncItem[];
  /** Apply remote upserts and deletions for one kind. */
  apply: (kind: SyncKind, upserts: Record<string, unknown>[], deletedIds: string[]) => void;
  /** False while the app is mid-generation; sync waits. */
  idle: () => boolean;
};

const STATE_KEY = "ciro.sync.v2";
const ENABLED_KEY = "ciro.cloud.auto-sync.v1";
const PUSH_BYTES = 6_000_000;

let host: SyncHost | null = null;
let running: Promise<void> | null = null;
let again = false;
let interval: number | undefined;
let debounce: number | undefined;
let signal: SyncSignal = { status: "off", lastSyncedAt: null, message: "", cloudCount: null, pushed: 0, pulled: 0 };

function emit(patch: Partial<SyncSignal>) {
  signal = { ...signal, ...patch };
  window.dispatchEvent(new CustomEvent("ciro-sync", { detail: signal }));
}
export const syncSignal = () => signal;
/** On by default; the user can switch it off per device. */
export function syncEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) !== "false"; } catch { return true; }
}
export function setSyncEnabled(on: boolean) {
  try { localStorage.setItem(ENABLED_KEY, on ? "true" : "false"); } catch { /* ignore */ }
  if (on) void syncNow(); else emit({ status: "off", message: "" });
}

/** FNV-1a over the JSON text: cheap and stable enough to detect edits. */
export function hashOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + ":" + text.length.toString(36);
}

function loadState(owner: string): SyncState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || "null") as SyncState | null;
    // A different account on this device starts a fresh merge instead of deleting the other account's data.
    if (raw && raw.owner === owner && typeof raw.since === "number" && raw.known) return { ...raw, dirtyAt: raw.dirtyAt || {} };
  } catch { /* corrupt state: start over */ }
  return { owner, since: 0, known: {}, dirtyAt: {} };
}
function saveState(state: SyncState) {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* quota: next run re-merges */ }
}

async function runOnce(): Promise<void> {
  if (!host) return;
  if (!syncEnabled()) { emit({ status: "off" }); return; }
  const session = await getAccountSession();
  if (!session.enabled) { emit({ status: "local", message: "" }); return; }
  if (!session.authenticated || !session.user) { emit({ status: "unauthenticated", message: "" }); return; }
  if (!host.idle()) { again = true; return; }
  emit({ status: "syncing", message: "" });
  const state = loadState(session.user.id);
  const key = (kind: string, id: string) => kind + ":" + id;
  let pulled = 0, pushed = 0, cloudCount: number | null = null;

  // 1) Pull everything newer than our cursor.
  const localNow = () => new Map(host!.collect().map((item) => [key(item.kind, item.id), item]));
  let local = localNow();
  for (let page = 0; page < 100; page += 1) {
    const res = await accountApi<{ rev: number; more: boolean; count: number; items: RemoteItem[] }>("/sync/v2/changes?since=" + state.since);
    cloudCount = res.count;
    const byKind = new Map<SyncKind, { up: Record<string, unknown>[]; del: string[] }>();
    for (const item of res.items) {
      const k = key(item.kind, item.id);
      const mine = local.get(k);
      const known = state.known[k];
      const localDirty = mine ? hashOf(mine.data) !== known?.h : false;
      const localTime = mine ? (state.dirtyAt[k] ?? mine.mtime) : 0;
      if (mine && localDirty && localTime > item.mtime) continue; // our newer edit will be pushed
      if (item.deleted) {
        if (mine) { (byKind.get(item.kind) ?? byKind.set(item.kind, { up: [], del: [] }).get(item.kind)!).del.push(item.id); pulled += 1; }
        delete state.known[k]; delete state.dirtyAt[k];
      } else if (item.data) {
        if (!mine || hashOf(mine.data) !== hashOf(item.data)) {
          (byKind.get(item.kind) ?? byKind.set(item.kind, { up: [], del: [] }).get(item.kind)!).up.push(item.data);
          pulled += 1;
        }
        state.known[k] = { h: hashOf(item.data), m: item.mtime }; delete state.dirtyAt[k];
      }
    }
    byKind.forEach((change, kind) => host!.apply(kind, change.up, change.del));
    state.since = res.rev;
    saveState(state);
    if (!res.more) break;
    local = localNow();
  }

  // 2) Push local edits and deletions.
  local = localNow();
  const now = Date.now();
  const outgoing: { kind: SyncKind; id: string; mtime: number; deleted: boolean; data?: Record<string, unknown> }[] = [];
  local.forEach((item, k) => {
    const h = hashOf(item.data);
    if (state.known[k]?.h === h) return;
    // Items without their own timestamp (prompts, settings) get the time we first saw the edit.
    const mtime = item.kind === "conversation" || item.kind === "project" ? item.mtime : (state.dirtyAt[k] ??= now);
    outgoing.push({ kind: item.kind, id: item.id, mtime, deleted: false, data: item.data });
  });
  Object.keys(state.known).forEach((k) => {
    if (local.has(k)) return;
    const [kind, ...rest] = k.split(":");
    outgoing.push({ kind: kind as SyncKind, id: rest.join(":"), mtime: now, deleted: true });
  });
  let batch: typeof outgoing = [], bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const res = await accountApi<{ count: number; accepted: { key: string }[]; rejected: RemoteItem[] }>("/sync/v2/push", "POST", { items: batch });
    cloudCount = res.count;
    const accepted = new Set(res.accepted.map((a) => a.key));
    for (const sent of batch) {
      const k = key(sent.kind, sent.id);
      if (!accepted.has(k)) continue;
      if (sent.deleted) delete state.known[k]; else state.known[k] = { h: hashOf(sent.data), m: sent.mtime };
      delete state.dirtyAt[k];
      pushed += 1;
    }
    // The server holds a newer copy: take it.
    for (const remote of res.rejected) {
      const k = key(remote.kind, remote.id);
      if (remote.deleted) { host!.apply(remote.kind, [], [remote.id]); delete state.known[k]; }
      else if (remote.data) { host!.apply(remote.kind, [remote.data], []); state.known[k] = { h: hashOf(remote.data), m: remote.mtime }; }
      delete state.dirtyAt[k];
      pulled += 1;
    }
    saveState(state);
    batch = []; bytes = 0;
  };
  for (const item of outgoing) {
    const size = item.data ? JSON.stringify(item.data).length : 64;
    if (batch.length && (bytes + size > PUSH_BYTES || batch.length >= 150)) await flush();
    batch.push(item); bytes += size;
  }
  await flush();
  emit({ status: "ready", lastSyncedAt: Date.now(), message: "", cloudCount, pushed: signal.pushed + pushed, pulled: signal.pulled + pulled });
}

/** Run a sync now (coalesces concurrent requests). */
export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = runOnce()
    .catch((error) => { emit({ status: "error", message: error instanceof Error ? error.message : String(error) }); })
    .finally(() => {
      running = null;
      if (again) { again = false; window.setTimeout(() => void syncNow(), 1500); }
    });
  return running;
}
/** Local data changed: sync shortly. */
export function requestSync() {
  if (!host || !syncEnabled()) return;
  window.clearTimeout(debounce);
  debounce = window.setTimeout(() => void syncNow(), 2500);
}
export function startSync(next: SyncHost) {
  host = next;
  window.clearInterval(interval);
  interval = window.setInterval(() => { if (document.visibilityState === "visible") void syncNow(); }, 30_000);
  document.addEventListener("visibilitychange", onVisible);
  void syncNow();
}
export function stopSync() {
  host = null;
  window.clearInterval(interval);
  window.clearTimeout(debounce);
  document.removeEventListener("visibilitychange", onVisible);
}
function onVisible() { if (document.visibilityState === "visible") void syncNow(); }
/** Forget sync bookkeeping on this device (e.g. after signing out). Local data is kept. */
export function resetSyncState() {
  try { localStorage.removeItem(STATE_KEY); } catch { /* ignore */ }
}

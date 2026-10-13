/* Announcements pushed to installed apps without an update (new plans, notices). */
import { accountFetch } from "./account-api";

export type Announcement = { id: string; title: string; body: string; level: "info" | "promo" | "warning";
  link: { label: string; url: string } | null; platforms: string[] | null; minVersion: string | null; maxVersion: string | null;
  start: string | null; end: string | null; source: "server" | "central" };
const CENTRAL = "https://raw.githubusercontent.com/kllcoco/frontend-UI/main/announcements.json";
const DISMISSED = "ciro.announcements-dismissed.v1";

export function platform(): "web" | "desktop" | "android" {
  if ((window as unknown as { ciroDesktop?: unknown }).ciroDesktop) return "desktop";
  return /CiroMobile\//.test(navigator.userAgent) ? "android" : "web";
}
const newer = (a: string, b: string) => { const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
function applies(a: Partial<Announcement>, p: string, v: string) {
  const now = Date.now();
  return (!a.platforms?.length || a.platforms.includes(p)) && (!a.minVersion || !newer(a.minVersion, v)) && (!a.maxVersion || !newer(v, a.maxVersion)) &&
    (!a.start || Date.parse(a.start) <= now) && (!a.end || Date.parse(a.end) >= now);
}

/** From the Ciro server; the Android app's offline mode (no server) reads the central feed directly. */
export async function loadAnnouncements(): Promise<{ items: Announcement[]; editable: boolean; all?: Announcement[] }> {
  const p = platform(), v = __APP_VERSION__;
  try {
    const r = await accountFetch("/api/announcements?platform=" + p + "&version=" + encodeURIComponent(v));
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) {
      const j = await r.json() as { announcements: Announcement[]; editable: boolean; all?: Announcement[] };
      return { items: j.announcements, editable: j.editable, all: j.all };
    }
  } catch { /* no server: fall through */ }
  if (p !== "android") return { items: [], editable: false };
  const r = await fetch(CENTRAL, { cache: "no-store" });
  const list = r.ok ? await r.json() as Partial<Announcement>[] : [];
  return { items: (Array.isArray(list) ? list : []).filter((a) => a.id && a.title && applies(a, p, v)).slice(0, 10).map((a) => ({
    id: String(a.id), title: String(a.title).slice(0, 80), body: String(a.body || "").slice(0, 600), level: a.level === "promo" || a.level === "warning" ? a.level : "info",
    link: a.link && /^https:\/\//i.test(String(a.link.url)) ? { label: String(a.link.label || "查看详情").slice(0, 24), url: String(a.link.url) } : null,
    platforms: null, minVersion: null, maxVersion: null, start: null, end: null, source: "central" as const })), editable: false };
}
export function dismissed(): string[] { try { return JSON.parse(localStorage.getItem(DISMISSED) || "[]") as string[]; } catch { return []; } }
export function dismiss(id: string): void { try { localStorage.setItem(DISMISSED, JSON.stringify([...dismissed(), id].slice(-200))); } catch { /* ignore */ } }
export async function publishAnnouncement(a: Partial<Announcement>): Promise<void> {
  const r = await accountFetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || "HTTP " + r.status);
}
export async function removeAnnouncement(id: string): Promise<void> {
  await accountFetch("/api/announcements/" + encodeURIComponent(id), { method: "DELETE" });
}

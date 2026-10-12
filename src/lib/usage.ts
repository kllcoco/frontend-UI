/* Usage in Ciro's native units: CWU (compute work units) and GWU (GPU work units).
   Only what the model service reports is counted. Token counts are never converted into CWU. */
export type Usage = { cwu?: number; gwu?: number };
export type UsageKind = "chat" | "title" | "followups" | "canvas" | "voice" | "other";
export type UsageEntry = { at: number; cwu: number; gwu: number; model: string; kind: UsageKind; chatId?: string };

const KEY = "ciro.usage.v1";
const MAX_ENTRIES = 20_000;
const KEEP_MS = 400 * 86_400_000;

const units = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) :
  typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Math.round(Number(v)) : undefined;

/** Reads CWU/GWU from one streamed or JSON response object; returns null when nothing was reported. */
export function readUsage(entry: unknown): Usage | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const out: Usage = {};
  const take = (u: unknown) => {
    if (!u || typeof u !== "object") return;
    const o = u as Record<string, unknown>;
    const cwu = units(o.cwu ?? o.CWU ?? o.compute_work_units ?? o.compute_units ?? o.work_units ?? o.total_work_units);
    const gwu = units(o.gwu ?? o.GWU ?? o.gpu_work_units);
    if (cwu !== undefined) out.cwu = cwu;
    if (gwu !== undefined) out.gwu = gwu;
  };
  take(e.usage);
  take(e.ciro_usage);
  // Signed metering receipts: [{ unit: "CWU" | "GWU", units: n }, ...]
  const receipts = [e.metering, e.receipts, (e.ciro_usage as Record<string, unknown> | undefined)?.receipts, e.ciro_usage]
    .flatMap((r) => Array.isArray(r) ? r : r && typeof r === "object" && "unit" in r ? [r] : []);
  if (receipts.length) {
    let cwu = 0, gwu = 0, seen = false;
    for (const r of receipts as Record<string, unknown>[]) {
      const n = units(r?.units);
      if (n === undefined) continue;
      if (r.unit === "CWU") { cwu += n; seen = true; } else if (r.unit === "GWU") { gwu += n; seen = true; }
    }
    if (seen) { if (cwu) out.cwu = cwu; if (gwu) out.gwu = gwu; if (!cwu && !gwu) out.cwu = 0; }
  }
  return out.cwu === undefined && out.gwu === undefined ? null : out;
}

export function loadUsage(): UsageEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((x): x is UsageEntry => !!x && typeof x.at === "number" && typeof x.cwu === "number") : [];
  } catch { return []; }
}
export function recordUsage(entry: Omit<UsageEntry, "at" | "cwu" | "gwu"> & Usage): void {
  const row: UsageEntry = { at: Date.now(), cwu: entry.cwu ?? 0, gwu: entry.gwu ?? 0, model: entry.model, kind: entry.kind, ...(entry.chatId ? { chatId: entry.chatId } : {}) };
  const cutoff = Date.now() - KEEP_MS;
  const list = [...loadUsage().filter((x) => x.at >= cutoff), row].slice(-MAX_ENTRIES);
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full: stats are best-effort */ }
  window.dispatchEvent(new Event("ciro-usage"));
}
export function clearUsage(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event("ciro-usage"));
}

export function formatUnits(n: number, locale: string): string {
  if (n >= 1_000_000) return (n / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 2 }) + "M";
  if (n >= 10_000) return (n / 1_000).toLocaleString(locale, { maximumFractionDigits: 1 }) + "K";
  return n.toLocaleString(locale);
}

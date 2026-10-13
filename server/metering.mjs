// Native metering (CWU / GWU) read from model-service responses: usage fields, signed receipts or streamed SSE.
// Tokens are never converted into CWU.
const units = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) :
  typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Math.round(Number(v)) : undefined;

/** CWU/GWU reported in one response object (usage, ciro_usage or signed receipts); null when none. */
export function meterOf(entry) {
  if (!entry || typeof entry !== "object") return null;
  let cwu, gwu;
  for (const u of [entry.usage, entry.ciro_usage]) {
    if (!u || typeof u !== "object") continue;
    const c = units(u.cwu ?? u.CWU ?? u.compute_work_units ?? u.compute_units ?? u.work_units ?? u.total_work_units);
    const g = units(u.gwu ?? u.GWU ?? u.gpu_work_units);
    if (c !== undefined) cwu = c;
    if (g !== undefined) gwu = g;
  }
  const receipts = [entry.metering, entry.receipts, entry.ciro_usage?.receipts, entry.ciro_usage]
    .flatMap((r) => Array.isArray(r) ? r : r && typeof r === "object" && "unit" in r ? [r] : []);
  let rc = 0, rg = 0, seen = false;
  for (const r of receipts) {
    const n = units(r?.units);
    if (n === undefined) continue;
    if (r.unit === "CWU") { rc += n; seen = true; } else if (r.unit === "GWU") { rg += n; seen = true; }
  }
  if (seen) { cwu = rc; gwu = rg; }
  return cwu === undefined && gwu === undefined ? null : { cwu: cwu ?? 0, gwu: gwu ?? 0 };
}

/** Watches an SSE byte stream passing through and returns the last metering it reported. */
export function sseMeter() {
  let buffer = "", last = null;
  const decoder = new TextDecoder();
  const line = (l) => {
    if (!l.startsWith("data:") || l.includes("[DONE]")) return;
    try { const m = meterOf(JSON.parse(l.slice(5))); if (m) last = m; } catch { /* keep-alive or partial */ }
  };
  return {
    push(chunk) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      lines.forEach(line);
      if (buffer.length > 1_000_000) buffer = "";
    },
    result() { if (buffer) line(buffer); buffer = ""; return last; }
  };
}


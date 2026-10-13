// Plans and CWU allowances. Usage is counted in Ciro's native units only (CWU / GWU as reported by the
// model service); tokens are never converted. Plans are configured by the operator:
//   CIRO_PLANS       JSON array (or CIRO_PLANS_FILE: path to a JSON file) of
//                    {id, name, nameEn?, monthlyCwu, monthlyGwu?, price?, features?: string[]}
//   CIRO_PLAN        id of the plan this server's users are on (later set by the payment integration)
// Without configuration the three plan slots show as "coming soon" and nothing is limited.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";

const DEFAULT_PLANS = [
  { id: "basic", name: "基础版", nameEn: "Basic" },
  { id: "pro", name: "专业版", nameEn: "Pro" },
  { id: "max", name: "旗舰版", nameEn: "Max" }
];

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

const allowance = (v) => v === null || v === undefined || v === "" ? null : units(v) ?? null;
const text = (v, max) => typeof v === "string" ? v.trim().slice(0, max) : "";

export function loadPlans(env = process.env) {
  let raw = null;
  try {
    if (env.CIRO_PLANS_FILE) raw = JSON.parse(readFileSync(env.CIRO_PLANS_FILE, "utf8"));
    else if (env.CIRO_PLANS) raw = JSON.parse(env.CIRO_PLANS);
  } catch (error) {
    throw new Error("CIRO_PLANS is not valid JSON: " + error.message);
  }
  const list = Array.isArray(raw) && raw.length ? raw : DEFAULT_PLANS;
  const seen = new Set();
  return list.slice(0, 6).map((p, i) => {
    const id = text(p?.id, 40) || "plan" + (i + 1);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || seen.has(id)) throw new Error("CIRO_PLANS: invalid or duplicate plan id " + JSON.stringify(id));
    seen.add(id);
    return {
      id, name: text(p?.name, 40) || id, nameEn: text(p?.nameEn, 40) || null,
      monthlyCwu: allowance(p?.monthlyCwu), monthlyGwu: allowance(p?.monthlyGwu),
      price: text(p?.price, 40) || null,
      features: Array.isArray(p?.features) ? p.features.map((f) => text(f, 80)).filter(Boolean).slice(0, 8) : []
    };
  });
}

/** Calendar month in UTC: "2026-10", plus when it resets. */
export function periodOf(now = new Date()) {
  const key = now.toISOString().slice(0, 7);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { key, start: start.toISOString(), resetsAt: end.toISOString() };
}

export function createPlanService({ dir, env = process.env, now = () => new Date() }) {
  const plans = loadPlans(env);
  const currentId = text(env.CIRO_PLAN, 40) || null;
  if (currentId && !plans.some((p) => p.id === currentId)) throw new Error("CIRO_PLAN " + JSON.stringify(currentId) + " is not one of CIRO_PLANS");
  const file = join(dir, "plan-usage.json");
  let data = { users: {} };
  try { if (existsSync(file)) data = JSON.parse(readFileSync(file, "utf8")) || data; } catch { data = { users: {} }; }
  if (!data.users || typeof data.users !== "object") data.users = {};

  const save = () => {
    mkdirSync(dir, { recursive: true });
    const tmp = file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, file);
  };
  const plan = () => plans.find((p) => p.id === currentId) || null;
  const usedBy = (user) => data.users[user]?.[periodOf(now()).key] || { cwu: 0, gwu: 0, calls: 0 };

  function record(user, meter) {
    if (!meter || (!meter.cwu && !meter.gwu)) return;
    const key = periodOf(now()).key;
    const row = (data.users[user] ||= {});
    const cur = row[key] || { cwu: 0, gwu: 0, calls: 0 };
    row[key] = { cwu: cur.cwu + (meter.cwu || 0), gwu: cur.gwu + (meter.gwu || 0), calls: cur.calls + 1 };
    // Keep about a year of months per user.
    for (const k of Object.keys(row).sort().slice(0, -13)) delete row[k];
    try { save(); } catch { /* disk full: metering keeps counting in memory */ }
  }

  /** Null when the request may go ahead; otherwise the reason it is refused. */
  function admit(user) {
    const p = plan();
    if (!p) return null;
    const used = usedBy(user);
    if (p.monthlyCwu !== null && used.cwu >= p.monthlyCwu) return "cwu";
    if (p.monthlyGwu !== null && used.gwu >= p.monthlyGwu) return "gwu";
    return null;
  }

  function summary(user) {
    const p = plan(), used = usedBy(user), period = periodOf(now());
    const left = (cap, n) => cap === null ? null : Math.max(0, cap - n);
    return {
      plans, current: p ? p.id : null, period,
      used: { cwu: used.cwu, gwu: used.gwu, calls: used.calls },
      allowance: p ? { cwu: p.monthlyCwu, gwu: p.monthlyGwu } : { cwu: null, gwu: null },
      remaining: p ? { cwu: left(p.monthlyCwu, used.cwu), gwu: left(p.monthlyGwu, used.gwu) } : { cwu: null, gwu: null },
      exhausted: Boolean(admit(user))
    };
  }

  const router = express.Router();
  router.get("/", (req, res) => res.set("Cache-Control", "no-store").json(summary(req.principal?.id || "local")));
  return { router, record, admit, summary, plan };
}

export function quotaMessage(kind) {
  return kind === "gwu"
    ? "本月套餐的 GWU 额度已用完，将在下月 1 日恢复。可以在 设置 → 用量统计 查看详情或升级套餐。"
    : "本月套餐的 CWU 额度已用完，将在下月 1 日恢复。可以在 设置 → 用量统计 查看详情或升级套餐。";
}

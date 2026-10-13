import { useEffect, useMemo, useState } from "react";
import { Activity, Check, Gauge, Trash2, Wallet } from "lucide-react";
import { clearUsage, formatUnits, loadUsage } from "../lib/usage";
import { loadPlan } from "../lib/plan-api";
import type { PlanSummary } from "../lib/plan-api";
import type { UsageEntry, UsageKind } from "../lib/usage";
import type { Conversation } from "../types";

const DAY = 86_400_000;
const KIND: Record<UsageKind, string> = { chat: "对话回答", title: "自动标题", followups: "追问建议", memory: "自动记忆", canvas: "画布", voice: "语音", other: "其他" };
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Settings → Usage: native CWU/GWU reported by the model service, aggregated on this device. */
export default function UsagePanel({ t, locale, conversations, onOpenBilling }: {
  t: (text: string) => string; locale: string; conversations: Conversation[]; onOpenBilling: () => void;
}) {
  const [entries, setEntries] = useState<UsageEntry[]>(loadUsage);
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  useEffect(() => {
    let alive = true;
    const fetchPlan = () => { loadPlan().then((p) => { if (alive) setPlan(p); }, () => { if (alive) setPlan(null); }); };
    fetchPlan();
    window.addEventListener("ciro-usage", fetchPlan);
    return () => { alive = false; window.removeEventListener("ciro-usage", fetchPlan); };
  }, []);
  useEffect(() => {
    const refresh = () => setEntries(loadUsage());
    window.addEventListener("ciro-usage", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("ciro-usage", refresh); window.removeEventListener("storage", refresh); };
  }, []);

  const stats = useMemo(() => {
    const today = startOfDay(Date.now());
    const sum = (from: number) => entries.filter((e) => e.at >= from).reduce((a, e) => ({ cwu: a.cwu + e.cwu, gwu: a.gwu + e.gwu, n: a.n + 1 }), { cwu: 0, gwu: 0, n: 0 });
    const days = Array.from({ length: 14 }, (_, i) => {
      const from = today - (13 - i) * DAY;
      const rows = entries.filter((e) => e.at >= from && e.at < from + DAY);
      return { from, cwu: rows.reduce((a, e) => a + e.cwu, 0) };
    });
    const month = entries.filter((e) => e.at >= today - 29 * DAY);
    const group = <K extends string>(key: (e: UsageEntry) => K | undefined) => {
      const map = new Map<K, number>();
      month.forEach((e) => { const k = key(e); if (k !== undefined) map.set(k, (map.get(k) || 0) + e.cwu); });
      return [...map.entries()].sort((a, b) => b[1] - a[1]);
    };
    return { today: sum(today), week: sum(today - 6 * DAY), month: sum(today - 29 * DAY), days,
      models: group((e) => e.model), kinds: group((e) => e.kind), chats: group((e) => e.chatId).slice(0, 6) };
  }, [entries]);

  const replies = conversations.flatMap((c) => c.messages).filter((m) => m.role === "assistant" && !m.preview);
  const unreported = replies.filter((m) => !m.usage).length;
  const max = Math.max(1, ...stats.days.map((d) => d.cwu));
  const fmt = (n: number) => formatUnits(n, locale);
  const title = (id: string) => conversations.find((c) => c.id === id)?.title || t("已删除的对话");

  return <div className="us-root">
    {plan && <PlanQuota plan={plan} t={t} locale={locale} fmt={fmt}/>}
    <div className="us-cards">
      {([["今天", stats.today], ["近 7 天", stats.week], ["近 30 天", stats.month]] as const).map(([label, v]) =>
        <div className="us-card" key={label}><span>{t(label)}</span><strong>{fmt(v.cwu)} <small>CWU</small></strong>
          <small>{v.gwu ? fmt(v.gwu) + " GWU · " : ""}{v.n} {t("次调用")}</small></div>)}
    </div>
    <div className="us-chart" role="img" aria-label={t("近 14 天每日 CWU")}>
      {stats.days.map((d) => <div className="us-bar" key={d.from} title={new Date(d.from).toLocaleDateString(locale) + " · " + fmt(d.cwu) + " CWU"}>
        <span style={{ height: Math.max(d.cwu ? 4 : 0, Math.round((d.cwu / max) * 100)) + "%" }}/>
        <small>{new Date(d.from).getDate()}</small>
      </div>)}
    </div>
    <div className="us-grid">
      <div><h4>{t("按模型（30 天）")}</h4>{stats.models.length ? stats.models.map(([k, v]) => <p key={k}><span>{k}</span><b>{fmt(v)}</b></p>) : <p className="us-empty">{t("暂无数据")}</p>}</div>
      <div><h4>{t("按用途（30 天）")}</h4>{stats.kinds.length ? stats.kinds.map(([k, v]) => <p key={k}><span>{t(KIND[k as UsageKind] || k)}</span><b>{fmt(v)}</b></p>) : <p className="us-empty">{t("暂无数据")}</p>}</div>
      <div><h4>{t("用量最多的对话")}</h4>{stats.chats.length ? stats.chats.map(([k, v]) => <p key={k}><span>{title(k)}</span><b>{fmt(v)}</b></p>) : <p className="us-empty">{t("暂无数据")}</p>}</div>
    </div>
    <p className="sc-help-text"><Activity size={14}/> {t("CWU（计算工作单位）和 GWU（GPU 工作单位）是 Ciro 的原生计量单位，这里只统计模型服务实际上报的数值，不会按 token 估算；统计范围为本设备。")}
      {unreported > 0 && <> {t("有")} {unreported} {t("条回答未上报用量。")}</>}</p>
    <div className="sc-action-list">
      <button className="sc-action-secondary" onClick={onOpenBilling}><Wallet size={17}/> {t("查看账户账单（以服务器签名收据为准）")}</button>
      <button className="sc-action-danger" disabled={!entries.length} onClick={() => { if (window.confirm(t("清空本设备的用量统计？"))) clearUsage(); }}><Trash2 size={17}/> {t("清空统计")}</button>
    </div>
  </div>;
}

/** Current plan's monthly allowance and the three plans (shown as "coming soon" until the server configures them). */
function PlanQuota({ plan, t, locale, fmt }: { plan: PlanSummary; t: (s: string) => string; locale: string; fmt: (n: number) => string }) {
  const current = plan.plans.find((p) => p.id === plan.current) || null;
  const english = locale.startsWith("en");
  const name = (p: { name: string; nameEn: string | null }) => english && p.nameEn ? p.nameEn : p.name;
  const resets = new Date(plan.period.resetsAt).toLocaleDateString(locale, { month: "long", day: "numeric" });
  const cap = plan.allowance.cwu;
  const pct = cap ? Math.min(100, Math.round((plan.used.cwu / cap) * 100)) : 0;
  const level = plan.exhausted || pct >= 100 ? "out" : pct >= 80 ? "low" : "ok";
  return <section className="us-plan" aria-label={t("套餐与额度")}>
    <div className="us-plan-head">
      <Gauge size={18}/>
      <div><strong>{current ? name(current) : t("暂未开通套餐")}</strong>
        <small>{current ? t("本月额度") + " · " + resets + " " + t("重置") : t("套餐即将推出，目前不限额度")}</small></div>
    </div>
    {current && <>
      {cap !== null ? <>
        <div className={"us-meter us-meter--" + level} role="meter" aria-label={t("本月 CWU 额度")} aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Math.min(plan.used.cwu, cap)}>
          <span style={{ width: pct + "%" }}/>
        </div>
        <p className="us-plan-line"><span>{t("已用")} <b>{fmt(plan.used.cwu)}</b> / {fmt(cap)} CWU</span>
          <span>{level === "out" ? t("额度已用完") : t("剩余") + " " + fmt(plan.remaining.cwu ?? 0) + " CWU"}</span></p>
      </> : <p className="us-plan-line"><span>{t("已用")} <b>{fmt(plan.used.cwu)}</b> CWU</span><span>{t("CWU 不限量")}</span></p>}
      {plan.allowance.gwu !== null && <p className="us-plan-line"><span>{t("已用")} <b>{fmt(plan.used.gwu)}</b> / {fmt(plan.allowance.gwu)} GWU</span>
        <span>{t("剩余") + " " + fmt(plan.remaining.gwu ?? 0) + " GWU"}</span></p>}
      {level === "out" && <p className="us-plan-warn" role="alert">{t("本月额度已用完，新的提问会被暂停，直到额度重置或升级套餐。")}</p>}
      {level === "low" && <p className="us-plan-warn us-plan-warn--low">{t("本月额度已用掉 80% 以上。")}</p>}
    </>}
    <div className="us-plans">
      {plan.plans.map((p) => <div key={p.id} className={"us-plan-card" + (p.id === plan.current ? " us-plan-card--current" : "")}>
        <div className="us-plan-card-top"><b>{name(p)}</b>{p.id === plan.current && <span className="us-plan-badge"><Check size={12}/> {t("当前")}</span>}</div>
        <strong>{p.monthlyCwu !== null ? fmt(p.monthlyCwu) : "—"} <small>{p.monthlyCwu !== null ? t("CWU / 月") : t("额度即将公布")}</small></strong>
        {p.monthlyGwu !== null && <small>{fmt(p.monthlyGwu)} {t("GWU / 月")}</small>}
        <small>{p.price || (p.monthlyCwu === null ? t("即将推出") : "")}</small>
        {p.features.length > 0 && <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>}
      </div>)}
    </div>
  </section>;
}

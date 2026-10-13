import { useEffect, useMemo, useState } from "react";
import { Activity, CreditCard, Trash2 } from "lucide-react";
import { clearUsage, formatUnits, loadUsage } from "../lib/usage";
import type { UsageEntry, UsageKind } from "../lib/usage";
import type { Conversation } from "../types";

const DAY = 86_400_000;
const KIND: Record<UsageKind, string> = { chat: "对话回答", title: "自动标题", followups: "追问建议", memory: "自动记忆", canvas: "画布", voice: "语音", other: "其他" };
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Settings → Usage: CWU reported by the model service, aggregated on this device. onOpenBilling opens the subscription page. */
export default function UsagePanel({ t, locale, conversations, onOpenBilling }: {
  t: (text: string) => string; locale: string; conversations: Conversation[]; onOpenBilling: () => void;
}) {
  const [entries, setEntries] = useState<UsageEntry[]>(loadUsage);
  useEffect(() => {
    const refresh = () => setEntries(loadUsage());
    window.addEventListener("ciro-usage", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("ciro-usage", refresh); window.removeEventListener("storage", refresh); };
  }, []);

  const stats = useMemo(() => {
    const today = startOfDay(Date.now());
    const sum = (from: number) => entries.filter((e) => e.at >= from).reduce((a, e) => ({ cwu: a.cwu + e.cwu, n: a.n + 1 }), { cwu: 0, n: 0 });
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
      kinds: group((e) => e.kind), chats: group((e) => e.chatId).slice(0, 6) };
  }, [entries]);

  const max = Math.max(1, ...stats.days.map((d) => d.cwu));
  const fmt = (n: number) => formatUnits(n, locale);
  const title = (id: string) => conversations.find((c) => c.id === id)?.title || t("已删除的对话");

  return <div className="us-root">
    <div className="us-cards">
      {([["今天", stats.today], ["近 7 天", stats.week], ["近 30 天", stats.month]] as const).map(([label, v]) =>
        <div className="us-card" key={label}><span>{t(label)}</span><strong>{fmt(v.cwu)} <small>CWU</small></strong>
          <small>{v.n} {t("次调用")}</small></div>)}
    </div>
    <div className="us-chart" role="img" aria-label={t("近 14 天每日 CWU")}>
      {stats.days.map((d) => <div className="us-bar" key={d.from} title={new Date(d.from).toLocaleDateString(locale) + " · " + fmt(d.cwu) + " CWU"}>
        <span style={{ height: Math.max(d.cwu ? 4 : 0, Math.round((d.cwu / max) * 100)) + "%" }}/>
        <small>{new Date(d.from).getDate()}</small>
      </div>)}
    </div>
    <div className="us-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
      <div><h4>{t("按用途（30 天）")}</h4>{stats.kinds.length ? stats.kinds.map(([k, v]) => <p key={k}><span>{t(KIND[k as UsageKind] || k)}</span><b>{fmt(v)}</b></p>) : <p className="us-empty">{t("暂无数据")}</p>}</div>
      <div><h4>{t("用量最多的对话")}</h4>{stats.chats.length ? stats.chats.map(([k, v]) => <p key={k}><span>{title(k)}</span><b>{fmt(v)}</b></p>) : <p className="us-empty">{t("暂无数据")}</p>}</div>
    </div>
    <p className="sc-help-text"><Activity size={14}/> {t("CWU 是 Ciro 的用量单位。这里显示本设备上的用量。")}</p>
    <div className="sc-action-list">
      <button className="sc-action-secondary" onClick={onOpenBilling}><CreditCard size={17}/> {t("订阅与账单")}</button>
      <button className="sc-action-danger" disabled={!entries.length} onClick={() => { if (window.confirm(t("清空本设备的用量统计？"))) clearUsage(); }}><Trash2 size={17}/> {t("清空统计")}</button>
    </div>
  </div>;
}

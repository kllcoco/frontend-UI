import { useEffect, useState } from "react";
import { Coins, Gift, RefreshCcw, ShoppingCart, Sparkles } from "lucide-react";
import { accountApi } from "../lib/account-api";
import { openExternal } from "../lib/desktop";

type Pack = { id: string; cwu: number; label: string; price: string };
type Entry = { at: string; delta: number; reason: string; balance: number };
type CwuState = { enabled: boolean; balance: number; ledger: Entry[]; packs: Pack[]; buy: boolean };

const REASONS: Record<string, string> = { chat: "对话消耗", api: "API 调用", image: "图片生成", speech: "语音朗读", transcribe: "语音识别",
  purchase: "充值", signup: "注册赠送", grant: "赠送", adjust: "调整" };

/** Settings → CWU 额度: the account's balance (the same on every device, wherever it was bought), packs to buy and
 *  recent changes. Purchases open the payment page; the balance updates once the payment is confirmed. */
export default function CwuPanel({ t, locale }: { t: (s: string) => string; locale: string }) {
  const [data, setData] = useState<CwuState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => accountApi<CwuState>("/cwu").then((d) => { setData(d); setError(""); }, () => setError(t("登录后可查看和充值 CWU 额度。")));
  useEffect(() => {
    void load();
    // Back from the payment page: refresh (the payment confirmation may take a few seconds).
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, []);
  const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
  async function buy(pack: Pack) {
    setBusy(pack.id);
    try {
      const r = await accountApi<{ url: string }>("/cwu/checkout", "POST", { pack: pack.id });
      openExternal(r.url);
    } catch { setError(t("暂时无法打开支付页面，请稍后再试。")); }
    finally { setBusy(""); }
  }
  if (error && !data) return <div className="cwu-panel"><p className="cwu-note">{error}</p></div>;
  if (!data) return <div className="cwu-panel"><p className="cwu-note">{t("正在加载…")}</p></div>;
  return <div className="cwu-panel">
    <div className="cwu-balance">
      <Coins size={22}/>
      <div><small>{t("当前余额")}</small><strong data-testid="cwu-balance">{fmt(data.balance)} <span>CWU</span></strong></div>
      <button type="button" className="sc-action-secondary" onClick={() => void load()} aria-label={t("刷新")}><RefreshCcw size={15}/></button>
    </div>
    <p className="cwu-note">{t("同一个账户的额度在手机、电脑和网页上通用，在官网或软件里充值都会到账到这里。")}</p>
    {data.buy && data.packs.length > 0 && <>
      <h4 className="cwu-title"><ShoppingCart size={15}/> {t("充值")}</h4>
      <div className="cwu-packs">
        {data.packs.map((p) => <button type="button" key={p.id} className="cwu-pack" disabled={Boolean(busy)} onClick={() => void buy(p)}>
          <Sparkles size={16}/><strong>{p.label}</strong><span>{p.price}</span>
          <em>{busy === p.id ? t("正在打开…") : t("购买")}</em>
        </button>)}
      </div>
    </>}
    {!data.buy && <p className="cwu-note">{t("充值暂未开放，敬请期待。")}</p>}
    {error && <p className="sc-error" role="alert">{error}</p>}
    <h4 className="cwu-title"><Gift size={15}/> {t("最近变动")}</h4>
    {data.ledger.length === 0 ? <p className="cwu-note">{t("还没有记录。")}</p> :
      <ul className="cwu-ledger">{data.ledger.map((e, i) => <li key={i}>
        <span>{t(REASONS[e.reason] || "其他")}</span>
        <time>{new Date(e.at).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
        <b className={e.delta >= 0 ? "cwu-plus" : "cwu-minus"}>{e.delta >= 0 ? "+" : ""}{fmt(e.delta)}</b>
      </li>)}</ul>}
  </div>;
}

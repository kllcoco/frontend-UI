import { localeTag } from "../lib/i18n";
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import CiroMark from "./CiroMark";
import Markdown from "./Markdown";
import { loadLanguage, translate } from "../lib/i18n";
import { loadTheme } from "../lib/storage";

type Shared = { title: string; createdAt: string; messages: { role: "user" | "assistant"; content: string }[] };

/** Public read-only page for /share/:id. */
export default function SharedView({ id }: { id: string }) {
  const language = loadLanguage();
  const t = (text: string) => translate(language, text);
  const [data, setData] = useState<Shared | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", loadTheme());
    document.documentElement.lang = language;
    fetch("/api/share/" + encodeURIComponent(id), { cache: "no-store" })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((d: Shared) => { setData(d); document.title = d.title + " · Ciro"; })
      .catch(() => setError(true));
  }, [id]);
  return <div className="app-shell cx-shell shv-root">
    <header className="shv-head">
      <a href="/" className="shv-brand"><CiroMark small/><strong>Ciro</strong></a>
      <a href="/" className="cx-btn cx-btn--primary shv-cta">{t("开始使用 Ciro")}<ArrowRight size={15}/></a>
    </header>
    <main className="shv-main">
      {error && <div className="shv-empty"><h1>{t("分享链接不存在或已停止分享")}</h1></div>}
      {!error && !data && <div className="shv-empty"><span className="cx-row-spinner"/></div>}
      {data && <>
        <h1 className="shv-title">{data.title}</h1>
        <p className="shv-meta">{t("分享的对话")} · {new Date(data.createdAt).toLocaleString(localeTag(language))}</p>
        <div className="messages">
          {data.messages.map((m, i) => <article key={i} className={["message", m.role === "assistant" ? "message--assistant" : "message--user"].join(" ")}>
            {m.role === "assistant" && <div className="message-avatar"><CiroMark small/></div>}
            <div className="message-body">{m.role === "assistant"
              ? <div className="message-prose"><Markdown text={m.content} copyLabel={t("复制代码")} copiedLabel={t("已复制")}/></div>
              : <div className="user-bubble">{m.content}</div>}</div>
          </article>)}
        </div>
        <p className="shv-foot">{t("内容由 AI 生成，可能有误，请核实重要信息。")}</p>
      </>}
    </main>
  </div>;
}

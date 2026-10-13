import { useState } from "react";
import { Globe2 } from "lucide-react";

type Source = { url: string; title?: string; snippet?: string };
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Web pages an answer is based on: title, site and snippet, each opening the original page. */
export default function SourceCards({ t, sources }: { t: (s: string) => string; sources: Source[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, 4);
  const open = (url: string) => {
    const desktop = (window as unknown as { ciroDesktop?: { openExternal?: (u: string) => void } }).ciroDesktop;
    if (desktop?.openExternal) desktop.openExternal(url); else window.open(url, "_blank", "noopener,noreferrer");
  };
  return <div className="cx-sources" aria-label={t("参考来源")}>
    <div className="cx-sources-head"><Globe2 size={14}/>{t("参考来源")} · {sources.length}</div>
    <div className="cx-sources-grid">
      {shown.map((s, i) => <a key={s.url} className="cx-source" href={s.url} target="_blank" rel="noopener noreferrer"
        onClick={(e) => { e.preventDefault(); open(s.url); }} title={s.url}>
        <span className="cx-source-top"><span className="cx-source-n">{i + 1}</span><span className="cx-source-site">{host(s.url)}</span></span>
        <strong>{s.title || host(s.url)}</strong>
        {s.snippet && <small>{s.snippet}</small>}
      </a>)}
    </div>
    {sources.length > 4 && <button type="button" className="cx-sources-more" onClick={() => setAll((v) => !v)}>
      {all ? t("收起") : t("查看全部") + " " + sources.length + " " + t("个来源")}</button>}
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { Copy, Download, Share2, X } from "lucide-react";
import CiroMark from "./CiroMark";
import Markdown from "./Markdown";
import type { ChatMessage } from "../types";

type Bridge = { shareImage?: (base64: string, name: string) => boolean };

/** A conversation (or one Q&A) rendered as a tidy card and exported as a PNG to save or share. */
export default function ShareImage({ t, title, messages, locale, onClose, onNotify }: {
  t: (s: string) => string; title: string; messages: ChatMessage[]; locale: string; onClose: () => void; onNotify: (text: string) => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [png, setPng] = useState<string | null>(null);
  const [error, setError] = useState("");
  const name = "Ciro-" + title.replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 40) + ".png";

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        await new Promise((r) => setTimeout(r, 120)); // let Markdown / code highlighting settle
        const { toPng } = await import("html-to-image");
        const node = card.current!;
        const bg = getComputedStyle(node).backgroundColor;
        const url = await toPng(node, { pixelRatio: 2, backgroundColor: bg, skipFonts: true, cacheBust: true });
        if (alive) setPng(url);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : String(e)); }
    };
    void run();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { alive = false; window.removeEventListener("keydown", esc); };
  }, []);

  const blob = async () => (await fetch(png!)).blob();
  const android = (window as unknown as { CiroFiles?: Bridge }).CiroFiles;
  async function share() {
    if (!png) return;
    if (android?.shareImage) { if (!android.shareImage(png.split(",")[1], name)) onNotify("分享失败"); return; }
    const file = new File([await blob()], name, { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
    if (nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title }); } catch { /* cancelled */ } return; }
    save();
  }
  function save() {
    if (!png) return;
    if (android?.shareImage) { void share(); return; }
    const a = document.createElement("a"); a.href = png; a.download = name; a.click();
    onNotify("图片已保存");
  }
  async function copy() {
    try { await navigator.clipboard.write([new ClipboardItem({ "image/png": await blob() })]); onNotify("图片已复制"); }
    catch { onNotify("当前环境不支持复制图片，请使用保存"); }
  }
  const canCopy = typeof ClipboardItem !== "undefined" && !android;

  return <div className="si-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="si-dialog" role="dialog" aria-modal="true" aria-label={t("分享为图片")}>
      <header><strong>{t("分享为图片")}</strong>
        <button type="button" className="cx-icon" onClick={onClose} aria-label={t("关闭")}><X size={18}/></button></header>
      <div className="si-stage">
        {/* The card is what gets exported; the preview shows the finished image once ready. */}
        <div className={png ? "si-card si-card--hidden" : "si-card"} ref={card}>
          <div className="si-card-head"><CiroMark small/><span><strong>Ciro</strong><small>{title}</small></span></div>
          {messages.map((m) => <div key={m.id} className={m.role === "user" ? "si-user" : "si-assistant"}>
            {m.role === "user" ? m.content : <Markdown text={m.content} copyLabel="" copiedLabel=""/>}
          </div>)}
          <div className="si-card-foot">{new Date(messages.at(-1)?.createdAt || Date.now()).toLocaleDateString(locale)} · {t("由 Ciro 生成")}</div>
        </div>
        {png && <img className="si-preview" src={png} alt={t("分享图片预览")}/>}
        {!png && !error && <p className="si-wait">{t("正在生成图片…")}</p>}
        {error && <p className="si-error" role="alert">{t("生成图片失败：")}{error}</p>}
      </div>
      <footer>
        <button type="button" disabled={!png} onClick={() => void share()}><Share2 size={16}/>{t("分享")}</button>
        {!android && <button type="button" disabled={!png} onClick={save}><Download size={16}/>{t("保存图片")}</button>}
        {canCopy && <button type="button" disabled={!png} onClick={() => void copy()}><Copy size={16}/>{t("复制图片")}</button>}
      </footer>
    </div>
  </div>;
}

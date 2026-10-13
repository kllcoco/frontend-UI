import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, Code2, Copy, Download, Eye, PanelRightClose, Sparkles, Undo2 } from "lucide-react";
import Markdown from "./Markdown";

export type CanvasDoc = { id: string; title: string; language: string; content: string; updatedAt: number; history?: string[] };

type Props = {
  t: (text: string) => string;
  doc: CanvasDoc;
  busy: boolean;
  onChange: (doc: CanvasDoc) => void;
  onAsk: (instruction: string) => void;
  onClose: () => void;
};

const PREVIEWABLE = new Set(["html", "svg", "xml", "markdown", "md"]);
const EXT: Record<string, string> = { python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts", tsx: "tsx", jsx: "jsx",
  html: "html", css: "css", json: "json", markdown: "md", md: "md", svg: "svg", sql: "sql", bash: "sh", sh: "sh", go: "go", rust: "rs",
  java: "java", c: "c", cpp: "cpp", csharp: "cs", yaml: "yml", yml: "yml", text: "txt" };
const LANGS = ["markdown", "html", "svg", "python", "javascript", "typescript", "tsx", "css", "json", "sql", "bash", "go", "rust", "java", "cpp", "text"];

/** Side canvas: editable document/code with live preview and AI revisions. */
export default function CanvasPanel({ t, doc, busy, onChange, onAsk, onClose }: Props) {
  const lang = doc.language.toLowerCase();
  const canPreview = PREVIEWABLE.has(lang);
  const [tab, setTab] = useState<"code" | "preview">(canPreview && doc.content.trim() ? "preview" : "code");
  const [ask, setAsk] = useState("");
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!canPreview) setTab("code"); }, [canPreview]);
  const srcDoc = useMemo(() => lang === "svg" || lang === "xml"
    ? "<!doctype html><meta charset=utf-8><body style=\"margin:0;display:grid;place-items:center;min-height:100vh;background:#fff\">" + doc.content + "</body>"
    : doc.content, [doc.content, lang]);

  function edit(content: string) { onChange({ ...doc, content, updatedAt: Date.now() }); }
  function undo() {
    const history = [...(doc.history || [])];
    const previous = history.pop();
    if (previous !== undefined) onChange({ ...doc, content: previous, history, updatedAt: Date.now() });
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const el = event.currentTarget;
    const { selectionStart: a, selectionEnd: b } = el;
    edit(doc.content.slice(0, a) + "  " + doc.content.slice(b));
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 2; });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(doc.content); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { /* blocked */ }
  }
  function download() {
    const blob = new Blob([doc.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = (doc.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/[\s·]+/g, "-") || "canvas") + "." + (EXT[lang] || "txt");
    document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function submit() {
    const text = ask.trim();
    if (!text || busy) return;
    setAsk("");
    onAsk(text);
  }

  return <aside className="cv-root" aria-label={t("画布")}>
    <header className="cv-head">
      <input className="cv-title" value={doc.title} maxLength={80} aria-label={t("画布标题")}
        onChange={(e) => onChange({ ...doc, title: e.target.value, updatedAt: Date.now() })}/>
      <select className="cv-lang" value={LANGS.includes(lang) ? lang : "text"} aria-label={t("语言")}
        onChange={(e) => onChange({ ...doc, language: e.target.value, updatedAt: Date.now() })}>
        {LANGS.map((l) => <option key={l} value={l}>{l}</option>)}
      </select>
      <div className="cv-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "code"} className={tab === "code" ? "on" : ""} onClick={() => setTab("code")}><Code2 size={14}/>{t("代码")}</button>
        <button role="tab" aria-selected={tab === "preview"} className={tab === "preview" ? "on" : ""} disabled={!canPreview}
          title={canPreview ? undefined : t("HTML、SVG 与 Markdown 支持预览")} onClick={() => setTab("preview")}><Eye size={14}/>{t("预览")}</button>
      </div>
      <button type="button" className="cx-icon" onClick={undo} disabled={!doc.history?.length} title={t("撤销上一次修改")} aria-label={t("撤销上一次修改")}><Undo2 size={16}/></button>
      <button type="button" className="cx-icon" onClick={() => void copy()} title={t("复制")} aria-label={t("复制")}>{copied ? <Check size={16}/> : <Copy size={16}/>}</button>
      <button type="button" className="cx-icon" onClick={download} title={t("下载")} aria-label={t("下载")}><Download size={16}/></button>
      <button type="button" className="cx-icon cv-close" onClick={onClose} title={t("关闭画布")} aria-label={t("关闭画布")}><PanelRightClose size={17}/></button>
    </header>
    <div className="cv-body">
      {tab === "code" || !canPreview
        ? <textarea ref={textRef} className="cv-editor" spellCheck={false} value={doc.content} aria-label={t("画布内容")}
          onChange={(e) => edit(e.target.value)} onKeyDown={onKey}/>
        : lang === "markdown" || lang === "md"
          ? <div className="cv-doc message-prose"><Markdown text={doc.content} copyLabel={t("复制代码")} copiedLabel={t("已复制")} t={t}/></div>
          : <iframe className="cv-frame" title={t("预览")} sandbox="allow-scripts allow-modals allow-forms" srcDoc={srcDoc}/>}
    </div>
    <form className="cv-ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Sparkles size={15}/>
      <input value={ask} onChange={(e) => setAsk(e.target.value)} disabled={busy}
        placeholder={busy ? t("Ciro 正在修改…") : t("让 Ciro 修改画布，例如：改成深色配色")} aria-label={t("让 Ciro 修改画布")}/>
      <button type="submit" className="cx-btn cx-btn--primary" disabled={busy || !ask.trim()}>{t("修改")}</button>
    </form>
  </aside>;
}

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, LoaderCircle, PanelRight, Play, Square, X } from "lucide-react";
import { rendersHtml, runCode, runnable } from "../lib/runner";
import type { RunEvent } from "../lib/runner";

type RunState = { status: "running" | "done" | "error"; phase: string; out: { kind: "stdout" | "stderr"; text: string }[]; images: string[]; value: string; ms?: number; error?: string };

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/** Markdown <pre> replacement: language label + one-click copy. */
export default function CodeBlock({ children, copyLabel, copiedLabel, canvasLabel, onCanvas, t }: { children?: ReactNode; copyLabel: string; copiedLabel: string; canvasLabel?: string; onCanvas?: (language: string, code: string) => void; t?: (text: string) => string }) {
  const [copied, setCopied] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => stopRef.current?.(), []);
  const child = Array.isArray(children) ? children[0] : children;
  const className = child && typeof child === "object" && "props" in child ? String((child as { props: { className?: string } }).props.className || "") : "";
  const language = (/language-([\w+#.-]+)/.exec(className)?.[1] || "text").toLowerCase();
  async function copy() {
    try {
      await navigator.clipboard.writeText(textOf(children).replace(/\n$/, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked */ }
  }
  const code = () => textOf(children).replace(/\n$/, "");
  function start() {
    if (rendersHtml(language)) { setHtml(language === "svg" ? "<body style='margin:0;display:grid;place-items:center;min-height:100vh;background:#fff'>" + code() + "</body>" : code()); return; }
    stopRef.current?.();
    setRun({ status: "running", phase: "", out: [], images: [], value: "" });
    stopRef.current = runCode(language, code(), (e: RunEvent) => setRun((prev) => {
      const r = prev ?? { status: "running", phase: "", out: [], images: [], value: "" };
      if (e.type === "status") return { ...r, phase: e.text };
      if (e.type === "stdout" || e.type === "stderr") {
        const last = r.out.at(-1);
        const out = last && last.kind === e.type ? [...r.out.slice(0, -1), { kind: e.type, text: (last.text + e.text).slice(-60_000) }] : [...r.out, { kind: e.type, text: e.text }];
        return { ...r, out };
      }
      if (e.type === "done") { stopRef.current = null; return { ...r, status: "done", images: e.images ?? [], value: e.value ?? "", ms: e.ms }; }
      stopRef.current = null;
      return { ...r, status: "error", error: e.text, ms: (e as { ms?: number }).ms };
    }));
  }
  const tr = t ?? ((x: string) => x);
  const canRun = Boolean(t) && runnable(language);
  const phase = run?.phase === "loading" ? tr("正在启动 Python…") : run?.phase === "running" || !run?.phase ? tr("运行中…") : run.phase;
  return <div className="cx-code">
    <div className="cx-code-head"><span>{language}</span>
      {canRun && (run?.status === "running"
        ? <button type="button" className="cx-code-run" onClick={() => stopRef.current?.()} aria-label={tr("停止运行")}><Square size={12}/><span className="cx-code-copy">{tr("停止")}</span></button>
        : <button type="button" className="cx-code-run" onClick={start} aria-label={tr(rendersHtml(language) ? "预览" : "运行代码")}><Play size={13}/><span className="cx-code-copy">{tr(rendersHtml(language) ? "预览" : "运行")}</span></button>)}
      {onCanvas && <button type="button" className="cx-code-canvas" onClick={() => onCanvas(language, textOf(children).replace(/\n$/, ""))} aria-label={canvasLabel}>
        <PanelRight size={14}/><span className="cx-code-copy">{canvasLabel}</span></button>}
      <button type="button" onClick={() => void copy()} aria-label={copied ? copiedLabel : copyLabel}>
        {copied ? <Check size={14}/> : <Copy size={14}/>}<span className="cx-code-copy">{copied ? copiedLabel : copyLabel}</span></button></div>
    <pre>{children}</pre>
    {html !== null && <div className="cx-run">
      <div className="cx-run-head"><span>{tr("预览")}</span><button type="button" onClick={() => setHtml(null)} aria-label={tr("关闭输出")}><X size={13}/></button></div>
      <iframe className="cx-run-frame" sandbox="allow-scripts" srcDoc={html} title={tr("预览")}/>
    </div>}
    {run && <div className="cx-run" aria-live="polite">
      <div className="cx-run-head">
        <span>{run.status === "running" ? <><LoaderCircle size={12} className="cx-spin"/> {phase}</> : run.status === "error" ? tr("运行出错") : tr("输出")}</span>
        {run.ms !== undefined && <small>{(run.ms / 1000).toFixed(2)} s</small>}
        <button type="button" onClick={() => { stopRef.current?.(); setRun(null); }} aria-label={tr("关闭输出")}><X size={13}/></button>
      </div>
      {(run.out.length > 0 || run.value || run.error) && <pre className="cx-run-out">
        {run.out.map((o, i) => <span key={i} className={o.kind === "stderr" ? "cx-run-err" : undefined}>{o.text}</span>)}
        {run.value && <span className="cx-run-value">{run.value}</span>}
        {run.error && <span className="cx-run-err">{run.error === "stopped" ? tr("已停止") : run.error === "timeout" ? tr("运行超时（15 秒）") : run.error}</span>}
      </pre>}
      {run.images.map((src, i) => <img key={i} className="cx-run-img" src={src} alt={tr("图表") + " " + (i + 1)}/>)}
      {run.status === "done" && !run.out.length && !run.value && !run.images.length && <p className="cx-run-empty">{tr("运行完成，没有输出")}</p>}
    </div>}
  </div>;
}

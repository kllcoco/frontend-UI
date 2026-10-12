import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, PanelRight } from "lucide-react";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}

/** Markdown <pre> replacement: language label + one-click copy. */
export default function CodeBlock({ children, copyLabel, copiedLabel, canvasLabel, onCanvas }: { children?: ReactNode; copyLabel: string; copiedLabel: string; canvasLabel?: string; onCanvas?: (language: string, code: string) => void }) {
  const [copied, setCopied] = useState(false);
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
  return <div className="cx-code">
    <div className="cx-code-head"><span>{language}</span>
      {onCanvas && <button type="button" className="cx-code-canvas" onClick={() => onCanvas(language, textOf(children).replace(/\n$/, ""))} aria-label={canvasLabel}>
        <PanelRight size={14}/><span className="cx-code-copy">{canvasLabel}</span></button>}
      <button type="button" onClick={() => void copy()} aria-label={copied ? copiedLabel : copyLabel}>
        {copied ? <Check size={14}/> : <Copy size={14}/>}<span className="cx-code-copy">{copied ? copiedLabel : copyLabel}</span></button></div>
    <pre>{children}</pre>
  </div>;
}

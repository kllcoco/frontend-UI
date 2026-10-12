import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

type Props = { t: (text: string) => string; root: HTMLElement | null; refreshKey: unknown; onClose: () => void };
type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };

function registry(): HighlightRegistry | null {
  const css = (window as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights && typeof (window as unknown as { Highlight?: unknown }).Highlight === "function" ? css.highlights : null;
}
function collect(root: HTMLElement, query: string): Range[] {
  const needle = query.toLocaleLowerCase();
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest(".message-actions, .cx-code-head, button, .katex-mathml") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  });
  for (let node = walker.nextNode(); node && ranges.length < 2000; node = walker.nextNode()) {
    const text = (node.nodeValue || "").toLocaleLowerCase();
    let at = text.indexOf(needle);
    while (at >= 0 && ranges.length < 2000) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      ranges.push(range);
      at = text.indexOf(needle, at + needle.length);
    }
  }
  return ranges;
}

/** Ctrl/⌘+F inside a conversation: highlights every match, Enter / Shift+Enter to step. */
export default function FindBar({ t, root, refreshKey, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [ranges, setRanges] = useState<Range[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  useEffect(() => {
    const found = root && query.trim() ? collect(root, query.trim()) : [];
    setRanges(found);
    setIndex((i) => (found.length ? Math.min(i, found.length - 1) : 0));
  }, [query, root, refreshKey]);
  useEffect(() => {
    const reg = registry();
    const H = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (reg && H) {
      reg.set("ciro-find", new H(...ranges));
      reg.set("ciro-find-current", ranges[index] ? new H(ranges[index]) : new H());
    }
    const current = ranges[index];
    if (current && root) {
      const box = current.getBoundingClientRect();
      const view = root.getBoundingClientRect();
      if (box.top < view.top + 60 || box.bottom > view.bottom - 60) root.scrollBy({ top: box.top - view.top - view.height / 3, behavior: "smooth" });
    }
  }, [ranges, index, root]);
  useEffect(() => () => { const reg = registry(); reg?.delete("ciro-find"); reg?.delete("ciro-find-current"); }, []);

  function step(delta: number) { if (ranges.length) setIndex((i) => (i + delta + ranges.length) % ranges.length); }
  return <div className="fb-root" role="search" aria-label={t("在对话中查找")}>
    <Search size={15}/>
    <input ref={inputRef} value={query} placeholder={t("在对话中查找")} aria-label={t("在对话中查找")}
      onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
      }}/>
    <span className="fb-count" aria-live="polite">{query.trim() ? (ranges.length ? index + 1 + " / " + ranges.length : t("无结果")) : ""}</span>
    <button type="button" onClick={() => step(-1)} disabled={!ranges.length} aria-label={t("上一个")}><ChevronUp size={16}/></button>
    <button type="button" onClick={() => step(1)} disabled={!ranges.length} aria-label={t("下一个")}><ChevronDown size={16}/></button>
    <button type="button" onClick={onClose} aria-label={t("关闭查找")}><X size={16}/></button>
  </div>;
}

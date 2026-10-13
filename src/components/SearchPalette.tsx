import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CornerDownLeft, FolderOpen, MessageCircle, Search, X } from "lucide-react";
import type { Conversation } from "../types";

export type PaletteCommand = { id: string; label: string; icon: ReactNode; hint?: string; run: () => void };

type Props = {
  t: (text: string) => string;
  conversations: Conversation[];
  commands: PaletteCommand[];
  onSelectChat: (id: string) => void;
  onClose: () => void;
};

type Kind = "chat" | "command" | "project";
type Entry = {
  key: string; kind: Kind; label: string; detail?: string; when?: string;
  icon: ReactNode; hint?: string; score: number; run: () => void;
};

const RECENT = 6;
const GROUP_ORDER: Kind[] = ["chat", "command", "project"];

function plain(text: string) { return text.replace(/[#*_`>~\[\]()!|]/g, "").replace(/\s+/g, " ").trim(); }

/** A short excerpt around the first match in any message, or the latest message as a preview. */
function excerpt(chat: Conversation, term: string): string | undefined {
  if (term) {
    for (const m of chat.messages) {
      const text = plain(m.content);
      const at = text.toLowerCase().indexOf(term);
      if (at < 0) continue;
      const start = Math.max(0, at - 28);
      return (start > 0 ? "…" : "") + text.slice(start, at + term.length + 70);
    }
  }
  const last = [...chat.messages].reverse().find((m) => m.content.trim());
  return last ? plain(last.content).slice(0, 110) : undefined;
}

function score(label: string, term: string, inContent = false) {
  const lower = label.toLowerCase();
  if (lower.startsWith(term)) return 3;
  if (lower.includes(term)) return 2;
  return inContent ? 1 : 0;
}

function locale() { return (typeof document !== "undefined" && document.documentElement.lang) || "zh-CN"; }

/** "3 小时前", "昨天", "Oct 2" — localized by the browser, so no new UI strings are needed. */
function relative(at: number): string {
  const lang = locale();
  const diff = at - Date.now();
  const minutes = Math.round(diff / 60000);
  try {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style: "short" });
    if (Math.abs(minutes) < 60) return rtf.format(Math.min(0, minutes), "minute");
    const hours = Math.round(minutes / 60);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    const days = Math.round(hours / 24);
    if (Math.abs(days) < 7) return rtf.format(days, "day");
    const date = new Date(at);
    return date.toLocaleDateString(lang, date.getFullYear() === new Date().getFullYear()
      ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
  } catch { return new Date(at).toLocaleDateString(); }
}

function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0, at = lower.indexOf(term), n = 0;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={n++}>{text.slice(at, at + term.length)}</mark>);
    from = at + term.length;
    at = lower.indexOf(term, from);
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

/** ⌘K palette: search conversation titles and content, plus quick commands and projects. */
export default function SearchPalette({ t, conversations, commands, onSelectChat, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const term = query.trim().toLowerCase();

  const entries = useMemo<Entry[]>(() => {
    const chats = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ c, s: term ? score(c.title, term, c.messages.some((m) => m.content.toLowerCase().includes(term))) : 1 }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, term ? 30 : RECENT)
      .map<Entry>(({ c, s }) => ({ key: "chat:" + c.id, kind: "chat", label: c.title || t("新对话"), detail: excerpt(c, term),
        when: relative(c.updatedAt), icon: <MessageCircle size={16}/>, score: s, run: () => onSelectChat(c.id) }));
    const rest = commands.map<Entry>((c) => {
      const project = c.id.startsWith("project:");
      const label = project ? c.label.slice(c.label.indexOf(" · ") + 3) : c.label;
      return { key: "cmd:" + c.id, kind: project ? "project" : "command", label, icon: project ? <FolderOpen size={16}/> : c.icon,
        hint: c.hint, score: term ? score(label, term) : 1, run: c.run };
    }).filter((e) => e.score > 0).sort((a, b) => b.score - a.score);
    const groups: Record<Kind, Entry[]> = { chat: chats, command: rest.filter((e) => e.kind === "command"), project: rest.filter((e) => e.kind === "project") };
    // With a query the group holding the strongest match comes first, so Enter opens what was typed.
    const best = (k: Kind) => groups[k].reduce((m, e) => Math.max(m, e.score), 0);
    const order = term ? [...GROUP_ORDER].sort((a, b) => best(b) - best(a)) : GROUP_ORDER;
    return order.flatMap((k) => groups[k]);
  }, [term, conversations, commands, onSelectChat, t]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function choose(entry: Entry | undefined) { if (!entry) return; onClose(); entry.run(); }
  function move(step: number) {
    if (!entries.length) return;
    setCursor((c) => (c + step + entries.length) % entries.length);
  }
  const groupLabel = (kind: Kind) => kind === "chat" ? (term ? t("对话") : t("最近对话")) : kind === "command" ? t("命令") : t("项目");
  const active = entries[cursor];

  return <div className="sp-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sp-panel" role="dialog" aria-modal="true" aria-label={t("搜索对话")}>
      <div className="sp-input">
        <Search size={20} className="sp-input-icon" aria-hidden="true"/>
        <input ref={inputRef} value={query} placeholder={t("搜索对话或输入命令…")} aria-label={t("搜索对话")}
          aria-controls="sp-results" aria-activedescendant={active ? "sp-opt-" + cursor : undefined}
          autoComplete="off" spellCheck={false} enterKeyHint="go"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
            else if (e.key === "Enter") { e.preventDefault(); choose(entries[cursor]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}/>
        {query && <button type="button" className="sp-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}
          aria-label={t("清除搜索")}><X size={14}/></button>}
        <button type="button" className="sp-close" onClick={onClose} aria-label={t("关闭搜索")}>
          <X size={18} className="sp-close-icon"/><kbd className="sp-close-kbd">Esc</kbd></button>
      </div>
      <div className="sp-list" ref={listRef} id="sp-results" role="listbox" aria-label={t("搜索对话")}>
        {entries.length === 0 && <div className="sp-empty" role="status">
          <span className="sp-empty-icon"><Search size={22}/></span>
          <strong>{t("没有找到相关对话")}</strong>
          <small>{t("换个关键词试试，或搜索对话中的内容")}</small>
        </div>}
        {entries.map((entry, index) => {
          const header = index === 0 || entries[index - 1].kind !== entry.kind;
          const isActive = index === cursor;
          return <Fragment key={entry.key}>
            {header && <div className="sp-group" role="presentation">{groupLabel(entry.kind)}</div>}
            <button type="button" id={"sp-opt-" + index} role="option" aria-selected={isActive} tabIndex={-1}
              className={"sp-item sp-item--" + entry.kind} data-active={isActive}
              onMouseMove={() => { if (cursor !== index) setCursor(index); }} onClick={() => choose(entry)}>
              <span className="sp-item-icon">{entry.icon}</span>
              <span className="sp-item-copy">
                <span className="sp-item-title"><strong><Highlight text={entry.label} term={term}/></strong>
                  {entry.when && <time>{entry.when}</time>}</span>
                {entry.detail && <small><Highlight text={entry.detail} term={term}/></small>}
              </span>
              {entry.hint && <kbd>{entry.hint}</kbd>}
              <CornerDownLeft size={14} className="sp-enter" aria-hidden="true"/>
            </button>
          </Fragment>;
        })}
      </div>
      <div className="sp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t("选择")}</span><span><kbd>Enter</kbd> {t("打开")}</span><span><kbd>Esc</kbd> {t("关闭")}</span></div>
    </div>
  </div>;
}

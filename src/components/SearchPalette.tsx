import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CornerDownLeft, MessageCircle, Search, X } from "lucide-react";
import type { Conversation } from "../types";

export type PaletteCommand = { id: string; label: string; icon: ReactNode; hint?: string; run: () => void };

type Props = {
  t: (text: string) => string;
  conversations: Conversation[];
  commands: PaletteCommand[];
  onSelectChat: (id: string) => void;
  onClose: () => void;
};

type Entry = { key: string; kind: "chat" | "command"; label: string; detail?: string; icon: ReactNode; hint?: string; run: () => void };

function snippet(chat: Conversation, term: string): string | undefined {
  if (!term) return undefined;
  const hit = chat.messages.find((m) => m.content.toLowerCase().includes(term));
  if (!hit) return undefined;
  const at = hit.content.toLowerCase().indexOf(term);
  const start = Math.max(0, at - 24);
  return (start > 0 ? "…" : "") + hit.content.slice(start, at + term.length + 48).replace(/\s+/g, " ");
}

/** ⌘K palette: fuzzy search across conversation titles/content plus quick commands. */
export default function SearchPalette({ t, conversations, commands, onSelectChat, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const entries = useMemo<Entry[]>(() => {
    const term = query.trim().toLowerCase();
    const chats = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((c) => !term || c.title.toLowerCase().includes(term) || c.messages.some((m) => m.content.toLowerCase().includes(term)))
      .slice(0, term ? 30 : 8)
      .map<Entry>((c) => ({ key: "chat:" + c.id, kind: "chat", label: c.title, detail: snippet(c, term),
        icon: <MessageCircle size={16}/>, run: () => onSelectChat(c.id) }));
    const cmds = commands.filter((c) => !term || c.label.toLowerCase().includes(term))
      .map<Entry>((c) => ({ key: "cmd:" + c.id, kind: "command", label: c.label, icon: c.icon, hint: c.hint, run: c.run }));
    return [...cmds, ...chats];
  }, [query, conversations, commands, onSelectChat]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-active=true]")?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function choose(entry: Entry | undefined) { if (!entry) return; onClose(); entry.run(); }

  return <div className="sp-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sp-panel" role="dialog" aria-modal="true" aria-label={t("搜索对话")}>
      <div className="sp-input">
        <Search size={18}/>
        <input ref={inputRef} value={query} placeholder={t("搜索对话或输入命令…")} aria-label={t("搜索对话")}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(entries.length - 1, c + 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
            else if (e.key === "Enter") { e.preventDefault(); choose(entries[cursor]); }
            else if (e.key === "Escape") { e.preventDefault(); onClose(); }
          }}/>
        <button type="button" className="sp-close" onClick={onClose} aria-label={t("关闭搜索")}><X size={16}/></button>
      </div>
      <div className="sp-list" ref={listRef}>
        {entries.length === 0 && <div className="sp-empty">{t("没有找到相关对话")}</div>}
        {entries.map((entry, index) => {
          const header = index === 0 || entries[index - 1].kind !== entry.kind;
          return <div key={entry.key}>
            {header && <div className="sp-group">{entry.kind === "command" ? t("快捷操作") : query ? t("对话") : t("最近对话")}</div>}
            <button type="button" className="sp-item" data-active={index === cursor} onMouseMove={() => setCursor(index)}
              onClick={() => choose(entry)}>
              <span className="sp-item-icon">{entry.icon}</span>
              <span className="sp-item-copy"><strong>{entry.label}</strong>{entry.detail && <small>{entry.detail}</small>}</span>
              {entry.hint && <kbd>{entry.hint}</kbd>}
              {index === cursor && <CornerDownLeft size={14} className="sp-enter"/>}
            </button>
          </div>;
        })}
      </div>
      <div className="sp-foot"><span><kbd>↑</kbd><kbd>↓</kbd> {t("选择")}</span><span><kbd>Enter</kbd> {t("打开")}</span><span><kbd>Esc</kbd> {t("关闭")}</span></div>
    </div>
  </div>;
}

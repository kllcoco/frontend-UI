import { useEffect, useMemo, useRef, useState } from "react";
import { BookMarked, Plus, Search, Trash2, X } from "lucide-react";
import { loadPrompts, savePrompts } from "../lib/prompts";
import type { SavedPrompt } from "../lib/prompts";
import { newId } from "../lib/storage";

type Props = {
  t: (text: string) => string;
  draft: string;
  onInsert: (content: string) => void;
  onClose: () => void;
};

/** Prompt library dialog: search, insert, save the current draft, edit and delete. */
export default function PromptLibrary({ t, draft, onInsert, onClose }: Props) {
  const [prompts, setPrompts] = useState<SavedPrompt[]>(loadPrompts);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ id: string | null; title: string; content: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => { savePrompts(prompts); }, [prompts]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); if (editing) setEditing(null); else onClose(); } };
    document.addEventListener("keydown", esc, true);
    return () => document.removeEventListener("keydown", esc, true);
  }, [editing, onClose]);

  const list = useMemo(() => {
    const term = query.trim().toLowerCase();
    return [...prompts].sort((a, b) => b.uses - a.uses || b.createdAt - a.createdAt)
      .filter((p) => !term || p.title.toLowerCase().includes(term) || p.content.toLowerCase().includes(term));
  }, [prompts, query]);

  function save() {
    if (!editing || !editing.title.trim() || !editing.content.trim()) return;
    const value = { title: editing.title.trim().slice(0, 60), content: editing.content.slice(0, 8000) };
    setPrompts((old) => editing.id
      ? old.map((p) => p.id === editing.id ? { ...p, ...value } : p)
      : [{ id: newId(), createdAt: Date.now(), uses: 0, ...value }, ...old]);
    setEditing(null);
  }
  function use(p: SavedPrompt) {
    setPrompts((old) => old.map((x) => x.id === p.id ? { ...x, uses: x.uses + 1 } : x));
    onInsert(p.content);
  }

  return <div className="sp-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sp-panel pl-panel" role="dialog" aria-modal="true" aria-label={t("提示词库")}>
      <div className="pl-head">
        <BookMarked size={18}/><strong>{t("提示词库")}</strong>
        <button type="button" className="sp-close" onClick={onClose} aria-label={t("关闭")}><X size={16}/></button>
      </div>
      {editing ? <div className="pl-editor">
        <input className="pl-input" autoFocus value={editing.title} maxLength={60} placeholder={t("标题")} aria-label={t("标题")}
          onChange={(e) => setEditing({ ...editing, title: e.target.value })}/>
        <textarea className="pl-input pl-textarea" rows={8} value={editing.content} placeholder={t("提示词内容")} aria-label={t("提示词内容")}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}/>
        <div className="pl-editor-actions">
          <button type="button" className="cx-btn" onClick={() => setEditing(null)}>{t("取消")}</button>
          <button type="button" className="cx-btn cx-btn--primary" disabled={!editing.title.trim() || !editing.content.trim()} onClick={save}>{t("保存")}</button>
        </div>
      </div> : <>
        <div className="sp-input">
          <Search size={17}/>
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("搜索提示词…")} aria-label={t("搜索提示词")}/>
        </div>
        <div className="pl-tools">
          <button type="button" onClick={() => setEditing({ id: null, title: "", content: "" })}><Plus size={15}/>{t("新建提示词")}</button>
          {draft.trim() && <button type="button" onClick={() => setEditing({ id: null, title: draft.trim().slice(0, 24), content: draft })}>
            <BookMarked size={15}/>{t("保存当前输入")}</button>}
        </div>
        <div className="sp-list">
          {list.length === 0 && <div className="sp-empty">{t("还没有提示词")}</div>}
          {list.map((p) => <div className="pl-item" key={p.id}>
            <button type="button" className="pl-use" onClick={() => use(p)}>
              <strong>{p.title}</strong><small>{p.content.replace(/\s+/g, " ").slice(0, 90)}</small>
            </button>
            <button type="button" className="pl-mini" aria-label={t("编辑") + " " + p.title} onClick={() => setEditing({ id: p.id, title: p.title, content: p.content })}>{t("编辑")}</button>
            <button type="button" className="pl-mini pl-del" aria-label={t("删除") + " " + p.title}
              onClick={() => setPrompts((old) => old.filter((x) => x.id !== p.id))}><Trash2 size={14}/></button>
          </div>)}
        </div>
      </>}
    </div>
  </div>;
}

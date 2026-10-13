import { useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Archive, ArchiveRestore, ArrowDownToLine, FileUp, Search, Trash2 } from "lucide-react";
import type { Conversation } from "../types";

export type BulkAction = "archive" | "unarchive" | "delete" | "export";

type Props = {
  t: (text: string) => string;
  conversations: Conversation[];
  onBulk: (action: BulkAction, ids: string[]) => void;
  onImport: (items: Conversation[]) => number;
  onError: (text: string) => void;
};

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const c = value as Conversation;
  return typeof c.id === "string" && typeof c.title === "string" && typeof c.updatedAt === "number" &&
    Array.isArray(c.messages) && c.messages.every((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
}
/** Accepts Ciro's export (schema CIRO_CLIENT_CONVERSATIONS_V1) or a bare array of conversations. */
export function parseImport(text: string): Conversation[] {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data) ? data : (data && typeof data === "object" && Array.isArray((data as { conversations?: unknown }).conversations))
    ? (data as { conversations: unknown[] }).conversations : null;
  if (!list) throw new Error("format");
  return list.filter(isConversation).map((c) => ({ ...c, temporary: undefined, createdAt: typeof c.createdAt === "number" ? c.createdAt : c.updatedAt }));
}

/** Settings → Files & storage: import, filter, multi-select archive/unarchive/export/delete. */
export default function ConversationManager({ t, conversations, onBulk, onImport, onError }: Props) {
  const [filter, setFilter] = useState<"all" | "archived">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => conversations.filter((c) => !c.temporary)
    .filter((c) => filter === "all" || c.archived)
    .filter((c) => !query.trim() || c.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt), [conversations, filter, query]);
  const allChecked = list.length > 0 && list.every((c) => selected.has(c.id));
  const ids = [...selected].filter((id) => list.some((c) => c.id === id));

  function toggle(id: string) {
    setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  function run(action: BulkAction) {
    if (!ids.length) return;
    if (action === "delete" && !window.confirm(t("确定删除所选的 ") + ids.length + t(" 个对话？此操作无法撤销。"))) return;
    onBulk(action, ids);
    if (action !== "export") setSelected(new Set());
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { onImport(parseImport(await file.text())); }
    catch { onError(t("无法导入：文件不是 Ciro 导出的对话文件")); }
  }

  return <div className="cm-root">
    <div className="cm-toolbar">
      <div className="cm-search"><Search size={14}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("筛选对话…")} aria-label={t("筛选对话")}/></div>
      <div className="sc-segmented cm-filter">
        <button className={filter === "all" ? "sc-selected" : ""} onClick={() => setFilter("all")}>{t("全部")}</button>
        <button className={filter === "archived" ? "sc-selected" : ""} onClick={() => setFilter("archived")}>{t("已归档")}</button>
      </div>
      <button className="sc-action-secondary" onClick={() => fileRef.current?.click()}><FileUp size={15}/> {t("导入对话")}</button>
      <input ref={fileRef} type="file" hidden accept="application/json,.json" onChange={(e) => void importFile(e)} aria-label={t("导入对话")}/>
    </div>
    <div className="cm-actions">
      <label className="cm-check"><input type="checkbox" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(list.map((c) => c.id)))}
        aria-label={t("全选")}/>{ids.length ? t("已选择") + " " + ids.length : t("全选")}</label>
      <button disabled={!ids.length} onClick={() => run("archive")}><Archive size={14}/>{t("归档")}</button>
      <button disabled={!ids.length} onClick={() => run("unarchive")}><ArchiveRestore size={14}/>{t("取消归档")}</button>
      <button disabled={!ids.length} onClick={() => run("export")}><ArrowDownToLine size={14}/>{t("导出所选")}</button>
      <button disabled={!ids.length} className="danger" onClick={() => run("delete")}><Trash2 size={14}/>{t("删除所选")}</button>
    </div>
    <div className="cm-list">
      {list.length === 0 && <p className="cm-empty">{filter === "archived" ? t("没有已归档的对话") : t("没有对话")}</p>}
      {list.map((c) => <label key={c.id} className={selected.has(c.id) ? "cm-row cm-row--on" : "cm-row"}>
        <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={c.title}/>
        <span className="cm-title">{c.title}</span>
        {c.archived && <span className="cm-badge">{t("已归档")}</span>}
        <small>{c.messages.length} · {new Date(c.updatedAt).toLocaleDateString()}</small>
      </label>)}
    </div>
  </div>;
}

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { addMemory, listMemories, removeMemory } from "../lib/memory";
import type { Memory } from "../lib/memory";

/** Settings → Custom instructions: what Ciro remembers about you. */
export default function MemoryManager({ t, enabled }: { t: (s: string) => string; enabled: boolean }) {
  const [items, setItems] = useState<Memory[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  async function refresh() { try { setItems(await listMemories()); setError(""); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  useEffect(() => { void refresh(); }, []);
  async function add() {
    if (!draft.trim()) return;
    try { await addMemory(draft); setDraft(""); await refresh(); }
    catch (e) { setError(e instanceof Error && e.message === "limit" ? t("最多保存 50 条记忆") : e instanceof Error ? e.message : String(e)); }
  }
  return <div className="mm-root">
    {!enabled && <p className="sc-help-text">{t("记忆已关闭：已保存的内容不会随对话发送。")}</p>}
    <form className="mm-add" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <input className="sc-text-input" value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)}
        placeholder={t("例如：我是前端工程师，偏好 TypeScript")} aria-label={t("添加记忆")}/>
      <button className="sc-action-secondary" disabled={!draft.trim()}><Plus size={15}/> {t("添加")}</button>
    </form>
    <div className="mm-list">
      {items.length === 0 && <p className="cm-empty">{t("还没有记忆。在对话中点消息下方的「记住」即可添加。")}</p>}
      {items.map((m) => <div className="mm-item" key={m.id}>
        <span>{m.content}</span>
        <button type="button" aria-label={t("删除记忆") + " " + m.content.slice(0, 20)} onClick={() => void removeMemory(m.id).then(refresh)}><Trash2 size={14}/></button>
      </div>)}
    </div>
    {error && <p className="sc-error" role="alert">{error}</p>}
  </div>;
}

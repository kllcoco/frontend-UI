import { useEffect, useState } from "react";
import { Check, Copy, Link2, RefreshCw, Trash2, X } from "lucide-react";
import { accountFetch } from "../lib/account-api";
import type { Conversation } from "../types";

type Props = {
  t: (text: string) => string;
  chat: Conversation;
  onShared: (shareId: string | undefined) => void;
  onClose: () => void;
};

async function call(path: string, method: string, body?: unknown) {
  const response = await accountFetch("/api/share" + path, {
    method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error || "HTTP " + response.status);
  return data as { id?: string };
}

/** Create / refresh / revoke a read-only snapshot link for one conversation. */
export default function ShareDialog({ t, chat, onShared, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const link = chat.shareId ? window.location.origin + "/share/" + chat.shareId : "";
  const messages = chat.messages.filter((m) => !m.preview && m.content.trim()).map(({ role, content }) => ({ role, content }));

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  async function publish() {
    setBusy(true); setError("");
    try {
      if (chat.shareId) await call("/" + chat.shareId, "DELETE").catch(() => undefined);
      const { id } = await call("", "POST", { title: chat.title, messages });
      onShared(id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function revoke() {
    if (!chat.shareId) return;
    setBusy(true); setError("");
    try { await call("/" + chat.shareId, "DELETE"); onShared(undefined); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* blocked */ }
  }

  return <div className="sp-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="sp-panel sh-panel" role="dialog" aria-modal="true" aria-label={t("分享对话")}>
      <div className="pl-head"><Link2 size={18}/><strong>{t("分享对话")}</strong>
        <button type="button" className="sp-close" onClick={onClose} aria-label={t("关闭")}><X size={16}/></button></div>
      <div className="sh-body">
        <p className="sh-note">{t("生成一个只读链接，任何拿到链接的人都能查看此刻的对话内容。之后的新消息不会自动同步，可随时更新或停止分享。")}</p>
        {messages.length === 0 && <p className="sc-error">{t("这个对话还没有可分享的内容")}</p>}
        {link ? <>
          <div className="sh-link"><input readOnly value={link} aria-label={t("分享链接")} onFocus={(e) => e.currentTarget.select()}/>
            <button type="button" className="cx-btn cx-btn--primary" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>}{copied ? t("已复制") : t("复制链接")}</button></div>
          <div className="sh-actions">
            <button type="button" className="cx-btn" disabled={busy} onClick={() => void publish()}><RefreshCw size={14}/>{t("更新为最新内容")}</button>
            <button type="button" className="cx-btn sh-danger" disabled={busy} onClick={() => void revoke()}><Trash2 size={14}/>{t("停止分享")}</button>
          </div>
        </> : <button type="button" className="cx-btn cx-btn--primary sh-create" disabled={busy || messages.length === 0} onClick={() => void publish()}>
          <Link2 size={15}/>{busy ? t("正在生成…") : t("创建分享链接")}</button>}
        <p className="sh-hint">{t("链接指向当前 Ciro 服务器；桌面版本地服务只能在本机访问，对外分享请使用部署在服务器上的 Ciro。")}</p>
        {error && <p className="sc-error" role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}

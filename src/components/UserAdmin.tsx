import { useEffect, useState } from "react";
import { Copy, Search, Ticket, Trash2, UserCheck, UserX } from "lucide-react";
import { accountApi } from "../lib/account-api";

type User = { id: string; email: string; displayName: string; role: "owner" | "user"; createdAt: string; lastSeenAt: string | null; disabled: boolean; apiKeys: number };
type Invite = { code: string; createdAt: string; expiresAt: number };
type Data = { users: User[]; registration: "open" | "invite" | "closed"; invites: Invite[] };

/** Settings → 用户管理 (server owner only): everyone registered on this server, invite codes, disable / remove. */
export default function UserAdmin({ t, locale }: { t: (s: string) => string; locale: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const refresh = () => accountApi<Data>("/admin/users").then(setData, (e) => setMsg(e instanceof Error ? e.message : String(e)));
  useEffect(() => { void refresh(); }, []);
  async function run(task: () => Promise<unknown>, done?: string) {
    setBusy(true); setMsg("");
    try { await task(); if (done) setMsg(t(done)); await refresh(); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const when = (v: string | number | null) => v ? new Date(v).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "—";
  const q = query.trim().toLowerCase();
  const users = (data?.users || []).filter((u) => !q || (u.email + " " + u.displayName).toLowerCase().includes(q));
  const mode = data?.registration;
  return <div className="ua-root">
    <p className="api-muted">{t("这台服务器上注册的所有账户。每个人的对话、API 密钥、记忆和同步数据互相隔离；工作台、融合工作台、插件和公告只有你（服务器所有者）能用。")}</p>
    {data && <div className="ua-mode"><strong>{t("注册方式")}</strong>
      <span>{t(mode === "open" ? "开放注册：任何人都可以注册" : mode === "invite" ? "邀请注册：需要你发出的邀请码" : "关闭：只有你一个账户")}</span>
      <small>{t("在服务器的 CIRO_REGISTRATION 中修改（open / invite / closed）")}</small></div>}
    {mode === "invite" && <section className="ua-invites">
      <div className="ua-head"><h4>{t("邀请码")}</h4>
        <button type="button" className="api-run" disabled={busy} onClick={() => void run(() => accountApi("/admin/invites", "POST", { days: 7 }), "已生成邀请码，7 天内有效，只能用一次")}>
          <Ticket size={15}/>{t("生成邀请码")}</button></div>
      {!data?.invites.length && <p className="api-muted">{t("暂无可用的邀请码")}</p>}
      {data?.invites.map((i) => <div key={i.code} className="ua-invite"><code>{i.code}</code><small>{t("截止")} {when(i.expiresAt)}</small>
        <button type="button" className="cx-icon" aria-label={t("复制") + " " + i.code} onClick={() => void navigator.clipboard?.writeText(i.code).then(() => setMsg(t("已复制")))}><Copy size={15}/></button>
        <button type="button" className="cx-icon" aria-label={t("作废") + " " + i.code} onClick={() => void run(() => accountApi("/admin/invites/" + i.code, "DELETE"))}><Trash2 size={15}/></button></div>)}
    </section>}
    <div className="ua-head"><h4>{t("用户")} {data ? "(" + data.users.length + ")" : ""}</h4>
      <label className="ua-search"><Search size={14}/><input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("搜索邮箱或名称")} aria-label={t("搜索邮箱或名称")}/></label></div>
    {msg && <p className="api-muted" role="status">{msg}</p>}
    {users.map((u) => <div key={u.id} className={u.disabled ? "ua-user ua-user--off" : "ua-user"}>
      <div><strong>{u.displayName}{u.role === "owner" && <em>{t("所有者")}</em>}{u.disabled && <em className="ua-off">{t("已停用")}</em>}</strong>
        <small>{u.email}</small>
        <small>{t("注册于")} {when(u.createdAt)} · {t("最近登录")} {when(u.lastSeenAt)} · {u.apiKeys} {t("个 API 密钥")}</small></div>
      {u.role !== "owner" && <div className="ua-actions">
        <button type="button" className="cx-icon" disabled={busy} aria-label={t(u.disabled ? "恢复账户" : "停用账户") + " " + u.email} title={t(u.disabled ? "恢复账户" : "停用账户")}
          onClick={() => void run(() => accountApi("/admin/users/" + u.id, "POST", { disabled: !u.disabled }), u.disabled ? "已恢复" : "已停用，该用户已被登出")}>
          {u.disabled ? <UserCheck size={16}/> : <UserX size={16}/>}</button>
        <button type="button" className="cx-icon" disabled={busy} aria-label={t("删除账户") + " " + u.email} title={t("删除账户")}
          onClick={() => { if (window.confirm(t("删除这个账户及其同步数据、密钥和记忆？此操作无法撤销。"))) void run(() => accountApi("/admin/users/" + u.id, "DELETE"), "已删除"); }}>
          <Trash2 size={16}/></button></div>}
    </div>)}
    {data && !users.length && <p className="api-muted">{t("没有找到相关用户")}</p>}
  </div>;
}

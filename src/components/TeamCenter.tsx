import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Copy, FileUp, Link2, Mail, ShieldCheck, Trash2, Users } from "lucide-react";
import { accountFetch, readApiJson} from "../lib/account-api";

type Role = "owner" | "admin" | "member" | "viewer";
type Member = { id: string; name?: string; email: string; role: Role; joinedAt?: string };
type Invite = { id: string; email: string; role: Role; link?: string; createdAt?: string };
type TeamState = { enabled: boolean; name?: string; myRole?: Role; members?: Member[]; invites?: Invite[] };

const ROLES: Role[] = ["admin", "member", "viewer"];
const ROLE_NAMES: Record<Role, string> = { owner: "所有者", admin: "管理员", member: "成员", viewer: "只读" };

async function call<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await accountFetch("/api/team" + path, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  return readApiJson<T>(response, "Team request failed");
}

/** Settings → Team. Contract: GET /api/team, POST/DELETE /api/team/invites, PATCH/DELETE /api/team/members/:id. */
export default function TeamCenter({ t, onImportProject }: { t: (s: string) => string; onImportProject: (file: File) => Promise<void> }) {
  const [state, setState] = useState<TeamState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const fileRef = useRef<HTMLInputElement>(null);
  async function refresh() {
    try { setState(await call<TeamState>("")); setError(""); } catch { setState({ enabled: false }); }
  }
  useEffect(() => { void refresh(); }, []);
  async function act(fn: () => Promise<unknown>, done: string) {
    setError(""); setNotice("");
    try { await fn(); await refresh(); setNotice(t(done)); } catch (e) { const raw = e instanceof Error ? e.message : String(e); setError(/HTTP \d|request failed|Failed to fetch|CIRO_/i.test(raw) ? t("操作失败，请稍后再试。") : raw); }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setError(t("请输入有效的邮箱")); return; }
    await act(() => call("/invites", "POST", { email: email.trim(), role }), "邀请已发送");
    setEmail("");
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try { await onImportProject(file); setNotice(t("项目已导入")); } catch { setError(t("无法导入：文件不是 Ciro 导出的项目")); }
  }
  const canManage = state?.myRole === "owner" || state?.myRole === "admin";

  return <div className="tm-root">
    {!state && <p className="sc-help-text">{t("正在读取团队信息…")}</p>}
    {state && !state.enabled && <div className="sc-info-card"><Users size={18}/><div>
      <strong>{t("团队功能即将推出")}</strong>
    </div></div>}
    {state?.enabled && <>
      <div className="tm-head"><Users size={18}/><strong>{state.name || t("我的团队")}</strong>
        {state.myRole && <span className="cm-badge">{t(ROLE_NAMES[state.myRole])}</span>}</div>
      {canManage && <form className="tm-invite" onSubmit={(e) => void invite(e)}>
        <Mail size={15}/>
        <input className="sc-text-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" aria-label={t("邀请成员的邮箱")}/>
        <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label={t("角色")}>
          {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_NAMES[r])}</option>)}
        </select>
        <button className="sc-action-secondary">{t("邀请")}</button>
      </form>}
      <div className="tm-list" role="table" aria-label={t("团队成员")}>
        {(state.members || []).map((m) => <div className="tm-row" role="row" key={m.id}>
          <span className="um-avatar">{(m.name || m.email)[0]?.toUpperCase()}</span>
          <span className="tm-who"><strong>{m.name || m.email}</strong><small>{m.email}</small></span>
          {canManage && m.role !== "owner"
            ? <select value={m.role} aria-label={t("角色") + " " + m.email} onChange={(e) => void act(() => call("/members/" + m.id, "PATCH", { role: e.target.value }), "角色已更新")}>
              {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_NAMES[r])}</option>)}</select>
            : <span className="cm-badge">{t(ROLE_NAMES[m.role])}</span>}
          {canManage && m.role !== "owner" && <button type="button" className="tm-del" aria-label={t("移除成员") + " " + m.email}
            onClick={() => { if (window.confirm(t("确定移除该成员？"))) void act(() => call("/members/" + m.id, "DELETE"), "成员已移除"); }}><Trash2 size={14}/></button>}
        </div>)}
      </div>
      {!!state.invites?.length && <>
        <h4 className="tm-sub">{t("待接受的邀请")}</h4>
        {state.invites.map((i) => <div className="tm-row" key={i.id}>
          <Link2 size={15}/><span className="tm-who"><strong>{i.email}</strong><small>{t(ROLE_NAMES[i.role])}</small></span>
          {i.link && <button type="button" className="tm-del" aria-label={t("复制邀请链接")} onClick={() => void navigator.clipboard.writeText(i.link!).then(() => setNotice(t("已复制")))}><Copy size={14}/></button>}
          {canManage && <button type="button" className="tm-del" aria-label={t("撤销邀请")} onClick={() => void act(() => call("/invites/" + i.id, "DELETE"), "邀请已撤销")}><Trash2 size={14}/></button>}
        </div>)}
      </>}
    </>}
    <div className="sc-info-card tm-share"><ShieldCheck size={18}/><div>
      <strong>{t("用文件共享项目")}</strong>
      <p>{t("在项目页点「导出项目」，把文件发给同事；对方在这里导入后即可获得项目指令、参考文件和其中的对话。")}</p>
      <button type="button" className="sc-action-secondary" onClick={() => fileRef.current?.click()}><FileUp size={15}/> {t("导入项目")}</button>
      <input ref={fileRef} type="file" hidden accept=".json,application/json" onChange={(e) => void importFile(e)} aria-label={t("导入项目")}/>
    </div></div>
    {notice && <p className="tm-notice" role="status">{notice}</p>}
    {error && <p className="sc-error" role="alert">{error}</p>}
  </div>;
}

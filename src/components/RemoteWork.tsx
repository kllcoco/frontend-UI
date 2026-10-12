import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Bot, Check, CircleStop, FolderOpen, FolderPlus, KeyRound, Laptop, Link2, LoaderCircle, MonitorSmartphone, Plus, QrCode, RefreshCcw, ScanLine, Send, Smartphone, Terminal, Trash2, Unlink, X } from "lucide-react";
import { accountFetch, readApiJson } from "../lib/account-api";
import QrScanner from "./QrScanner";

type Device = { id: string; name: string; platform: string; online: boolean; connected: boolean; lastSeen: number; folders: string[]; version: string };
type Session = { id: string; deviceId: string; kind: "shell" | "agent"; folder: string; title: string; status: string; autoApprove: boolean; updatedAt: number; lastSeq: number };
type RemoteEvent = { seq: number; at: number; type: string; data: Record<string, unknown> };
type LocalStatus = { paired: boolean; serverUrl: string; name: string; account: string; folders: string[]; enabled: boolean; online: boolean; lastError: string;
  active: { id: string; kind: string; folder: string; title: string; startedAt: number }[] };
type Grant = { id: string; label: string; createdAt: number };

const STATUS: Record<string, string> = { queued: "排队中", running: "运行中", waiting: "等待批准", idle: "已完成", done: "已完成", failed: "失败", stopped: "已停止", interrupted: "已中断" };
const live = (s?: string) => s === "queued" || s === "running" || s === "waiting";
const PENDING = "ciro.remote.connect";

async function cloud<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await accountFetch("/api/remote" + path, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  return readApiJson<T>(res, "Work mode request failed");
}
async function local<T = LocalStatus>(path: string, body?: unknown): Promise<T> {
  const res = await fetch("/api/remote/local" + path, { method: body === undefined ? "GET" : "POST", cache: "no-store",
    headers: { "X-Ciro-Local": "1", ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return readApiJson<T>(res, "Local request failed");
}
const desktopBridge = () => (window as unknown as { ciroDesktop?: { pickFolder?: () => Promise<string | null> } }).ciroDesktop;
const shortPath = (p: string) => p.length > 42 ? "…" + p.slice(-40) : p;
/** A scanned QR (or opened link) like https://server/remote/connect?device=…&nonce=… */
function parseConnect(text: string): { device: string; nonce: string; origin: string } | null {
  try {
    const u = new URL(text, window.location.origin);
    const device = u.searchParams.get("device"), nonce = u.searchParams.get("nonce");
    return u.pathname.endsWith("/remote/connect") && device && nonce ? { device, nonce, origin: u.origin } : null;
  } catch { return null; }
}

/** 协作空间 → 工作模式: control your own computers from any signed-in device, and set up this computer. */
export default function RemoteWork({ t }: { t: (text: string) => string }) {
  const [localState, setLocalState] = useState<LocalStatus | null>(null);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [cloudError, setCloudError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [openId, setOpenId] = useState("");
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");

  const refreshLocal = useCallback(async () => { try { setLocalState(await local("/status")); } catch { setLocalState(null); } }, []);
  const refreshDevices = useCallback(async () => {
    try {
      const { devices: list } = await cloud<{ devices: Device[] }>("/devices");
      setDevices(list); setCloudError("");
      setDeviceId((id) => id && list.some((d) => d.id === id) ? id : list.find((d) => d.connected && d.online)?.id || list.find((d) => d.online)?.id || list[0]?.id || "");
      return list;
    } catch (e) { setDevices(null); setCloudError(e instanceof Error ? e.message : String(e)); return null; }
  }, []);
  const connected = useCallback(async (d: Device) => {
    setDeviceId(d.id); setNotice(t("已连接到") + " " + d.name); setScanning(false); setTyping(false); setTyped("");
    sessionStorage.removeItem(PENDING);
    await refreshDevices();
  }, [refreshDevices, t]);
  const connectWith = useCallback(async (payload: { device?: string; nonce?: string; code?: string }) => {
    setError("");
    try {
      const { device } = payload.code
        ? await cloud<{ device: Device }>("/connect", "POST", { code: payload.code })
        : await cloud<{ device: Device }>("/devices/" + encodeURIComponent(payload.device!) + "/connect", "POST", { nonce: payload.nonce });
      await connected(device);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [connected]);
  const onScan = useCallback((text: string) => {
    setScanning(false);
    const target = parseConnect(text);
    if (!target) { setError(t("这不是 Ciro 电脑的连接二维码")); return; }
    if (target.origin !== window.location.origin) { setError(t("这个二维码属于另一台服务器：") + target.origin); return; }
    void connectWith({ device: target.device, nonce: target.nonce });
  }, [connectWith, t]);

  useEffect(() => {
    void refreshLocal();
    void refreshDevices().then((list) => {
      // Opened from the phone's own camera app (https://server/remote/connect?…): connect right away.
      const pending = sessionStorage.getItem(PENDING);
      const target = pending ? parseConnect(window.location.origin + "/remote/connect" + pending) : null;
      if (target && list) void connectWith({ device: target.device, nonce: target.nonce });
    });
    const timer = window.setInterval(() => { void refreshLocal(); void refreshDevices(); }, 8000);
    return () => window.clearInterval(timer);
  }, [refreshLocal, refreshDevices, connectWith]);
  const refreshSessions = useCallback(async () => {
    if (!deviceId) { setSessions([]); return; }
    try { setSessions((await cloud<{ sessions: Session[] }>("/sessions?deviceId=" + encodeURIComponent(deviceId))).sessions); } catch { /* shown via devices */ }
  }, [deviceId]);
  useEffect(() => { void refreshSessions(); }, [refreshSessions]);

  const act = async (fn: () => Promise<unknown>) => { setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  const device = devices?.find((d) => d.id === deviceId);
  const open = sessions.find((s) => s.id === openId);

  if (open || openId) return <SessionView t={t} sessionId={openId} initial={open} onBack={() => { setOpenId(""); void refreshSessions(); }}/>;

  return <section className="rw-root" aria-label={t("工作模式")}>
    <header className="rw-head">
      <MonitorSmartphone size={22}/>
      <div><h2>{t("工作模式")}</h2>
        <p>{t("人在外面，也能用手机继续指挥家里或公司的电脑：在允许的项目文件夹里运行命令，或交给 Ciro 完成一个任务，输出实时传回。")}</p></div>
    </header>
    {error && <div className="rw-alert" role="alert">{error}<button type="button" onClick={() => setError("")} aria-label={t("关闭")}><X size={14}/></button></div>}
    {notice && <div className="rw-ok" role="status"><Check size={15}/>{notice}<button type="button" onClick={() => setNotice("")} aria-label={t("关闭")}><X size={14}/></button></div>}
    {scanning && <QrScanner t={t} onResult={onScan} onClose={() => setScanning(false)}/>}

    {localState && <ThisComputer t={t} state={localState} onChange={setLocalState} onError={setError}/>}

    <div className="rw-card">
      <div className="rw-card-head"><strong><Laptop size={17}/>{t("我的电脑")}</strong>
        {devices && <div className="rw-head-actions">
          <button type="button" className="cx-btn" onClick={() => setScanning(true)}><ScanLine size={15}/>{t("扫码连接")}</button>
          <button type="button" className="cx-btn" onClick={() => { setTyping((v) => !v); setTyped(""); }}><KeyRound size={15}/>{t("输入配对码")}</button>
          <button type="button" className="cx-btn" onClick={() => void act(async () => setPairCode(await cloud("/pairing-code", "POST", {})))}><Plus size={15}/>{t("添加电脑")}</button>
        </div>}</div>
      {cloudError && localState?.paired && /需要|503|账户/.test(cloudError) ? <p className="rw-muted">
        {t("这台电脑已连接到")} <code>{localState.serverUrl}</code>{t("。在手机上打开这个地址并登录，进入 协作空间 → 工作模式，扫描上方二维码或输入配对码即可控制这台电脑。")}</p>
      : cloudError && <p className="rw-muted">{/需要|503|账户/.test(cloudError) ? t("工作模式需要连接一台开启了账户的 Ciro 服务器（按部署教程配置域名即可）。") : /sign in|登录|401/i.test(cloudError) ? t("请先登录 Ciro 账户，再控制你的电脑。") : cloudError}</p>}
      {typing && <form className="rw-typecode" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void connectWith({ code: typed.trim() }); }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={8} placeholder="ABCD2345"
          aria-label={t("电脑上显示的配对码")} autoComplete="off" autoCapitalize="characters" inputMode="text"/>
        <button type="submit" className="cx-btn cx-btn--primary" disabled={typed.length !== 8}><Link2 size={15}/>{t("连接")}</button>
        <small>{t("输入电脑上二维码下方显示的 8 位配对码")}</small>
      </form>}
      {pairCode && <div className="rw-code" role="dialog" aria-label={t("配对码")}>
        <span>{t("添加一台电脑")}</span><strong>{pairCode.code}</strong>
        <ol>
          <li>{t("在要添加的电脑上打开 Ciro → 协作空间 → 工作模式 → 配对码")}</li>
          <li>{t("填写服务器地址：")}<code>{window.location.origin}</code></li>
          <li>{t("输入上面的配对码（10 分钟内有效，只能使用一次）。添加后这部手机会自动连接那台电脑")}</li>
        </ol>
        <p className="rw-muted">{t("也可以直接在电脑上用账号登录，电脑会自动出现在这里。")}</p>
        <button type="button" className="cx-btn" onClick={() => setPairCode(null)}>{t("完成")}</button>
      </div>}
      {devices?.length === 0 && !pairCode && <p className="rw-muted">{t("还没有电脑。在电脑上的 Ciro → 协作空间 → 工作模式 登录同一个账号，或点击“添加电脑”获取配对码。")}</p>}
      {!!devices?.length && <div className="rw-devices" role="radiogroup" aria-label={t("选择电脑")}>
        {devices.map((d) => <button type="button" role="radio" aria-checked={d.id === deviceId} key={d.id}
          className={d.id === deviceId ? "rw-device rw-device--on" : "rw-device"} onClick={() => setDeviceId(d.id)}>
          <span className={d.online ? "rw-dot rw-dot--on" : "rw-dot"}/>
          <span><strong>{d.name}</strong><small>{d.online ? t("在线") : t("离线")} · {d.connected ? t("已连接") : t("未连接")} · {d.folders.length} {t("个文件夹")}</small></span>
          <span className="rw-device-del" role="button" aria-label={t("移除") + " " + d.name} onClick={(e) => { e.stopPropagation();
            if (window.confirm(t("从账号中移除这台电脑？之后需要在电脑上重新登录或配对。"))) void act(async () => { await cloud("/devices/" + d.id, "DELETE"); await refreshDevices(); }); }}><Trash2 size={14}/></span>
        </button>)}
      </div>}
      {device && !device.connected && <div className="rw-connect">
        <QrCode size={22}/>
        <div><strong>{t("还没有连接这台电脑")}</strong>
          <p className="rw-muted">{t("可以查看，但需要连接后才能下指令。打开电脑上的 Ciro → 协作空间 → 工作模式，扫描屏幕上的二维码，或输入二维码下方的配对码。")}</p></div>
        <div className="rw-head-actions">
          <button type="button" className="cx-btn cx-btn--primary" onClick={() => setScanning(true)}><ScanLine size={15}/>{t("扫码连接")}</button>
          <button type="button" className="cx-btn" onClick={() => { setTyping(true); setTyped(""); }}><KeyRound size={15}/>{t("输入配对码")}</button>
        </div>
      </div>}
      {device?.connected && <>
        <NewTask t={t} device={device} onStarted={(s) => { setSessions((list) => [s, ...list]); setOpenId(s.id); }} onError={setError}/>
        <button type="button" className="cx-btn rw-disconnect" onClick={() => void act(async () => { await cloud("/devices/" + device.id + "/disconnect", "POST", {}); await refreshDevices(); })}>
          <Unlink size={14}/>{t("断开与这台电脑的连接")}</button>
      </>}
      {device && sessions.length > 0 && <div className="rw-sessions">
        <span className="rw-label">{t("最近任务")}</span>
        {sessions.map((s) => <button type="button" key={s.id} className="rw-session" onClick={() => setOpenId(s.id)}>
          {s.kind === "agent" ? <Bot size={15}/> : <Terminal size={15}/>}
          <span><strong>{s.title}</strong><small>{shortPath(s.folder)} · {new Date(s.updatedAt).toLocaleString()}</small></span>
          <em className={"rw-status rw-status--" + s.status}>{t(STATUS[s.status] || s.status)}</em>
        </button>)}
      </div>}
    </div>
  </section>;
}

function ThisComputer({ t, state, onChange, onError }: { t: (s: string) => string; state: LocalStatus; onChange: (s: LocalStatus) => void; onError: (e: string) => void }) {
  const [method, setMethod] = useState<"login" | "code">("login");
  const [serverUrl, setServerUrl] = useState(state.serverUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState(state.name);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ url: string; code: string; expiresAt: number; image: string } | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [now, setNow] = useState(Date.now());
  const run = async (fn: () => Promise<LocalStatus>) => { setBusy(true); onError(""); try { onChange(await fn()); } catch (e) { onError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } };
  const addFolder = async (p: string) => { if (p.trim()) await run(() => local("/folders", { folders: [...state.folders, p.trim()] })); setPath(""); };
  const pick = desktopBridge()?.pickFolder;
  const live = state.paired && state.enabled;

  // QR code (and its 8-character code) refresh before they expire; connected phones are listed below.
  const loadQr = useCallback(async () => {
    try {
      const data = await local<{ url: string; code: string; expiresAt: number }>("/qr");
      const QR = await import("qrcode");
      const image = await QR.toDataURL(data.url, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: "#15201b", light: "#ffffff" } });
      setQr({ ...data, image });
    } catch { setQr(null); }
  }, []);
  const loadGrants = useCallback(async () => { try { setGrants((await local<{ grants: Grant[] }>("/grants")).grants); } catch { /* offline */ } }, []);
  useEffect(() => {
    if (!live) { setQr(null); return; }
    void loadQr(); void loadGrants();
    const refresh = window.setInterval(() => void loadQr(), 100_000);
    const poll = window.setInterval(() => void loadGrants(), 5000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(refresh); window.clearInterval(poll); window.clearInterval(clock); };
  }, [live, loadQr, loadGrants]);
  useEffect(() => { if (qr && qr.expiresAt - now < 5000) void loadQr(); }, [now, qr, loadQr]);

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() => method === "login" ? local("/login", { serverUrl, email, password, name }) : local("/pair", { serverUrl, code, name }));
    setPassword("");
  }
  return <div className="rw-card rw-card--local">
    <div className="rw-card-head"><strong><Laptop size={17}/>{t("这台电脑")}</strong>
      {state.paired && <span className={state.online && state.enabled ? "rw-pill rw-pill--on" : "rw-pill"}>
        {!state.enabled ? t("已暂停") : state.online ? t("在线，等待手机连接") : t("正在连接…")}</span>}</div>
    {!state.paired ? <form className="rw-form" onSubmit={submit}>
      <div className="rw-seg" role="radiogroup" aria-label={t("添加方式")}>
        <button type="button" role="radio" aria-checked={method === "login"} className={method === "login" ? "on" : ""} onClick={() => setMethod("login")}>{t("账号登录")}</button>
        <button type="button" role="radio" aria-checked={method === "code"} className={method === "code" ? "on" : ""} onClick={() => setMethod("code")}>{t("配对码")}</button>
      </div>
      <p className="rw-muted">{method === "login" ? t("登录你的 Ciro 账号，这台电脑会出现在同一账号的所有设备里。密码只用于这一次，不会保存在电脑上。")
        : t("在手机上打开 协作空间 → 工作模式 → 添加电脑，把得到的 8 位配对码填在这里。")}</p>
      <label>{t("服务器地址")}<input value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://ciro.example.com" required inputMode="url"/></label>
      {method === "login" ? <>
        <label>{t("邮箱")}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username"/></label>
        <label>{t("密码")}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password"/></label>
      </> : <label>{t("配对码")}<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD2345" required maxLength={12} autoComplete="off"/></label>}
      <label>{t("电脑名称")}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60}/></label>
      <button type="submit" className="cx-btn cx-btn--primary" disabled={busy}><Link2 size={15}/>{method === "login" ? t("登录并添加这台电脑") : t("连接")}</button>
    </form> : <>
      <p className="rw-muted">{t("服务器：")}{state.serverUrl}{state.account ? " · " + state.account : ""}{state.lastError ? " · " + state.lastError : ""}</p>
      {live && <div className="rw-qr">
        {qr ? <img src={qr.image} alt={t("连接二维码")} width={180} height={180}/> : <div className="rw-qr-wait"><LoaderCircle size={20} className="cx-spin"/></div>}
        <div>
          <strong>{t("用手机扫码连接")}</strong>
          <p className="rw-muted">{t("在手机上打开 Ciro → 协作空间 → 工作模式，点“扫码连接”，或用手机相机直接扫描。也可以输入配对码：")}</p>
          {qr && <code className="rw-qr-code" aria-label={t("配对码")}>{qr.code}</code>}
          {qr && <small className="rw-muted">{Math.max(0, Math.round((qr.expiresAt - now) / 1000))} {t("秒后自动刷新 · 只能使用一次")}</small>}
          <button type="button" className="cx-btn" onClick={() => void loadQr()}><RefreshCcw size={14}/>{t("刷新")}</button>
        </div>
      </div>}
      {grants.length > 0 && <div className="rw-grants">
        <span className="rw-label">{t("已连接的手机")}</span>
        {grants.map((g) => <div className="rw-folder" key={g.id}><Smartphone size={15}/><span>{g.label} · {new Date(g.createdAt).toLocaleString()}</span>
          <button type="button" aria-label={t("断开") + " " + g.label} onClick={() => void local("/grants/revoke", { id: g.id }).then(loadGrants)}><X size={14}/></button></div>)}
      </div>}
      <label className="rw-toggle"><input type="checkbox" checked={state.enabled} onChange={(e) => void run(() => local("/enabled", { enabled: e.target.checked }))}/>
        {t("允许手机远程控制这台电脑")}</label>
      {state.active.length > 0 && <div className="rw-live" role="status"><LoaderCircle size={14} className="cx-spin"/>
        {t("正在远程执行：")}{state.active.map((a) => a.title).join("；")}</div>}
      <span className="rw-label">{t("允许访问的项目文件夹（只有这些文件夹能被远程使用）")}</span>
      {state.folders.length === 0 && <p className="rw-muted">{t("还没有添加文件夹。")}</p>}
      {state.folders.map((f) => <div className="rw-folder" key={f}><FolderOpen size={15}/><span title={f}>{f}</span>
        <button type="button" aria-label={t("移除") + " " + f} onClick={() => void run(() => local("/folders", { folders: state.folders.filter((x) => x !== f) }))}><X size={14}/></button></div>)}
      <div className="rw-add">
        {pick ? <button type="button" className="cx-btn" disabled={busy} onClick={() => void pick().then((p) => { if (p) void addFolder(p); })}><FolderPlus size={15}/>{t("选择文件夹")}</button>
          : <><input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t("文件夹完整路径，例如 /home/me/project")} aria-label={t("文件夹路径")}/>
            <button type="button" className="cx-btn" disabled={busy || !path.trim()} onClick={() => void addFolder(path)}><FolderPlus size={15}/>{t("添加")}</button></>}
      </div>
      <button type="button" className="cx-btn rw-unpair" disabled={busy} onClick={() => { if (window.confirm(t("退出后手机将无法控制这台电脑，确定？"))) void run(() => local("/unpair", {})); }}>{t("退出并移除这台电脑")}</button>
    </>}
  </div>;
}

function NewTask({ t, device, onStarted, onError }: { t: (s: string) => string; device: Device; onStarted: (s: Session) => void; onError: (e: string) => void }) {
  const [folder, setFolder] = useState(device.folders[0] || "");
  const [kind, setKind] = useState<"shell" | "agent">("agent");
  const [text, setText] = useState("");
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setFolder((f) => device.folders.includes(f) ? f : device.folders[0] || ""); }, [device.folders]);
  if (!device.online) return <p className="rw-muted">{t("这台电脑当前离线。请确认电脑开机、Ciro 正在运行，并在“工作模式”里允许远程控制。")}</p>;
  if (!device.folders.length) return <p className="rw-muted">{t("这台电脑还没有允许任何文件夹。请在电脑上的“工作模式”里添加项目文件夹。")}</p>;
  async function start(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true); onError("");
    try { const { session } = await cloud<{ session: Session }>("/sessions", "POST", { deviceId: device.id, folder, kind, text, autoApprove: kind === "agent" && auto }); setText(""); onStarted(session); }
    catch (err) { onError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  return <form className="rw-new" onSubmit={start}>
    <div className="rw-row">
      <label className="rw-select"><FolderOpen size={15}/><select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label={t("项目文件夹")}>
        {device.folders.map((f) => <option key={f} value={f}>{shortPath(f)}</option>)}</select></label>
      <div className="rw-seg" role="radiogroup" aria-label={t("方式")}>
        <button type="button" role="radio" aria-checked={kind === "agent"} className={kind === "agent" ? "on" : ""} onClick={() => setKind("agent")}><Bot size={14}/>{t("AI 任务")}</button>
        <button type="button" role="radio" aria-checked={kind === "shell"} className={kind === "shell" ? "on" : ""} onClick={() => setKind("shell")}><Terminal size={14}/>{t("命令")}</button>
      </div>
    </div>
    <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label={t("要执行的内容")}
      placeholder={kind === "agent" ? t("描述要完成的事，例如：运行测试，修好失败的用例") : t("要运行的命令，例如：npm run build")}/>
    <div className="rw-row">
      {kind === "agent" ? <label className="rw-toggle"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)}/>{t("自动批准写文件和运行命令")}</label> : <span/>}
      <button type="submit" className="cx-btn cx-btn--primary" disabled={busy || !text.trim()}><Send size={15}/>{t("开始")}</button>
    </div>
  </form>;
}

function SessionView({ t, sessionId, initial, onBack }: { t: (s: string) => string; sessionId: string; initial?: Session; onBack: () => void }) {
  const [session, setSession] = useState<Session | undefined>(initial);
  const [events, setEvents] = useState<RemoteEvent[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    let stopped = false, after = 0;
    void (async () => {
      while (!stopped) {
        try {
          const res = await cloud<{ session: Session; events: RemoteEvent[] }>("/sessions/" + sessionId + "/events?after=" + after + "&wait=1");
          if (stopped) break;
          setSession(res.session);
          if (res.events.length) { after = res.events[res.events.length - 1].seq; setEvents((old) => [...old, ...res.events]); }
        } catch (e) { setError(e instanceof Error ? e.message : String(e)); await new Promise((r) => setTimeout(r, 3000)); }
      }
    })();
    return () => { stopped = true; };
  }, [sessionId]);
  useEffect(() => { if (stick.current) logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [events]);
  const resolved = new Set(events.filter((e) => e.type === "approval_result").map((e) => String(e.data.requestId)));
  const cwu = events.filter((e) => e.type === "usage").reduce((sum, e) => sum + Number(e.data.cwu || 0), 0);
  const send = async (path: string, body: unknown) => { setError(""); try { await cloud("/sessions/" + sessionId + "/" + path, "POST", body); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } };
  return <section className="rw-root rw-session-view" aria-label={t("远程任务")}>
    <header className="rw-sv-head">
      <button type="button" className="cx-icon" onClick={onBack} aria-label={t("返回")}><ArrowLeft size={18}/></button>
      <div><strong>{session?.title || "…"}</strong><small>{session ? shortPath(session.folder) : ""}{cwu ? " · " + cwu.toLocaleString() + " CWU" : ""}</small></div>
      <em className={"rw-status rw-status--" + (session?.status || "queued")}>{t(STATUS[session?.status || "queued"] || session?.status || "")}</em>
      {live(session?.status) && <button type="button" className="cx-btn" onClick={() => void send("stop", {})}><CircleStop size={15}/>{t("停止")}</button>}
    </header>
    {error && <div className="rw-alert" role="alert">{error}</div>}
    <div className="rw-log" ref={logRef} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {events.map((e) => {
        const d = e.data as Record<string, string | number | boolean>;
        switch (e.type) {
          case "user": return <div key={e.seq} className="rw-ev rw-ev--user">› {String(d.text)}</div>;
          case "stdout": case "stdin": return <pre key={e.seq} className="rw-ev rw-ev--out">{String(d.text)}</pre>;
          case "stderr": return <pre key={e.seq} className="rw-ev rw-ev--err">{String(d.text)}</pre>;
          case "agent": return <div key={e.seq} className={d.final ? "rw-ev rw-ev--final" : "rw-ev rw-ev--agent"}><Bot size={14}/><span>{String(d.text)}</span></div>;
          case "tool": return <div key={e.seq} className="rw-ev rw-ev--tool">⚙ {d.action === "run" ? t("运行") + "：" + d.command : d.action === "write" ? t("写入") + " " + d.path : d.action === "read" ? t("读取") + " " + d.path : t("查看目录") + " " + (d.path || ".")}</div>;
          case "exit": return <div key={e.seq} className={Number(d.code) === 0 ? "rw-ev rw-ev--exit" : "rw-ev rw-ev--exit rw-ev--bad"}>{t("退出码")} {String(d.code ?? d.signal)}</div>;
          case "approval_request": {
            const done = resolved.has(String(d.requestId));
            return <div key={e.seq} className="rw-approval">
              <strong>{d.action === "run" ? t("请求运行命令") : t("请求写入文件") + " " + d.path}</strong>
              <pre>{String(d.action === "run" ? d.command : d.preview ?? "")}</pre>
              {done ? <small>{t("已处理")}</small> : <div>
                <button type="button" className="cx-btn cx-btn--primary" onClick={() => void send("approve", { requestId: d.requestId, approve: true })}><Check size={15}/>{t("批准")}</button>
                <button type="button" className="cx-btn" onClick={() => void send("approve", { requestId: d.requestId, approve: false })}>{t("拒绝")}</button></div>}
            </div>;
          }
          case "approval_result": return null;
          case "status": return null;
          case "usage": return null;
          default: return null;
        }
      })}
      {live(session?.status) && <div className="rw-ev rw-ev--wait"><LoaderCircle size={14} className="cx-spin"/>{t(STATUS[session?.status || ""] || "")}</div>}
    </div>
    <form className="rw-input" onSubmit={(e) => { e.preventDefault(); if (input.trim()) { void send("input", { text: input }); setInput(""); } }}>
      <input value={input} onChange={(e) => setInput(e.target.value)} aria-label={t("继续输入")}
        placeholder={session?.kind === "agent" ? t("补充要求或下一步…") : session?.status === "running" ? t("发送给正在运行的程序…") : t("下一条命令…")}/>
      <button type="submit" className="cx-btn cx-btn--primary" disabled={!input.trim()} aria-label={t("发送")}><Send size={15}/></button>
    </form>
  </section>;
}

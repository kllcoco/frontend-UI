import {useCallback,useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import {
  Activity,ArrowUpRight,Bell,Check,CheckCircle2,
  CircleAlert,Cloud,CloudDownload,CloudUpload,Copy,CreditCard,
  Fingerprint,KeyRound,LockKeyhole,LogIn,LogOut,Plus,RefreshCcw,
  ShieldCheck,ShieldAlert,Trash2,UserCircle,Wallet,BookOpen
} from "lucide-react";
import type {Language} from "./lib/i18n";
import {accountTranslate} from "./lib/account-i18n";
import {accountApi,getAccountSession,refreshAuthAfterLogin,invalidateAccountSession,
  openVerifiedCheckout} from "./lib/account-api";
import type {AccountTab,SessionSnapshot} from "./lib/account-api";
import {commercialApi,formatUsdMicros} from "./lib/commercial-api";
import {loadConversations} from "./lib/storage";
import type {Conversation} from "./types";
import {autoSyncEnabled,configureAutoSync,currentSyncState,readLocalSnapshot,
  persistCloudSnapshot} from "./lib/cloud-sync";
import type {SyncSignal} from "./lib/cloud-sync";

type Props={language:Language;section:AccountTab};
type Profile={user:NonNullable<SessionSnapshot["user"]>;sessions:{id:string;createdAt:string;expiresAt:number}[];
  subscription:{configured:boolean;status:string;provider:string;cancelAtPeriodEnd:boolean;currentPeriodEnd:string|null;lastVerifiedAt:string|null}};
type ApiKey={id:string;name:string;prefix:string;scopes:string[];createdAt:string;expiresAt:number;revokedAt:string|null};
type Notification={id:string;type:string;title:string;body:string;createdAt:string;readAt:string|null};
type MemoryEntry={id:string;category:string;content:string;createdAt:string};
type Spending={dailyLimitMicros:number|null;monthlyLimitMicros:number|null;singleRequestLimitMicros:number|null;
  reservedCount:number;dailyCommittedPlusReservedMicros:number;monthlyCommittedPlusReservedMicros:number;admissionRequiresSignedRuntime:boolean};
type CloudSnapshot={conversations:Conversation[];activeId:string|null;preferences:Record<string,unknown>};
type SyncState={version:number;snapshot:CloudSnapshot|null;updatedAt:string|null};
const labels:Record<AccountTab,string>={
  account:"账户与安全",subscription:"订阅管理", "api-keys":"API 密钥",
  spending:"消费限额",notifications:"通知中心",memory:"记忆管理",sync:"跨设备同步"
};
const titleFor=(code:string)=>(code==="not_connected"?"尚未连接支付服务":code);
const money=(value:number|null,l:Language)=>formatUsdMicros(value,l==="en"?"en-US":"zh-CN");
const toDollar=(micro:number|null)=>micro===null?"":String(micro/1000000);
export default function AccountCenter({language,section}:Props){
  const t=(value:string)=>accountTranslate(language,value);
  const [session,setSession]=useState<SessionSnapshot|null>(null);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [keys,setKeys]=useState<ApiKey[]>([]);
  const [notifications,setNotifications]=useState<Notification[]>([]);
  const [memories,setMemories]=useState<MemoryEntry[]>([]);
  const [memoryEnabled,setMemoryEnabled]=useState(false);
  const [spending,setSpending]=useState<Spending|null>(null);
  const [sync,setSync]=useState<SyncState|null>(null);
  const [syncSignal,setSyncSignal]=useState<SyncSignal>(currentSyncState);
  const [automatic,setAutomatic]=useState(autoSyncEnabled);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),
    [bootstrap,setBootstrap]=useState(""),[displayName,setDisplayName]=useState("");
  const [oldPassword,setOldPassword]=useState(""),[newPassword,setNewPassword]=useState("");
  const [keyName,setKeyName]=useState(""),[keyDays,setKeyDays]=useState("90"),
    [keyScopes,setKeyScopes]=useState<string[]>(["chat:invoke"]),[newSecret,setNewSecret]=useState("");
  const [memoryText,setMemoryText]=useState(""),[memoryCategory,setMemoryCategory]=useState("general");
  const [daily,setDaily]=useState(""),[monthly,setMonthly]=useState(""),[single,setSingle]=useState("");
  const updatedSpending=useRef(false);
  const mounted=useRef(true);
  const refresh=useCallback(async(activeSection:AccountTab)=>{
    const current=await getAccountSession(true);
    if(!mounted.current)return;
    setSession(current);
    if(!current.enabled||!current.authenticated){setLoading(false);return;}
    const details=await accountApi<Profile>("/profile");
    if(!mounted.current)return;
    setProfile(details);setDisplayName(details.user.displayName);
    if(activeSection==="api-keys"){
      const result=await accountApi<{keys:ApiKey[]}>("/api-keys");if(mounted.current)setKeys(result.keys);
    }
    if(activeSection==="notifications"){
      const result=await accountApi<{notifications:Notification[]}>("/notifications");
      if(mounted.current)setNotifications(result.notifications);
    }
    if(activeSection==="memory"){
      const result=await accountApi<{memories:MemoryEntry[];enabled:boolean}>("/memories");
      if(mounted.current){setMemories(result.memories);setMemoryEnabled(result.enabled);}
    }
    if(activeSection==="sync"){
      const result=await accountApi<SyncState>("/sync");
      if(mounted.current)setSync(result);
    }
    if(activeSection==="spending"){
      const result=await commercialApi<Spending>("/billing/spending");
      if(mounted.current){
        setSpending(result);
        if(!updatedSpending.current){
          setDaily(toDollar(result.dailyLimitMicros));setMonthly(toDollar(result.monthlyLimitMicros));
          setSingle(toDollar(result.singleRequestLimitMicros));updatedSpending.current=true;
        }
      }
    }
    setLoading(false);
  },[]);
  useEffect(()=>{
    const listener=(event:Event)=>{
      const msg=event as CustomEvent<SyncSignal>;
      setSyncSignal(msg.detail);
    };
    window.addEventListener("ciro-cloud-sync",listener);
    return ()=>window.removeEventListener("ciro-cloud-sync",listener);
  },[]);
  useEffect(()=>{
    mounted.current=true;setLoading(true);setError("");
    void refresh(section).catch(e=>{if(mounted.current){setError(e instanceof Error?e.message:String(e));setLoading(false);}});
    return ()=>{mounted.current=false;};
  },[section,refresh]);
  useEffect(()=>{
    if(section!=="notifications"||!session?.authenticated)return;
    const timer=setInterval(()=>void refresh("notifications").catch(()=>{}),15000);
    return ()=>clearInterval(timer);
  },[section,session?.authenticated,refresh]);
  async function action(task:()=>Promise<unknown>,message="操作成功"){
    setBusy(true);setError("");setNotice("");
    try{await task();setNotice(t(message));await refresh(section);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  async function signIn(e:FormEvent<HTMLFormElement>,initial:boolean){
    e.preventDefault();
    await action(async()=>{
      await accountApi(initial?"/bootstrap":"/login","POST",{
        email,password,...(initial?{bootstrapToken:bootstrap,displayName}:{})
      });
      await refreshAuthAfterLogin();
      window.location.reload();
    },"已登录");
  }
  async function updatePassword(e:FormEvent<HTMLFormElement>){
    e.preventDefault();await action(async()=>{
      await accountApi("/password","POST",{currentPassword:oldPassword,newPassword});
      setOldPassword("");setNewPassword("");
    });
  }
  async function addApiKey(e:FormEvent<HTMLFormElement>){
    e.preventDefault();await action(async()=>{
      const response=await accountApi<{key:string}>("/api-keys","POST",{
        name:keyName,expiresDays:Number(keyDays),scopes:keyScopes
      });
      setNewSecret(response.key);setKeyName("");
    });
  }
  async function saveSpending(e:FormEvent<HTMLFormElement>){
    e.preventDefault();
    await action(()=>commercialApi("/billing/spending","POST",{
      dailyUsd:daily.trim()?daily.trim():null,monthlyUsd:monthly.trim()?monthly.trim():null,
      singleRequestUsd:single.trim()?single.trim():null
    }));
  }
  async function uploadCloud(){
    await action(async()=>{
      if(!sync)throw new Error(t("请刷新后重试"));
      const result=await accountApi<SyncState>("/sync","PUT",{
        baseVersion:sync.version,snapshot:readLocalSnapshot()
      });
      setSync({...result,snapshot:readLocalSnapshot()});
    },"上传成功");
  }
  async function restoreCloud(){
    if(!sync?.snapshot)throw new Error(t("服务器暂无快照"));
    await action(async()=>{
      const remote=sync.snapshot!;
      persistCloudSnapshot(remote);
      window.location.reload();
    },"恢复成功");
  }
  const note=profile?.subscription;
  const auth=session?.authenticated;
  return <section className="acc-root" aria-label={t(labels[section])}>
    <header className="acc-head">
      <span className="acc-eyebrow"><ShieldCheck size={15}/> CIRO ACCOUNT & SECURITY</span>
      <h2>{t(labels[section])}</h2>
      <p>{t("来自可信服务端")}</p>
    </header>
    {error&&<div className="acc-alert acc-error" role="alert"><CircleAlert size={16}/><span>{error}</span>
      <button onClick={()=>{setError("");void refresh(section);}}>{t("刷新")}</button></div>}
    {notice&&<div className="acc-alert acc-success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {loading&&<div className="acc-empty"><Activity size={23}/>{t("正在处理…")}</div>}
    {!loading&&session&&!session.enabled&&<div className="acc-card acc-unavailable"><LockKeyhole size={31}/>
      <h3>{t("账户尚未启用")}</h3><p>{t("要启用跨设备服务，请在服务器上配置账户系统。")}</p>
      <p>{t("当前是本地预览，不会伪造登录状态。")}</p></div>}
    {!loading&&session?.enabled&&!auth&&<div className="acc-card acc-login">
      <LogIn size={26}/><h3>{t(session.bootstrapAvailable?"初始化管理员账户":"登录 Ciro")}</h3>
      <p>{t(session.bootstrapAvailable?"使用服务端配置的一次性初始化口令。":"需要先登录才能管理此页面。")}</p>
      <form onSubmit={e=>void signIn(e,session.bootstrapAvailable)}>
        <label>{t("邮箱")}<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>
        {session.bootstrapAvailable&&<label>{t("显示名称")}<input required value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>}
        <label>{t("登录密码")}<input required type="password" minLength={12} autoComplete={session.bootstrapAvailable?"new-password":"current-password"} value={password}
          onChange={e=>setPassword(e.target.value)}/></label>
        {session.bootstrapAvailable&&<label>{t("初始化口令")}<input required type="password" autoComplete="off" value={bootstrap} onChange={e=>setBootstrap(e.target.value)}/></label>}
        <button className="acc-primary" type="submit" disabled={busy}>{t(session.bootstrapAvailable?"创建账户":"登录")}</button>
      </form>
    </div>}
    {!loading&&auth&&section==="account"&&<>
      <section className="acc-card"><div className="acc-section-title"><UserCircle size={19}/><h3>{t("账户与安全")}</h3></div>
        <p className="acc-metadata">{t("邮箱")}: {profile?.user.email}</p>
        <label className="acc-label">{t("显示名称")}<input value={displayName} maxLength={80} onChange={e=>setDisplayName(e.target.value)}/></label>
        <div className="acc-actions"><button className="acc-primary" onClick={()=>void action(()=>accountApi("/profile","POST",{displayName}))} disabled={busy}>{t("更新资料")}</button>
          <button className="acc-secondary" onClick={()=>void action(async()=>{
            await accountApi("/logout","POST",{});invalidateAccountSession();window.location.reload();
          })}><LogOut size={15}/>{t("安全退出")}</button></div>
      </section>
      <section className="acc-card"><div className="acc-section-title"><LockKeyhole size={19}/><h3>{t("更改密码")}</h3></div>
        <form onSubmit={e=>void updatePassword(e)} className="acc-fields">
          <label>{t("当前密码")}<input type="password" minLength={12} required autoComplete="current-password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label>
          <label>{t("新密码")}<input type="password" minLength={12} required autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label>
          <button className="acc-primary" disabled={busy}>{t("修改密码")}</button></form>
        <p className="acc-muted">{t("密码修改会注销其他设备，并撤销所有 API 密钥。")}</p>
      </section>
      <section className="acc-card"><div className="acc-section-title"><Fingerprint size={19}/><h3>{t("当前设备会话")}</h3></div>
        <p className="acc-metadata">{profile?.sessions.length||0} sessions</p>
        <button className="acc-secondary" onClick={()=>void action(()=>accountApi("/sessions/revoke","POST",{allOthers:true}))}>
          {t("撤销其他设备会话")}</button></section>
    </>}
    {!loading&&auth&&section==="subscription"&&<section className="acc-card acc-subscription">
      <div className="acc-section-title"><CreditCard size={19}/><h3>{t("订阅状态")}</h3></div>
      <div className="acc-state"><span>{t("来自可信服务端")}</span><strong>{t(titleFor(note?.status||"not_connected"))}</strong>
        <small>{note?.lastVerifiedAt||t("尚无已验证的订阅")}</small></div>
      {!note?.configured?<p className="acc-muted">{t("无法显示任何虚假的订阅方案或支付状态。")}</p>:<>
        <div className="acc-actions"><button className="acc-primary" onClick={()=>void action(async()=>{
          const reply=await accountApi<{url:string}>("/subscription/checkout","POST",{});
          openVerifiedCheckout(reply.url);
        })}><ArrowUpRight size={16}/>{t("前往安全结账")}</button>
        <button className="acc-secondary" onClick={()=>void action(async()=>{
          const reply=await accountApi<{url:string}>("/subscription/portal","POST",{});
          openVerifiedCheckout(reply.url);
        })}>{t("管理订阅")}</button></div>
        <p className="acc-muted">{t("付款由 Stripe 托管完成，只有签名回调更新订阅状态。")}</p>
      </>}
    </section>}
    {!loading&&auth&&section==="api-keys"&&<>
      <section className="acc-card"><div className="acc-section-title"><KeyRound size={19}/><h3>{t("创建密钥")}</h3></div>
        <form onSubmit={e=>void addApiKey(e)} className="acc-fields">
          <label>{t("密钥名称")}<input required maxLength={80} value={keyName} onChange={e=>setKeyName(e.target.value)} placeholder="CIRO CLI"/></label>
          <label>{t("有效期（天）")}<input type="number" min={1} max={365} required value={keyDays} onChange={e=>setKeyDays(e.target.value)}/></label>
          <div><strong className="acc-label-title">{t("允许的权限")}</strong>
            {["chat:invoke","sync:read","sync:write"].map(scope=><label key={scope} className="acc-checkbox">
              <input type="checkbox" checked={keyScopes.includes(scope)} onChange={e=>setKeyScopes(old=>
                e.target.checked?[...old,scope]:old.filter(x=>x!==scope))}/>{scope}</label>)}</div>
          <button className="acc-primary" disabled={busy||!keyScopes.length}>{t("创建密钥")}</button>
        </form>
        {newSecret&&<div className="acc-one-time"><ShieldAlert size={17}/><p>{t("密钥只显示一次，请妥善保存。")}</p>
          <code>{newSecret}</code><button className="acc-secondary" onClick={()=>void navigator.clipboard.writeText(newSecret)}><Copy size={14}/>{t("复制密钥")}</button></div>}
      </section>
      <section className="acc-card"><h3>{t("API 密钥")}</h3>{keys.length===0&&<p className="acc-muted">{t("没有 API 密钥")}</p>}
        {keys.map(k=><div className="acc-list-line" key={k.id}><div><strong>{k.name} · {k.prefix}…</strong>
          <small>{k.scopes.join(", ")} · {t("截止")}: {new Date(k.expiresAt).toLocaleDateString()}</small>
        </div><button className="acc-secondary" disabled={Boolean(k.revokedAt)} onClick={()=>void action(()=>accountApi("/api-keys/"+k.id+"/revoke","POST",{}))}>
          {k.revokedAt?t("已撤销"):t("撤销密钥")}</button></div>)}
      </section><p className="acc-muted">{t("密钥不会赋予管理员权限。")}</p>
    </>}
    {!loading&&auth&&section==="spending"&&<><section className="acc-card">
      <div className="acc-section-title"><Wallet size={19}/><h3>{t("消费限额")}</h3></div>
      <form onSubmit={e=>void saveSpending(e)} className="acc-fields">
        {([{title:"日限额（美元）",value:daily,change:setDaily},
          {title:"月限额（美元）",value:monthly,change:setMonthly},
          {title:"单次上限（美元）",value:single,change:setSingle}] as const).map(x=><label key={x.title}>{t(x.title)}
          <input inputMode="decimal" placeholder="Unlimited" value={x.value} onChange={e=>x.change(e.target.value)}/></label>)}
        <button className="acc-primary" disabled={busy}>{t("保存限额")}</button></form>
      <div className="acc-spend-cards"><div><span>{t("当前预留与累计费用")} · Daily</span><strong>{money(spending?.dailyCommittedPlusReservedMicros??0,language)}</strong></div>
        <div><span>{t("当前预留与累计费用")} · Monthly</span><strong>{money(spending?.monthlyCommittedPlusReservedMicros??0,language)}</strong></div>
        <div><span>{t("待结算额度")}</span><strong>{spending?.reservedCount??0}</strong></div></div>
      </section><p className="acc-warning"><CircleAlert size={16}/>{t("限额需要原生执行器预授权，才能真正阻止超额计算。")}</p></>}
    {!loading&&auth&&section==="notifications"&&<section className="acc-card">
      <div className="acc-section-title"><Bell size={19}/><h3>{t("通知中心")}</h3>
        <button className="acc-secondary" onClick={()=>void action(()=>accountApi("/notifications/read-all","POST",{}))}>{t("全部已读")}</button></div>
      {!notifications.length&&<div className="acc-empty">{t("暂无通知")}</div>}
      {notifications.map(n=><div className={n.readAt?"acc-notification":"acc-notification acc-notification--unread"} key={n.id}>
        <div><strong>{n.title}</strong><p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString(language==="en"?"en-US":"zh-CN")}</small></div>
        {!n.readAt&&<button className="acc-secondary" onClick={()=>void action(()=>accountApi("/notifications/"+n.id+"/read","POST",{}))}><Check size={14}/>{t("标记已读")}</button>}
      </div>)}
      <p className="acc-muted">{t("通知来自真实服务端事件，无法离线接收。")}</p>
    </section>}
    {!loading&&auth&&section==="memory"&&<><section className="acc-card">
      <div className="acc-section-title"><BookOpen size={19}/><h3>{t("记忆管理")}</h3></div>
      <label className="acc-toggle">{t("记忆开关")}
        <input type="checkbox" checked={memoryEnabled} onChange={e=>void action(()=>accountApi("/memories/preferences","POST",{enabled:e.target.checked}))}/></label>
      <form className="acc-fields" onSubmit={e=>{e.preventDefault();void action(async()=>{
        await accountApi("/memories","POST",{content:memoryText,category:memoryCategory});setMemoryText("");
      });}}>
        <label>{t("记忆内容")}<textarea required maxLength={1500} rows={4} value={memoryText} onChange={e=>setMemoryText(e.target.value)}/></label>
        <label>{t("类别")}<select value={memoryCategory} onChange={e=>setMemoryCategory(e.target.value)}>
          {["general","style","project"].map(x=><option value={x} key={x}>{t(x==="general"?"通用":x==="style"?"风格":"项目")}</option>)}</select></label>
        <button className="acc-primary" disabled={busy||!memoryText.trim()}><Plus size={15}/>{t("添加记忆")}</button></form>
      </section><section className="acc-card">
        {!memories.length&&<div className="acc-empty">{t("没有保存的记忆")}</div>}
        {memories.map(m=><div className="acc-list-line" key={m.id}>
          <div><strong>{m.content}</strong><small>{m.category} · {new Date(m.createdAt).toLocaleString()}</small></div>
          <button className="acc-secondary" onClick={()=>void action(()=>accountApi("/memories/"+m.id,"DELETE"))}><Trash2 size={15}/>{t("删除记忆")}</button>
        </div>)}</section>
      <p className="acc-muted">{t("记忆内容会加密存储，开启时可注入后续聊天上下文。")}</p>
    </>}
    {!loading&&auth&&section==="sync"&&<><section className="acc-card">
      <div className="acc-section-title"><Cloud size={19}/><h3>{t("跨设备同步")}</h3></div>
      <label className="acc-toggle">{t("自动同步")}
        <input type="checkbox" checked={automatic} onChange={e=>{
          const next=e.target.checked;configureAutoSync(next);setAutomatic(next);window.location.reload();
        }}/></label>
      <p className="acc-muted">{t("开启后对话与偏好将安全地同步至你登录的服务器。")}</p>
      <div className="acc-state"><span>{t("同步状态")}</span><strong>{syncSignal.status}</strong>
        <small>{syncSignal.message||t("同步已就绪")}</small></div>
      <div className="acc-sync-grid"><div><small>{t("本地对话")}</small><strong>{loadConversations().length}</strong></div>
        <div><small>{t("云端对话")}</small><strong>{sync?.snapshot?.conversations.length??0}</strong></div>
        <div><small>{t("服务器版本")}</small><strong>{sync?.version??"—"}</strong></div></div>
      <div className="acc-actions"><button className="acc-primary" disabled={busy||!sync} onClick={()=>void uploadCloud()}><CloudUpload size={16}/>{t("保存到服务器")}</button>
        <button className="acc-secondary" disabled={busy||!sync?.snapshot} onClick={()=>void restoreCloud()}><CloudDownload size={16}/>{t("从服务器恢复")}</button>
        <button className="acc-secondary" onClick={()=>void action(()=>refresh(section))}><RefreshCcw size={15}/>{t("刷新")}</button></div>
      <p className="acc-warning"><CircleAlert size={15}/>{t("检测到版本冲突，请先获取服务器的最新数据，再决定保留哪一份。")}</p>
      <p className="acc-muted">{t("相同账户可以从不同设备登录。")} {t("背景图片本体仍只保存在当前设备。")}</p>
    </section></>}
  </section>;
}

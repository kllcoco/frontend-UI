import { localeTag } from "./lib/i18n";
import {useCallback,useEffect,useRef,useState} from "react";
import type {FormEvent} from "react";
import {
  Activity,ArrowUpRight,Bell,Check,CheckCircle2,
  CircleAlert,Cloud,Copy,CreditCard,
  Fingerprint,KeyRound,LockKeyhole,LogIn,LogOut,Plus,RefreshCcw,
  ShieldAlert,Trash2,UserCircle,Wallet,BookOpen
} from "lucide-react";
import type {Language} from "./lib/i18n";
import {accountTranslate} from "./lib/account-i18n";
import {accountApi,getAccountSession,refreshAuthAfterLogin,invalidateAccountSession,
  openVerifiedCheckout} from "./lib/account-api";
import type {AccountTab,SessionSnapshot} from "./lib/account-api";
import {commercialApi,formatUsdMicros} from "./lib/commercial-api";
import {loadConversations} from "./lib/storage";
import {setSyncEnabled,syncEnabled,syncNow,syncSignal as currentSyncSignal} from "./lib/sync";
import type {SyncSignal} from "./lib/sync";

type Props={language:Language;section:AccountTab};
type Profile={user:NonNullable<SessionSnapshot["user"]>;sessions:{id:string;createdAt:string;expiresAt:number}[];
  subscription:{configured:boolean;status:string;provider:string;cancelAtPeriodEnd:boolean;currentPeriodEnd:string|null;lastVerifiedAt:string|null}};
type ApiKey={id:string;name:string;prefix:string;scopes:string[];createdAt:string;expiresAt:number;revokedAt:string|null};
type Notification={id:string;type:string;title:string;body:string;createdAt:string;readAt:string|null};
type MemoryEntry={id:string;category:string;content:string;createdAt:string};
type Spending={dailyLimitMicros:number|null;monthlyLimitMicros:number|null;singleRequestLimitMicros:number|null;
  reservedCount:number;dailyCommittedPlusReservedMicros:number;monthlyCommittedPlusReservedMicros:number;admissionRequiresSignedRuntime:boolean};
const labels:Record<AccountTab,string>={
  account:"账户与安全",subscription:"订阅管理", "api-keys":"API 控制台",
  spending:"消费限额",notifications:"通知中心",memory:"记忆管理",sync:"跨设备同步"
};
/** Customer-facing subscription state; raw provider status codes never reach the page. */
const SUBSCRIPTION_STATES:Record<string,string>={active:"已订阅",trialing:"试用中",past_due:"付款未完成",unpaid:"付款未完成",canceled:"已取消",incomplete:"付款未完成"};
const statusFor=(code:string|undefined)=>SUBSCRIPTION_STATES[code||""]||"暂未订阅";
/** API key scopes are sent to the server as-is but shown by name. */
const SCOPES:readonly [string,string][]=[["chat:invoke","对话"],["sync:read","读取同步"],["sync:write","写入同步"]];
const scopeName=(scope:string)=>SCOPES.find(([value])=>value===scope)?.[1]||scope;
const CATEGORIES:Record<string,string>={general:"通用",style:"风格",project:"项目"};
/** Server and network failures are reported in plain words; meaningful account messages pass through. */
function friendlyError(e:unknown):string{
  const raw=e instanceof Error?e.message:String(e);
  if(/Failed to fetch|NetworkError|Load failed|未连接到 Ciro 服务/i.test(raw))return "网络连接失败，请检查网络后重试。";
  if(/HTTP \d|CIRO_|\.env|request failed|account service|not configured|stripe|webhook/i.test(raw))return "操作失败，请稍后再试。";
  return raw;
}
const money=(value:number|null,l:Language)=>formatUsdMicros(value,l==="en"?"en-US":"zh-CN");
const toDollar=(micro:number|null)=>micro===null?"":String(micro/1000000);
export default function AccountCenter({language,section}:Props){
  const t=(value:string)=>accountTranslate(language,value);
  const day=(value:string|number)=>new Date(value).toLocaleDateString(localeTag(language));
  const [session,setSession]=useState<SessionSnapshot|null>(null);
  const [profile,setProfile]=useState<Profile|null>(null);
  const [keys,setKeys]=useState<ApiKey[]>([]);
  const [notifications,setNotifications]=useState<Notification[]>([]);
  const [memories,setMemories]=useState<MemoryEntry[]>([]);
  const [memoryEnabled,setMemoryEnabled]=useState(false);
  const [spending,setSpending]=useState<Spending|null>(null);
  const [syncSignal,setSyncSignal]=useState<SyncSignal>(currentSyncSignal);
  const [automatic,setAutomatic]=useState(syncEnabled);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),
    [bootstrap,setBootstrap]=useState(""),[displayName,setDisplayName]=useState("");
  const [registering,setRegistering]=useState(false),[invite,setInvite]=useState("");
  // Email is the default; a phone number with an SMS code is the alternative when the server offers it.
  const [byPhone,setByPhone]=useState(false),[phone,setPhone]=useState(""),[smsCode,setSmsCode]=useState(""),[smsWait,setSmsWait]=useState(0);
  useEffect(()=>{if(smsWait<=0)return;const id=window.setTimeout(()=>setSmsWait(w=>w-1),1000);return()=>window.clearTimeout(id);},[smsWait]);
  async function sendCode(){
    setError("");
    try{await accountApi("/sms/send","POST",{phone,purpose:registering?"register":"login"});setSmsWait(60);setNotice(t("验证码已发送"));}
    catch(e){setError(t(e instanceof Error&&/[\u4e00-\u9fff]/.test(e.message)?e.message:"验证码发送失败，请稍后再试"));}
  }
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
    if(activeSection==="sync")void syncNow();
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
    window.addEventListener("ciro-sync",listener);
    return ()=>window.removeEventListener("ciro-sync",listener);
  },[]);
  useEffect(()=>{
    mounted.current=true;setLoading(true);setError("");
    void refresh(section).catch(e=>{if(mounted.current){setError(t(friendlyError(e)));setLoading(false);}});
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
    catch(e){setError(t(friendlyError(e)));try{await refresh(section);}catch{/* keep reported error */}}
    finally{setBusy(false);}
  }
  async function signIn(e:FormEvent<HTMLFormElement>,initial:boolean){
    e.preventDefault();
    const signup=!initial&&registering;
    await action(async()=>{
      const phoneWay=byPhone&&!initial;
      await accountApi(initial?"/bootstrap":signup?"/register":"/login","POST",{
        ...(phoneWay?{phone,smsCode,...(password?{password}:{})}:{email,password}),
        ...(initial?{bootstrapToken:bootstrap,displayName}:{}),
        ...(signup?{...(displayName?{displayName}:{}),...(session?.registration==="invite"?{inviteCode:invite}:{})}:{})
      });
      await refreshAuthAfterLogin();
      void syncNow();
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
    await action(()=>commercialApi("/billing/spending",{
      dailyUsd:daily.trim()?daily.trim():null,monthlyUsd:monthly.trim()?monthly.trim():null,
      singleRequestUsd:single.trim()?single.trim():null
    }));
  }
  const note=profile?.subscription;
  const auth=session?.authenticated;
  return <section className="acc-root" aria-label={t(labels[section])}>
    <header className="acc-head">
      <h2>{t(labels[section])}</h2>
    </header>
    {error&&<div className="acc-alert acc-error" role="alert"><CircleAlert size={16}/><span>{error}</span>
      <button onClick={()=>{setError("");void refresh(section);}}>{t("刷新")}</button></div>}
    {notice&&<div className="acc-alert acc-success" role="status"><CheckCircle2 size={16}/>{notice}</div>}
    {loading&&<div className="acc-empty"><Activity size={23}/>{t("正在处理…")}</div>}
    {!loading&&session&&!session.enabled&&<div className="acc-card acc-unavailable"><LockKeyhole size={31}/>
      <h3>{t("暂时无法登录")}</h3><p>{t("登录后可在多台设备间同步。请稍后再试。")}</p></div>}
    {!loading&&session?.enabled&&!auth&&<div className="acc-card acc-login">
      <LogIn size={26}/><h3>{t(session.bootstrapAvailable?"初始化管理员账户":registering?"注册 Ciro 账户":"登录 Ciro")}</h3>
      <p>{t(session.bootstrapAvailable?"使用服务端配置的一次性初始化口令。":registering?"注册后，你的对话、密钥和同步数据只属于你自己。":"需要先登录才能管理此页面。")}</p>
      {session.phoneSignIn&&!session.bootstrapAvailable&&<div className="acc-way" role="tablist" aria-label={t("登录方式")}>
        <button type="button" role="tab" aria-selected={!byPhone} className={!byPhone?"acc-way--on":""} onClick={()=>{setByPhone(false);setError("");}}>{t("邮箱")}</button>
        <button type="button" role="tab" aria-selected={byPhone} className={byPhone?"acc-way--on":""} onClick={()=>{setByPhone(true);setError("");}}>{t("手机号")}</button>
      </div>}
      <form onSubmit={e=>void signIn(e,session.bootstrapAvailable)}>
        {byPhone&&!session.bootstrapAvailable?<>
          <label>{t("手机号")}<input required type="tel" inputMode="tel" autoComplete="tel" placeholder="138 0000 0000" value={phone} onChange={e=>setPhone(e.target.value)}/></label>
          <label>{t("验证码")}<span className="acc-code-row"><input required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" value={smsCode} onChange={e=>setSmsCode(e.target.value.replace(/\D/g,""))}/>
            <button type="button" className="acc-code-btn" disabled={smsWait>0||phone.replace(/\D/g,"").length<7} onClick={()=>void sendCode()}>{smsWait>0?smsWait+"s":t("获取验证码")}</button></span></label>
          {registering&&<label>{t("显示名称")}<input maxLength={80} placeholder={t("可不填")} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>}
        </>:<>
          <label>{t("邮箱")}<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)}/></label>
          {(session.bootstrapAvailable||registering)&&<label>{t("显示名称")}<input required maxLength={80} value={displayName} onChange={e=>setDisplayName(e.target.value)}/></label>}
          <label>{t("登录密码")}<input required type="password" minLength={12} autoComplete={session.bootstrapAvailable||registering?"new-password":"current-password"} value={password}
            onChange={e=>setPassword(e.target.value)}/></label>
          {(session.bootstrapAvailable||registering)&&<small className="acc-muted">{t("密码至少 12 位")}</small>}
        </>}
        {registering&&session.registration==="invite"&&<label>{t("邀请码")}<input required autoComplete="off" maxLength={12} value={invite} onChange={e=>setInvite(e.target.value)}/></label>}
        {session.bootstrapAvailable&&<label>{t("初始化口令")}<input required type="password" autoComplete="off" value={bootstrap} onChange={e=>setBootstrap(e.target.value)}/></label>}
        <button className="acc-primary" type="submit" disabled={busy}>{t(session.bootstrapAvailable?"创建账户":registering?"注册":"登录")}</button>
      </form>
      {!session.bootstrapAvailable&&session.registration&&session.registration!=="closed"&&
        <button type="button" className="acc-link" onClick={()=>{setRegistering(v=>!v);setError("");}}>
          {t(registering?"已有账户？登录":"没有账户？注册")}</button>}
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
        <p className="acc-metadata">{t("{n} 台设备已登录").replace("{n}",String(profile?.sessions.length||0))}</p>
        <button className="acc-secondary" onClick={()=>void action(()=>accountApi("/sessions/revoke","POST",{allOthers:true}))}>
          {t("撤销其他设备会话")}</button></section>
    </>}
    {!loading&&auth&&section==="subscription"&&<section className="acc-card acc-subscription">
      <div className="acc-section-title"><CreditCard size={19}/><h3>{t("订阅状态")}</h3></div>
      <div className="acc-state"><span>{t("当前状态")}</span><strong>{t(note?.configured?statusFor(note.status):"暂未订阅")}</strong>
        <small>{note?.configured&&note.currentPeriodEnd&&(note.status==="active"||note.status==="trialing")
          ?t(note.cancelAtPeriodEnd?"订阅将于 {date} 到期":"订阅将于 {date} 续费").replace("{date}",day(note.currentPeriodEnd))
          :note?.configured&&note.lastVerifiedAt?t("更新于 {date}").replace("{date}",day(note.lastVerifiedAt)):""}</small></div>
      {note?.configured&&<>
        <div className="acc-actions"><button className="acc-primary" onClick={()=>void action(async()=>{
          const reply=await accountApi<{url:string}>("/subscription/checkout","POST",{});
          openVerifiedCheckout(reply.url);
        })}><ArrowUpRight size={16}/>{t("前往安全结账")}</button>
        <button className="acc-secondary" onClick={()=>void action(async()=>{
          const reply=await accountApi<{url:string}>("/subscription/portal","POST",{});
          openVerifiedCheckout(reply.url);
        })}>{t("管理订阅")}</button></div>
        <p className="acc-muted">{t("付款由安全的第三方支付完成。")}</p>
      </>}
    </section>}
    {!loading&&auth&&section==="api-keys"&&<>
      <section className="acc-card"><div className="acc-section-title"><KeyRound size={19}/><h3>{t("创建密钥")}</h3></div>
        <form onSubmit={e=>void addApiKey(e)} className="acc-fields">
          <label>{t("密钥名称")}<input required maxLength={80} value={keyName} onChange={e=>setKeyName(e.target.value)} placeholder={t("例如：我的脚本")}/></label>
          <label>{t("有效期（天）")}<input type="number" min={1} max={365} required value={keyDays} onChange={e=>setKeyDays(e.target.value)}/></label>
          <div><strong className="acc-label-title">{t("允许的权限")}</strong>
            {SCOPES.map(([scope,name])=><label key={scope} className="acc-checkbox">
              <input type="checkbox" checked={keyScopes.includes(scope)} onChange={e=>setKeyScopes(old=>
                e.target.checked?[...old,scope]:old.filter(x=>x!==scope))}/>{t(name)}</label>)}</div>
          <button className="acc-primary" disabled={busy||!keyScopes.length}>{t("创建密钥")}</button>
        </form>
        {newSecret&&<div className="acc-one-time"><ShieldAlert size={17}/><p>{t("密钥只显示一次，请妥善保存。")}</p>
          <code>{newSecret}</code><button className="acc-secondary" onClick={()=>void navigator.clipboard.writeText(newSecret)}><Copy size={14}/>{t("复制密钥")}</button></div>}
      </section>
      <section className="acc-card"><h3>{t("API 密钥")}</h3>{keys.length===0&&<p className="acc-muted">{t("没有 API 密钥")}</p>}
        {keys.map(k=><div className="acc-list-line" key={k.id}><div><strong>{k.name} · {k.prefix}…</strong>
          <small>{k.scopes.map(scope=>t(scopeName(scope))).join(" / ")} · {t("截止")}: {day(k.expiresAt)}</small>
        </div><button className="acc-secondary" disabled={Boolean(k.revokedAt)} onClick={()=>void action(()=>accountApi("/api-keys/"+k.id+"/revoke","POST",{}))}>
          {k.revokedAt?t("已撤销"):t("撤销密钥")}</button></div>)}
      </section>
    </>}
    {!loading&&auth&&section==="spending"&&<><section className="acc-card">
      <div className="acc-section-title"><Wallet size={19}/><h3>{t("消费限额")}</h3></div>
      <form onSubmit={e=>void saveSpending(e)} className="acc-fields">
        {([{title:"日限额（美元）",value:daily,change:setDaily},
          {title:"月限额（美元）",value:monthly,change:setMonthly},
          {title:"单次上限（美元）",value:single,change:setSingle}] as const).map(x=><label key={x.title}>{t(x.title)}
          <input inputMode="decimal" placeholder={t("不限")} value={x.value} onChange={e=>x.change(e.target.value)}/></label>)}
        <button className="acc-primary" disabled={busy}>{t("保存限额")}</button></form>
      <div className="acc-spend-cards"><div><span>{t("今日已用")}</span><strong>{money(spending?.dailyCommittedPlusReservedMicros??0,language)}</strong></div>
        <div><span>{t("本月已用")}</span><strong>{money(spending?.monthlyCommittedPlusReservedMicros??0,language)}</strong></div></div>
      </section><p className="acc-muted">{t("达到限额后，新的请求会暂停。留空表示不限。")}</p></>}
    {!loading&&auth&&section==="notifications"&&<section className="acc-card">
      <div className="acc-section-title"><Bell size={19}/><h3>{t("通知中心")}</h3>
        <button className="acc-secondary" onClick={()=>void action(()=>accountApi("/notifications/read-all","POST",{}))}>{t("全部已读")}</button></div>
      {!notifications.length&&<div className="acc-empty">{t("暂无通知")}</div>}
      {notifications.map(n=><div className={n.readAt?"acc-notification":"acc-notification acc-notification--unread"} key={n.id}>
        <div><strong>{n.title}</strong><p>{n.body}</p><small>{new Date(n.createdAt).toLocaleString(localeTag(language))}</small></div>
        {!n.readAt&&<button className="acc-secondary" onClick={()=>void action(()=>accountApi("/notifications/"+n.id+"/read","POST",{}))}><Check size={14}/>{t("标记已读")}</button>}
      </div>)}
    </section>}
    {!loading&&auth&&section==="memory"&&<><section className="acc-card">
      <div className="acc-section-title"><BookOpen size={19}/><h3>{t("记忆管理")}</h3></div>
      <label className="acc-toggle">{t("记忆开关")}
        <input type="checkbox" checked={memoryEnabled} onChange={e=>{const enabled=e.target.checked;setMemoryEnabled(enabled);void action(()=>accountApi("/memories/preferences","POST",{enabled}));}}/></label>
      <form className="acc-fields" onSubmit={e=>{e.preventDefault();void action(async()=>{
        await accountApi("/memories","POST",{content:memoryText,category:memoryCategory});setMemoryText("");
      });}}>
        <label>{t("记忆内容")}<textarea required maxLength={1500} rows={4} value={memoryText} onChange={e=>setMemoryText(e.target.value)}/></label>
        <label>{t("类别")}<select value={memoryCategory} onChange={e=>setMemoryCategory(e.target.value)}>
          {Object.entries(CATEGORIES).map(([x,name])=><option value={x} key={x}>{t(name)}</option>)}</select></label>
        <button className="acc-primary" disabled={busy||!memoryText.trim()}><Plus size={15}/>{t("添加记忆")}</button></form>
      </section><section className="acc-card">
        {!memories.length&&<div className="acc-empty">{t("没有保存的记忆")}</div>}
        {memories.map(m=><div className="acc-list-line" key={m.id}>
          <div><strong>{m.content}</strong><small>{t(CATEGORIES[m.category]||m.category)} · {new Date(m.createdAt).toLocaleString(localeTag(language))}</small></div>
          <button className="acc-secondary" onClick={()=>void action(()=>accountApi("/memories/"+m.id,"DELETE"))}><Trash2 size={15}/>{t("删除记忆")}</button>
        </div>)}</section>
      <p className="acc-muted">{t("记忆内容会加密保存。开启后 Ciro 会在对话中参考这些记忆。")}</p>
    </>}
    {!loading&&auth&&section==="sync"&&<><section className="acc-card">
      <div className="acc-section-title"><Cloud size={19}/><h3>{t("跨设备同步")}</h3></div>
      <label className="acc-toggle">{t("在此设备上同步")}
        <input type="checkbox" checked={automatic} onChange={e=>{
          const next=e.target.checked;setSyncEnabled(next);setAutomatic(next);
        }}/></label>
      <p className="acc-muted">{t("对话、项目、提示词和设置会加密保存到 Ciro 云端，并在登录同一账户的设备间自动同步；两台设备改了同一个对话时，以最后修改的为准。")}</p>
      <div className="acc-state"><span>{t("同步状态")}</span>
        <strong>{t(({off:"已关闭",local:"本地模式",unauthenticated:"未登录",syncing:"正在同步…",ready:"已同步",error:"同步失败"} as const)[syncSignal.status])}</strong>
        <small>{syncSignal.status==="error"?t("请检查网络后重试。"):syncSignal.lastSyncedAt?t("上次同步：")+new Date(syncSignal.lastSyncedAt).toLocaleString(localeTag(language)):""}</small></div>
      <div className="acc-sync-grid"><div><small>{t("本地对话")}</small><strong>{loadConversations().length}</strong></div>
        <div><small>{t("云端条目")}</small><strong>{syncSignal.cloudCount??"—"}</strong></div>
        <div><small>{t("本次会话已同步")}</small><strong>{syncSignal.pushed+syncSignal.pulled}</strong></div></div>
      <div className="acc-actions"><button className="acc-primary" disabled={!automatic||syncSignal.status==="syncing"} onClick={()=>void syncNow()}>
        <RefreshCcw size={15}/>{t("立即同步")}</button></div>
      <p className="acc-muted">{t("相同账户可以从不同设备登录。")} {t("背景图片本体和附件原图仍只保存在当前设备。")}</p>
    </section></>}
  </section>;
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity, ArrowDownToLine, ArrowUpRight, BadgeCheck, BarChart3, Blocks, CalendarClock,
  CheckCircle2, CircleAlert, CreditCard, FileText, FolderOpen, GitBranch,
  HardDrive, Info, Layers, MessageCircle, RefreshCcw, Search, ShieldCheck, Sparkles,
  Star, Terminal, Wallet, Workflow
} from "lucide-react";
import type { Language } from "./lib/i18n";
import { commerceTranslate } from "./lib/commercial-i18n";
import { commercialApi,formatUsdMicros } from "./lib/commercial-api";
import type { CommerceState, CommerceTab } from "./lib/commercial-api";

type Props={
  language:Language;section:CommerceTab;
  onNavigate?:(route:string)=>void
};
const categories:Record<string,string>={
  assistant:"助手",productivity:"效率",developer:"开发",research:"研究",
  coding:"开发",quality:"质量",planning:"规划",analysis:"分析",writing:"写作"
};
const kinds:Record<string,string>={chat:"聊天",agent:"代理",tool:"工具",training:"训练"};
const iconMap:Record<string,typeof Wallet>={
  chat:MessageCircle,workbench:Workflow,github:GitBranch,scheduler:CalendarClock,
  skills:Blocks,research:Search,files:FolderOpen,code:Terminal
};
const unit= (n:number,language:Language)=>new Intl.NumberFormat(language==="en"?"en-US":"zh-CN").format(n);
function statusReady(ready:boolean,t:(value:string)=>string){
  return <span className={ready?"com-status com-status--ready":"com-status"}>
    {ready?<CheckCircle2 size={13}/>:<CircleAlert size={13}/>}
    {t(ready?"服务已配置":"待接入后端")}
  </span>;
}
function BillingPage({state,language,save,loading}:{
  state:CommerceState;language:Language;save:(path:string,data:unknown,message:string)=>Promise<void>;loading:boolean;
}){
  const t=(value:string)=>commerceTranslate(language,value);
  const b=state.billing;
  const locale=language==="en"?"en-US":"zh-CN";
  const [view,setView]=useState<"usage"|"invoices">("usage");
  const [cap,setCap]=useState(b.monthlyBudgetMicros===null?"":(b.monthlyBudgetMicros/1e6).toFixed(2));
  const [alert,setAlert]=useState(String(b.alertThresholdPct));
  const total=b.totalEstimatedMicros;
  const percent=b.monthlyBudgetMicros===null || b.monthlyBudgetMicros===0?
    (b.monthlyBudgetMicros===0?100:0):
    Math.min(100,Math.max(0,b.knownEstimatedMicros/b.monthlyBudgetMicros*100));
  async function saveBudget(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    await save("/billing/budget",{
      monthlyBudgetUsd:cap.trim()===""?null:cap.trim(),
      alertThresholdPct:Number(alert)
    },t("预算已保存"));
  }
  return <div className="com-page">
    <header className="com-page-head"><div><span className="com-eyebrow"><Wallet size={15}/> CIRO BILLING</span>
      <h2>{t("账单与用量")}</h2><p>{t("真实用量、预算及账单")}</p></div>
      <span className="com-period"><CalendarClock size={15}/>{t("当前账期")}: {b.period}</span>
    </header>
    <div className="com-billing-tabs">
      <button type="button" aria-pressed={view==="usage"} className={view==="usage"?"com-tab-active":""} onClick={()=>setView("usage")}><BarChart3 size={16}/>{t("查看明细")}</button>
      <button type="button" aria-pressed={view==="invoices"} className={view==="invoices"?"com-tab-active":""} onClick={()=>setView("invoices")}><CreditCard size={16}/>{t("发票管理")}</button>
    </div>
    {view==="usage"&&<>
      <div className="com-metric-grid">
        <article className="com-metric"><span>{t("本月估算")}</span>
          <strong>{b.hasUsage? (total===null?t("未知"):formatUsdMicros(total,locale)):"—"}</strong>
          <small>{t("按照服务端配置费率计算，仅用于费用预估，不代表已扣款。")}</small></article>
        <article className="com-metric"><span>Compute Units · CWU</span><strong>{b.hasUsage?unit(b.units.CWU,language):"—"}</strong>
          <small>{t("总计量")} CWU</small></article>
        <article className="com-metric"><span>Agent Units · GWU</span><strong>{b.hasUsage?unit(b.units.GWU,language):"—"}</strong>
          <small>{t("总计量")} GWU</small></article>
        <article className="com-metric"><span>{t("已计量任务")}</span><strong>{b.hasUsage?unit(b.eventsCount,language):"—"}</strong>
          <small>{t("未计价记录")}: {b.unknownPriceEvents}</small></article>
      </div>
      <div className="com-readiness">
        {b.meteringConfigured?<BadgeCheck size={17}/>:<CircleAlert size={17}/>}
        <div><strong>{t(b.meteringConfigured?"已配置计量验签":"未连接计量服务")}</strong>
          <p>{t(b.meteringConfigured?"消费和模型账单必须来自可信收据。":"没有配置真实计费服务，不展示虚构的支出和余额。")}</p></div>
        <span>{t("无收费服务接入")}</span>
      </div>
      <section className="com-card">
        <div className="com-section-head"><h3><Wallet size={18}/>{t("本月预算设置")}</h3>
          <span>{b.monthlyBudgetMicros===null?t("无预算上限"):formatUsdMicros(b.monthlyBudgetMicros,locale)}</span></div>
        <form onSubmit={e=>void saveBudget(e)} className="com-budget-form">
          <label>{t("预算上限（USD）")}
            <input aria-label={t("预算上限（USD）")} value={cap} onChange={e=>setCap(e.target.value)}
              inputMode="decimal" placeholder={t("可留空，表示不限制。")} maxLength={15}/></label>
          <label>{t("预警比例")}
            <select aria-label={t("预警比例")} value={alert} onChange={e=>setAlert(e.target.value)}>
              {[50,60,70,80,90,95,100].map(p=><option value={p} key={p}>{p}%</option>)}
            </select></label>
          <button type="submit" disabled={loading} className="com-primary">{t("保存预算")}</button>
        </form>
        <div className="com-budget-progress" aria-label={t("本月预算设置")} role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{width:percent+"%"}}/></div>
        <div className="com-budget-numbers"><span>{formatUsdMicros(b.knownEstimatedMicros,locale)}</span>
          <span>{b.monthlyBudgetMicros===null?"—":formatUsdMicros(b.monthlyBudgetMicros,locale)}</span></div>
        {(b.budgetReached||b.budgetWarning)&&<p className="com-warning"><CircleAlert size={15}/>{t(b.budgetReached?"预算已达到":"接近预算")}</p>}
        <p className="com-note">{t("超过预算后暂停新任务；运行中的费用仍可能继续产生。")}</p>
        <p className="com-note">{t("计量或费率未接通时，配置的预算会阻止新代理任务启动。")}</p>
      </section>
      <section className="com-card">
        <div className="com-section-head"><h3><BarChart3 size={18}/>{t("本月用量概览")}</h3></div>
        <div className="com-bars">{Object.entries(b.byCategory).map(([key,value])=>{
          const max=Math.max(...Object.values(b.byCategory),1);
          return <div className="com-bar-row" key={key}><span>{t(kinds[key]||key)}</span>
            <div className="com-bar-track"><i style={{width:(value/max*100)+"%"}}/></div>
            <strong>{unit(value,language)}</strong></div>;
        })}</div>
        <div className="com-rates"><span>{t("费率 / 百万单位")}</span>
          <span>CWU {b.rateMicroUsdPerMillion.CWU===null?t("费率尚未配置"):formatUsdMicros(b.rateMicroUsdPerMillion.CWU,locale)}</span>
          <span>GWU {b.rateMicroUsdPerMillion.GWU===null?t("费率尚未配置"):formatUsdMicros(b.rateMicroUsdPerMillion.GWU,locale)}</span></div>
      </section>
      <section className="com-card">
        <div className="com-section-head"><h3><FileText size={18}/>{t("本月费用明细")}</h3>
          <a className="com-secondary" href="/api/workbench/commercial/billing/export.csv" download>
            <ArrowDownToLine size={16}/>{t("导出 CSV")}</a></div>
        {!b.hasUsage?<div className="com-empty"><Activity size={24}/><strong>{t("暂无真实用量记录")}</strong>
          <p>{t("只有 CIRO Runtime 签名的计量收据才会出现在这里。")}</p></div>:
          <div className="com-table-wrap"><table className="com-table"><thead><tr>
            <th>{t("计量时间")}</th><th>{t("类别")}</th><th>{t("模型")}</th>
            <th>{t("用量")}</th><th>{t("估算费用")}</th><th>{t("凭证摘要")}</th>
          </tr></thead><tbody>{b.events.map(event=><tr key={event.eventId}>
            <td>{new Date(event.observedAt).toLocaleString(locale)}</td>
            <td>{t(kinds[event.category]||event.category)}</td><td>{event.model}</td>
            <td>{unit(event.units,language)} {event.unit}</td>
            <td>{formatUsdMicros(event.estimatedCostMicros,locale)}</td>
            <td><code title={event.receiptSha256}>{event.receiptSha256.slice(0,12)}…</code></td>
          </tr>)}</tbody></table></div>}
      </section>
    </>}
    {view==="invoices"&&<div className="com-invoice-layout">
      <section className="com-card com-unavailable"><CreditCard size={32}/><h3>{t("账单服务尚未接入")}</h3>
        <p>{t("这里不会生成虚假发票、付款记录或订阅状态。")}</p>
        <p>{t("正式开票与扣款需对接支付服务端。")}</p></section>
      <section className="com-card com-unavailable"><Wallet size={32}/><h3>{t("支付方式")}</h3><p>{t("尚未启用在线支付。")}</p></section>
    </div>}
  </div>;
}
function AppsPage({state,language,call,onNavigate}:{
  state:CommerceState;language:Language;
  call:(path:string,body:unknown,message:string)=>Promise<void>;onNavigate?:(route:string)=>void;
}){
  const t=(s:string)=>commerceTranslate(language,s);
  const [q,setQ]=useState(""),[category,setCategory]=useState("all");
  const visible=useMemo(()=>state.apps.filter(a=>(category==="all"||a.category===category)&&
    [a.name,a.zh,a.description,a.descriptionEn].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a,b)=>Number(b.pinned)-Number(a.pinned)),[state.apps,q,category]);
  return <div className="com-page">
    <header className="com-page-head"><div><span className="com-eyebrow"><Layers size={15}/> CIRO OFFICIAL APPS</span>
      <h2>{t("官方应用")}</h2><p>{t("你安装的 Ciro 官方功能入口")}</p></div>
      <span className="com-period"><BadgeCheck size={15}/>{t("官方预置目录")}</span></header>
    <div className="com-tools"><label className="com-search"><Search size={16}/>
      <input aria-label={t("搜索应用")} placeholder={t("搜索应用")} value={q} onChange={e=>setQ(e.target.value)}/></label>
      <select aria-label={t("类别")} value={category} onChange={e=>setCategory(e.target.value)}>
        <option value="all">{t("全部")}</option>
        {["assistant","productivity","developer","research"].map(v=><option key={v} value={v}>{t(categories[v])}</option>)}
      </select></div>
    <div className="com-app-grid">{visible.map(app=>{
      const Icon=iconMap[app.id]||Layers;
      return <article key={app.id} className="com-app-card">
        <div className="com-app-top"><span className="com-icon"><Icon size={24}/></span>
          <button type="button" className={app.pinned?"com-pin com-pin--active":"com-pin"}
            aria-label={t(app.pinned?"取消收藏":"收藏")+": "+app.name}
            title={t(app.pinned?"取消收藏":"收藏")} onClick={()=>void call("/apps/"+app.id+"/pin",{pinned:!app.pinned},t("操作成功"))}>
            <Star size={17} fill={app.pinned?"currentColor":"none"}/></button></div>
        <h3>{language==="en"?app.name:app.zh}</h3><small>{app.name}</small>
        <p>{language==="en"?app.descriptionEn:app.description}</p>
        <div className="com-app-bottom">{statusReady(app.ready,t)}
          {app.route && onNavigate &&
            <button className="com-open" onClick={()=>onNavigate(app.route!)} type="button">
              {t(app.ready?"打开":"打开预览")}<ArrowUpRight size={15}/></button>}
        </div>
      </article>;
    })}</div>
    {visible.length===0&&<div className="com-empty">{t("暂无匹配结果")}</div>}
    <p className="com-info"><Info size={16}/>{t("官方应用不代表已开放所有实际能力。")} {t("应用启动需相应服务与权限。")}</p>
  </div>;
}
function SkillsPage({state,language,call}:{
  state:CommerceState;language:Language;call:(path:string,body:unknown,message:string)=>Promise<void>;
}){
  const t=(s:string)=>commerceTranslate(language,s);
  const [q,setQ]=useState(""),[category,setCategory]=useState("all");
  const visible=useMemo(()=>state.skills.filter(s=>(category==="all"||s.category===category)&&
    [s.name,s.zh,s.description,s.descriptionEn].join(" ").toLowerCase().includes(q.toLowerCase())),[state.skills,q,category]);
  return <div className="com-page">
    <header className="com-page-head"><div><span className="com-eyebrow"><Sparkles size={15}/> CIRO SKILL LIBRARY</span>
      <h2>{t("技能中心")}</h2><p>{t("经过审核的代理技能")}</p></div>
      <span className="com-period"><ShieldCheck size={16}/>{t("官方预置目录")}</span></header>
    <div className="com-tools"><label className="com-search"><Search size={16}/>
      <input aria-label={t("搜索技能")} placeholder={t("搜索技能")} value={q} onChange={e=>setQ(e.target.value)}/></label>
      <select aria-label={t("类别")} value={category} onChange={e=>setCategory(e.target.value)}>
        <option value="all">{t("全部")}</option>
        {["coding","quality","planning","analysis","writing","research"].map(v=><option key={v} value={v}>{t(categories[v])}</option>)}
      </select></div>
    <div className="com-skill-list">{visible.map(skill=><article className="com-skill" key={skill.id}>
      <div className="com-skill-mark"><Blocks size={22}/></div>
      <div className="com-skill-details"><div className="com-skill-title">
        <h3>{language==="en"?skill.name:skill.zh}</h3>
        <span>v{skill.version}</span></div>
        <p>{language==="en"?skill.descriptionEn:skill.description}</p>
        <div className="com-skill-tags"><span>{t("所需权限")}</span>
          {skill.scope.map(scope=><code key={scope}>{scope}</code>)}</div>
        <span className="com-skill-ready">{skill.enabled && !skill.ready?t("已选择，等待执行器"):
          skill.ready?t("服务已配置"):t("技能尚不能执行")}</span>
      </div>
      <button className={skill.enabled?"com-secondary com-enable-active":"com-primary"} type="button"
        aria-pressed={skill.enabled}
        onClick={()=>void call("/skills/"+skill.id+"/toggle",{enabled:!skill.enabled},t("操作成功"))}>
        {skill.enabled?t("取消技能"):t("选择技能")}</button>
    </article>)}</div>
    {visible.length===0&&<div className="com-empty">{t("暂无匹配结果")}</div>}
    <div className="com-info"><ShieldCheck size={16}/>
      <span>{t("选择的技能会随 Agent 请求交给原生执行器，但不能授予新权限。")} {t("与 GitHub 权限及沙盒策略同时生效。")}</span></div>
    <div className="com-info"><HardDrive size={16}/>{t("不支持任意第三方代码安装。")}</div>
  </div>;
}
export default function CommercialCenter({language,section,onNavigate}:Props){
  const t=(value:string)=>commerceTranslate(language,value);
  const [state,setState]=useState<CommerceState|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    commercialApi<CommerceState>("/state").then(s=>{if(mounted.current)setState(s);})
      .catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:String(e));});
    return ()=>{mounted.current=false;};
  },[]);
  async function refresh(){
    const updated=await commercialApi<CommerceState>("/state");
    if(mounted.current)setState(updated);
  }
  async function call(path:string,payload:unknown,message:string){
    setBusy(true);setError("");setNotice("");
    try{await commercialApi(path,payload);await refresh();setNotice(message);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  return <section className="com-root" aria-label={t(section==="billing"?"账单与用量":section==="apps"?"官方应用":"技能中心")}>
    {error&&<div className="com-error" role="alert"><CircleAlert size={17}/>{error}
      <button onClick={()=>{setError("");void refresh();}}><RefreshCcw size={15}/>{t("重新加载")}</button></div>}
    {notice&&<p className="com-success" role="status"><CheckCircle2 size={15}/>{notice}</p>}
    {!state&&!error&&<div className="com-empty"><Activity size={24}/>{t("本地管理")}</div>}
    {state&&section==="billing"&&<BillingPage key={state.billing.period+"-"+state.billing.monthlyBudgetMicros}
      state={state} language={language} save={call} loading={busy}/>}
    {state&&section==="apps"&&<AppsPage state={state} language={language} call={call} onNavigate={onNavigate}/>}
    {state&&section==="skills"&&<SkillsPage state={state} language={language} call={call}/>}
  </section>;
}

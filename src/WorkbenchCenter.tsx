import { useCallback, useEffect, useState } from "react";
import CommercialCenter from "./CommercialCenter";
import PluginConnections from "./PluginConnections";
import type { FormEvent } from "react";
import {
  Activity, ArrowRight, CalendarClock, Check, CheckCircle2, CircleAlert, Clock3,
  ClipboardCheck, Code2, FileCode2, GitBranch, GitCommitHorizontal, LockKeyhole,
  Pause, Play, PlugZap, Plus, RefreshCcw, Search, ShieldAlert, ShieldCheck,
  Sparkles, Trash2, Users, WandSparkles, X, Zap, Wallet, Grid2X2, Blocks
} from "lucide-react";
import type { Language } from "./lib/i18n";
import { workbenchTranslate } from "./lib/workbench-i18n";
import {
  workbenchApi, initialPermissionCustom
} from "./lib/workbench-api";
import type {
  WorkbenchState, WorkbenchTab, AgentMode, PermissionMode, PermissionCustom,
  WorkbenchGoal, GithubFile, WorkbenchResponse
} from "./lib/workbench-api";

type Props = { language: Language; initialTab?: WorkbenchTab; embedded?: boolean; initialGoal?: string; onNavigate?: (route: string) => void };
const tabs: {id:WorkbenchTab;title:string;Icon:typeof Users}[] = [
  {id:"goals",title:"目标与项目",Icon:Users},
  {id:"permissions",title:"权限与沙盒",Icon:ShieldCheck},
  {id:"github",title:"GitHub 仓库",Icon:GitBranch},
  {id:"plugins",title:"插件中心",Icon:PlugZap},
  {id:"schedules",title:"定时任务",Icon:CalendarClock},
  {id:"billing",title:"账单与用量",Icon:Wallet},
  {id:"apps",title:"官方应用",Icon:Grid2X2},
  {id:"skills",title:"技能中心",Icon:Blocks}
];
const stages:{phase:string;title:string;role:string;Icon:typeof Users}[]=[
  {phase:"plan",title:"规划",role:"计划代理",Icon:ClipboardCheck},
  {phase:"implement",title:"实现",role:"开发代理",Icon:Code2},
  {phase:"test",title:"测试",role:"测试代理",Icon:CheckCircle2},
  {phase:"redteam",title:"红队反证",role:"红队代理",Icon:ShieldAlert},
  {phase:"audit",title:"最终审计",role:"审计代理",Icon:ShieldCheck}
];
const modes:{id:PermissionMode;title:string;desc:string;Icon:typeof Users}[]=[
  {id:"request",title:"请求批准",desc:"任何外部写操作前都先请求确认。",Icon:LockKeyhole},
  {id:"auto",title:"自动审批",desc:"自动处理内部任务，外部仓库写入仍需批准。",Icon:Zap},
  {id:"full",title:"完全访问",desc:"在当前授权仓库及工作空间范围内自动执行。",Icon:Sparkles},
  {id:"custom",title:"自定义权限",desc:"逐项指定允许自动进行的操作。",Icon:ShieldCheck}
];
const customFlags:[keyof PermissionCustom,string][]=[
  ["githubRead","读取 GitHub 仓库"],["githubWrite","写入 GitHub 分支"],
  ["taskExecution","执行代理任务"],["recurringTasks","触发定时任务"],
  ["externalNetwork","访问外部网络"]
];
const statusKeys:Record<string,string>={
  waiting_runtime:"等待执行器",waiting_verifier:"等待验证器",waiting_approval:"等待审批",
  running:"运行中",queued:"已排队",planned:"已规划",paused:"已暂停",cancelled:"已取消",
  completed:"已完成",blocked:"被阻塞",needs_evidence:"证据不足",draft:"已创建"
};
function useWorkbench() {
  const [state,setState]=useState<WorkbenchState|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const refresh=useCallback(async()=>{
    try { const result=await workbenchApi<WorkbenchState>("/state");setState(result);setError(""); }
    catch(error) { setError(error instanceof Error?error.message:String(error)); }
    finally { setLoading(false); }
  },[]);
  useEffect(()=>{
    void refresh();
    const interval=window.setInterval(()=>void refresh(),6000);
    return ()=>window.clearInterval(interval);
  },[refresh]);
  const call=useCallback(async<T,>(path:string,payload:unknown,noticeText?:string):Promise<T|null>=>{
    setNotice("");
    try {
      const result=await workbenchApi<T>(path,payload);
      if(noticeText)setNotice(noticeText);
      await refresh();
      return result;
    }catch(error) {
      setError(error instanceof Error?error.message:String(error));
      return null;
    }
  },[refresh]);
  return {state,loading,error,notice,setError,setNotice,refresh,call};
}
function readable(time:string,language:Language){
  const date=new Date(time);return Number.isNaN(date.getTime())?"—":date.toLocaleString(language==="en"?"en-US":"zh-CN",{month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
}
export default function WorkbenchCenter({language,initialTab="goals",embedded=false,initialGoal="",onNavigate}:Props) {
  const w=useWorkbench();
  const t=(value:string)=>workbenchTranslate(language,value);
  const [tab,setTab]=useState<WorkbenchTab>(initialTab);
  const [goalTitle,setGoalTitle]=useState("");
  const [goalText,setGoalText]=useState(initialGoal);
  const [goalMode,setGoalMode]=useState<AgentMode>("goal");
  const [working,setWorking]=useState(false);
  const [expandedGoal,setExpandedGoal]=useState<string|null>(null);
  const [permissionMode,setPermissionMode]=useState<PermissionMode>("request");
  const [custom,setCustom]=useState<PermissionCustom>(initialPermissionCustom);
  const [fullConsent,setFullConsent]=useState(false);
  const [repoInput,setRepoInput]=useState("");
  const [filePath,setFilePath]=useState("README.md");
  const [branch,setBranch]=useState("ciro/workspace");
  const [commitMessage,setCommitMessage]=useState("feat: update from CIRO Workbench");
  const [githubFile,setGithubFile]=useState<GithubFile|null>(null);
  const [fileText,setFileText]=useState("");
  const [scheduleTitle,setScheduleTitle]=useState("");
  const [scheduleGoal,setScheduleGoal]=useState("");
  const [frequency,setFrequency]=useState<"hourly"|"daily"|"weekly">("daily");
  const [scheduleHour,setScheduleHour]=useState(9);
  const [weekday,setWeekday]=useState(1);
  const [timezone,setTimezone]=useState(()=>Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC");
  const [policyLoaded,setPolicyLoaded]=useState(false);
  useEffect(()=>{
    if(!w.state||policyLoaded)return;
    setPermissionMode(w.state.policy.mode);
    setCustom({...w.state.policy.custom});
    setRepoInput(w.state.policy.repo||w.state.capabilities.github.allowedRepositories[0]||"");
    setPolicyLoaded(true);
  },[w.state,policyLoaded]);
  const currentTab=embedded?initialTab:tab;
  async function submitGoal(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!goalText.trim())return;
    setWorking(true);
    try {
      const reply=await w.call<WorkbenchResponse>("/goals",{
        title:goalTitle.trim()||goalText.trim().slice(0,55),goal:goalText,mode:goalMode
      });
      if(reply){setGoalTitle("");setGoalText("");w.setNotice(reply.status==="waiting_runtime"?t("等待执行器"):t("已创建"));}
    }finally{setWorking(false);}
  }
  async function submitPermissions(){
    if(permissionMode==="full"&&!fullConsent){w.setError(t("我理解完全访问仅限已授权范围，并接受该范围内的自动写入风险。"));return;}
    const result=await w.call("/permissions",{mode:permissionMode,custom,
      ...(permissionMode==="full"?{confirmFullAccess:"ALLOW_SCOPED_FULL_ACCESS"}:{})},t("权限已保存"));
    if(result) setFullConsent(false);
  }
  async function connectGithub(){
    const result=await w.call<{policy:{repo:string;mode:PermissionMode}}>("/github/connect",{repo:repoInput.trim()},t("已验证连接"));
    if(result) {setPermissionMode(result.policy.mode);setGithubFile(null);}
  }
  async function readGithub(){
    if(!w.state?.policy.repo)return;
    const query=new URLSearchParams({path:filePath,...(branch?{branch}:{})});
    const result=await w.call<GithubFile>("/github/file?"+query.toString(),undefined);
    if(result){setGithubFile(result);setFileText(result.content);}
  }
  async function commitGithub(){
    if(!githubFile)return;
    const reply=await w.call<{approvalRequired?:boolean;commit?:string}>("/github/write",{
      path:githubFile.path,branch,content:fileText,message:commitMessage,
      expectedSha:githubFile.sha
    });
    if(reply)w.setNotice(reply.approvalRequired?t("写入前需要审批。"):t("已完成"));
  }
  async function createSchedule(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    const result=await w.call("/schedules",{title:scheduleTitle,goal:scheduleGoal,
      recurrence:frequency,hour:frequency==="hourly"?null:scheduleHour,
      weekday:frequency==="weekly"?weekday:null,timezone},t("已创建"));
    if(result){setScheduleTitle("");setScheduleGoal("");}
  }
  const state=w.state;
  const repoStatus=state?.capabilities.github;
  const runtime=state?.capabilities.runtime;
  return <section className={embedded?"wb-root wb-root--embedded":"wb-root"} aria-label={t("自主协作工作台")}>
    {!embedded&&<header className="wb-header">
      <div><span className="wb-overline"><WandSparkles size={13}/> CIRO AGENT WORKBENCH</span>
        <h1>{t("自主协作工作台")}</h1>
        <p>{t("把想法交给 Ciro，把成果带回来。")}</p></div>
      <button type="button" className="wb-refresh" title={t("刷新")} onClick={()=>void w.refresh()}><RefreshCcw size={16}/>{t("刷新")}</button>
    </header>}
    {!embedded&&<nav className="wb-nav" aria-label={t("自主协作工作台")}>
      {tabs.map(({id,title,Icon})=><button key={id} type="button"
        className={tab===id?"wb-nav-item wb-nav-item--active":"wb-nav-item"}
        onClick={()=>{setTab(id);w.setError("");}}><Icon size={17}/>{t(title)}</button>)}
    </nav>}
    <div className="wb-body">
      {w.error&&<div role="alert" className="wb-alert wb-alert--error"><CircleAlert size={17}/><span>{w.error}</span><button aria-label={t("关闭设置")} onClick={()=>w.setError("")}><X size={15}/></button></div>}
      {w.notice&&<div role="status" className="wb-alert wb-alert--ok"><Check size={16}/>{w.notice}</div>}
      {w.loading&&!state&&<div className="wb-empty"><Activity size={24}/>{t("准备中")}</div>}
      {!state&&!w.loading&&<div className="wb-empty">{t("无法加载工作台")}<button onClick={()=>void w.refresh()}>{t("刷新")}</button></div>}
      {state&&(currentTab==="billing"||currentTab==="apps"||currentTab==="skills")&&
        <CommercialCenter key={currentTab} language={language} section={currentTab} onNavigate={onNavigate}/>}
      {state&&currentTab==="goals"&&<div className="wb-goals">
        <div className="wb-capabilities">
          <span className={runtime?.runner?"wb-health wb-health--ready":"wb-health"}>
            {runtime?.runner?<CheckCircle2 size={16}/>:<CircleAlert size={16}/>}
            {t(runtime?.runner?"执行引擎已配置":"执行引擎未连接")}
          </span>
          <span className={runtime?.verifier?"wb-health wb-health--ready":"wb-health"}>
            {runtime?.verifier?<CheckCircle2 size={16}/>:<CircleAlert size={16}/>}
            {t(runtime?.verifier?"独立验证器已配置":"独立验证器未连接")}
          </span>
          <span className="wb-scope"><ShieldCheck size={15}/>{state.policy.repo||t("设置代码仓库")}</span>
        </div>
        <div className="wb-hero">
          <div className="wb-hero-top"><Sparkles size={24}/><div>
            <h2>{t("新建自主任务")}</h2><p>{t("让 Ciro 拆解、委派、测试并持续修复任务。")}</p></div></div>
          <form className="wb-goal-form" onSubmit={e=>void submitGoal(e)}>
            <div className="wb-switcher" role="group" aria-label={t("目标执行")}>
              <button type="button" aria-pressed={goalMode==="goal"} className={goalMode==="goal"?"wb-selected":""} onClick={()=>setGoalMode("goal")}><Zap size={15}/>{t("目标执行")}</button>
              <button type="button" aria-pressed={goalMode==="plan"} className={goalMode==="plan"?"wb-selected":""} onClick={()=>setGoalMode("plan")}><ClipboardCheck size={15}/>{t("仅规划不执行")}</button>
            </div>
            <label className="wb-label">{t("任务名称")}<input maxLength={130} aria-label={t("任务名称")} placeholder={t("一句话描述项目")} value={goalTitle} onChange={e=>setGoalTitle(e.target.value)}/></label>
            <label className="wb-label">{t("详细目标与验收标准")}
              <textarea required rows={4} maxLength={12000} aria-label={t("详细目标与验收标准")} placeholder={t("例如：完成一个可登录的产品网站，并通过测试与安全审计")}
                value={goalText} onChange={e=>setGoalText(e.target.value)}/></label>
            <div className="wb-form-bottom"><p>{t("仅在已连接执行器并满足授权时真正执行。")}</p>
              <button className="wb-primary" type="submit" disabled={working||!goalText.trim()}>
                <ArrowRight size={17}/>{working?t("创建中…"):t(goalMode==="plan"?"生成计划":"创建目标")}</button></div>
          </form>
        </div>
        <div className="wb-pipeline" aria-label={t("测试 / 红队 / 修复 / 再测")}>
          {stages.map(({phase,title,role,Icon},i)=><div className="wb-phase" key={phase}>
            <span className="wb-phase-icon"><Icon size={18}/></span>
            <strong>{t(title)}</strong><small>{t(role)}</small>{i!==stages.length-1&&<ArrowRight className="wb-phase-next" size={15}/>}
          </div>)}
        </div>
        <div className="wb-block-title"><div><h2>{t("最近任务")}</h2><p>{t("全部活动可追溯")}</p></div>
          <span>{state.goals.length}</span></div>
        {state.goals.length===0&&<div className="wb-empty"><Users size={24}/><strong>{t("还没有任务")}</strong><span>{t("提交一个明确目标后，项目将显示在这里。")}</span></div>}
        <div className="wb-goal-list">{state.goals.map(goal=><GoalCard key={goal.id} goal={goal} language={language}
          expanded={expandedGoal===goal.id} toggle={()=>setExpandedGoal(expandedGoal===goal.id?null:goal.id)}
          action={async action=>{await w.call("/goals/"+goal.id+"/action",{action});}}/>)}</div>
        <Approvals language={language} state={state} call={w.call}/>
        <div className="wb-footnote"><ShieldAlert size={17}/>{t("完成不等于权威验收，必须有测试和红队证据。")}</div>
      </div>}

      {state&&currentTab==="permissions"&&<div className="wb-admin">
        <div className="wb-block-title"><div><h2>{t("执行权限")}</h2>
          <p>{t("权限只作用于所选工作空间与仓库，不授予系统管理员权限。")}</p></div><LockKeyhole size={22}/></div>
        <div className="wb-mode-grid">{modes.map(({id,title,desc,Icon})=>
          <button className={permissionMode===id?"wb-mode wb-mode--selected":"wb-mode"} type="button" key={id}
            aria-pressed={permissionMode===id} onClick={()=>{setPermissionMode(id);setFullConsent(false);}}>
            <Icon size={21}/><strong>{t(title)}</strong><small>{t(desc)}</small>
            {permissionMode===id&&<Check className="wb-mode-check" size={17}/>}
          </button>)}</div>
        {permissionMode==="custom"&&<section className="wb-card"><h3>{t("自定义权限")}</h3>
          {customFlags.map(([key,label])=><label className="wb-toggle" key={key}>
            <span>{t(label)}</span><input type="checkbox" checked={custom[key]}
              onChange={e=>setCustom(old=>({...old,[key]:e.target.checked}))}/></label>)}</section>}
        {permissionMode==="full"&&<label className="wb-risk">
          <input type="checkbox" checked={fullConsent} onChange={e=>setFullConsent(e.target.checked)}/>
          <span>{t("我理解完全访问仅限已授权范围，并接受该范围内的自动写入风险。")}</span>
        </label>}
        <div className="wb-footnote"><ShieldAlert size={17}/>{t("危险操作仍被强制禁止。")}</div>
        <div className="wb-row-right"><button className="wb-primary" onClick={()=>void submitPermissions()}
          disabled={permissionMode==="full"&&!fullConsent}><ShieldCheck size={16}/>{t("保存权限")}</button></div>
        <Approvals language={language} state={state} call={w.call}/>
      </div>}

      {state&&currentTab==="github"&&<div className="wb-admin">
        <div className="wb-block-title"><div><h2>{t("GitHub 集成")}</h2>
          <p>{t("连接须由服务端安全持有凭据，客户端不会索要 Token。")}</p></div><GitBranch size={23}/></div>
        <div className="wb-capabilities">
          <span className={repoStatus?.configured?"wb-health wb-health--ready":"wb-health"}>
            {repoStatus?.configured?<CheckCircle2 size={16}/>:<CircleAlert size={16}/>}
            {t(repoStatus?.configured?"服务端已配置 GitHub 凭据":"服务端未配置 GitHub 凭据")}</span>
          <span className="wb-scope">{repoStatus?.writeEnabled?t("写入 GitHub 分支"):t("启用写入需配置 CIRO_GITHUB_WRITES=true")}</span>
        </div>
        <section className="wb-card"><h3>{t("仓库白名单")}</h3>
          <p className="wb-muted">{t("仅显示服务端明确授权的仓库。")}</p>
          <div className="wb-tags">{(repoStatus?.allowedRepositories||[]).map(repo=><button key={repo} onClick={()=>setRepoInput(repo)}>{repo}</button>)}</div>
          <div className="wb-field-row">
            <input aria-label={t("选择或填写 owner/repo")} placeholder="owner/repository" value={repoInput} onChange={e=>setRepoInput(e.target.value)}/>
            <button disabled={!repoStatus?.configured||!repoInput.trim()} className="wb-primary" onClick={()=>void connectGithub()}><PlugZap size={16}/>{t("验证并连接")}</button>
          </div>
          {state.policy.repo&&<p className="wb-verified"><Check size={16}/>{t("当前仓库")}: {state.policy.repo}</p>}
          {!repoStatus?.configured&&<code className="wb-inline-code">CIRO_GITHUB_TOKEN / CIRO_GITHUB_REPOS</code>}
        </section>
        <section className="wb-card"><h3>{t("读取文件")}</h3>
          <div className="wb-grid-two">
            <label className="wb-label">{t("相对路径")}<input aria-label={t("相对路径")} value={filePath} onChange={e=>setFilePath(e.target.value)}/></label>
            <label className="wb-label">{t("工作分支")}<input aria-label={t("工作分支")} value={branch} onChange={e=>setBranch(e.target.value)}/></label>
          </div>
          <div className="wb-actions">
            <button className="wb-secondary" disabled={!state.policy.repo} onClick={()=>void readGithub()}><Search size={16}/>{t("读取")}</button>
            <button className="wb-secondary" disabled={!state.policy.repo||!repoStatus?.writeEnabled}
              onClick={()=>void w.call("/github/branch",{branch},t("已创建"))}><GitBranch size={16}/>{t("创建分支")}</button>
          </div>
          {githubFile?<div className="wb-editor"><div><FileCode2 size={17}/>{githubFile.path}<small>SHA {githubFile.sha.slice(0,9)}</small></div>
            <textarea aria-label={t("文件内容")} spellCheck={false} value={fileText} rows={9} onChange={e=>setFileText(e.target.value)}/>
            <label className="wb-label">{t("提交说明")}<input aria-label={t("提交说明")} maxLength={150} value={commitMessage} onChange={e=>setCommitMessage(e.target.value)}/></label>
            <div className="wb-row-right"><button className="wb-primary" disabled={!repoStatus?.writeEnabled||!branch} onClick={()=>void commitGithub()}>
              <GitCommitHorizontal size={16}/>{t("提交文件")}</button></div>
          </div>:<p className="wb-muted">{t("读取后可编辑并提交至功能分支。")}</p>}
          <p className="wb-footnote"><LockKeyhole size={16}/>{t("仅允许功能分支，不允许覆盖 main。")}</p>
        </section>
        <Approvals language={language} state={state} call={w.call}/>
      </div>}

      {state&&currentTab==="plugins"&&<div className="wb-admin">
        <PluginConnections/>
        <div className="wb-block-title"><div><h2>{t("插件管理")}</h2>
          <p>{t("仅列出内置可核验的适配器，不运行不可信远程插件代码。")}</p></div><PlugZap size={23}/></div>

      </div>}

      {state&&currentTab==="schedules"&&<div className="wb-admin">
        <div className="wb-block-title"><div><h2>{t("任务调度")}</h2>
          <p>{t("仅本地服务运行时定时检查；没有在线服务就不会自动执行。")}</p></div><CalendarClock size={23}/></div>
        <form className="wb-card wb-schedule-form" onSubmit={e=>void createSchedule(e)}>
          <label className="wb-label">{t("计划名称")}<input required maxLength={130} aria-label={t("计划名称")} value={scheduleTitle} onChange={e=>setScheduleTitle(e.target.value)}/></label>
          <label className="wb-label">{t("计划目标")}<textarea required maxLength={12000} rows={3} aria-label={t("计划目标")} value={scheduleGoal} onChange={e=>setScheduleGoal(e.target.value)}/></label>
          <div className="wb-grid-two">
            <label className="wb-label">{t("运行频率")}<select aria-label={t("运行频率")} value={frequency} onChange={e=>setFrequency(e.target.value as typeof frequency)}>
              <option value="hourly">{t("每小时")}</option><option value="daily">{t("每天")}</option><option value="weekly">{t("每周")}</option>
            </select></label>
            {frequency!=="hourly"&&<label className="wb-label">{t("本地小时")}<select aria-label={t("本地小时")} value={scheduleHour}
              onChange={e=>setScheduleHour(Number(e.target.value))}>{Array.from({length:24},(_,h)=><option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}</select></label>}
            {frequency==="weekly"&&<label className="wb-label">{t("星期")}<select aria-label={t("星期")} value={weekday} onChange={e=>setWeekday(Number(e.target.value))}>
              {["星期日","星期一","星期二","星期三","星期四","星期五","星期六"].map((name,index)=><option key={name} value={index}>{t(name)}</option>)}
            </select></label>}
            <label className="wb-label">{t("时区")}<input aria-label={t("时区")} value={timezone} onChange={e=>setTimezone(e.target.value)}/></label>
          </div>
          <div className="wb-row-right"><button className="wb-primary" type="submit"><Plus size={16}/>{t("添加任务")}</button></div>
        </form>
        {state.schedules.length===0&&<div className="wb-empty"><Clock3 size={24}/>{t("暂无定时任务")}</div>}
        <div className="wb-schedule-list">{state.schedules.map(s=><article className="wb-schedule" key={s.id}>
          <CalendarClock size={19}/><div><strong>{s.title}</strong><p>{s.goal}</p>
            <small>{t(s.recurrence==="hourly"?"每小时":s.recurrence==="daily"?"每天":"每周")} · {s.timezone}
            {s.hour!==null?" · "+String(s.hour).padStart(2,"0")+":00":""}</small></div>
          <button className="wb-secondary" onClick={()=>void w.call("/schedules/"+s.id+"/toggle",{enabled:!s.enabled})}>
            {s.enabled?<Pause size={15}/>:<Play size={15}/>} {t(s.enabled?"暂停计划":"启用计划")}</button>
          <button className="wb-icon-danger" title={t("删除计划")} aria-label={t("删除计划")} onClick={()=>void w.call("/schedules/"+s.id+"/delete",{})}><Trash2 size={16}/></button>
        </article>)}</div>
        <div className="wb-footnote"><ShieldCheck size={17}/>{t("重要：定时自动执行也遵循权限模式。")}</div>
      </div>}
    </div>
  </section>;
}

function GoalCard({goal,language,expanded,toggle,action}:{
  goal:WorkbenchGoal;language:Language;expanded:boolean;toggle:()=>void;action:(action:string)=>Promise<void>;
}) {
  const t=(s:string)=>workbenchTranslate(language,s);
  const status=t(statusKeys[goal.status]||goal.status);
  return <article className="wb-goal-card">
    <div className="wb-goal-card-top">
      <div className="wb-goal-mark"><Users size={20}/></div>
      <div className="wb-goal-info"><strong>{goal.title}</strong>
        <p>{goal.goal}</p><small>{readable(goal.createdAt,language)} · {t("阶段")}: {t(stages.find(s=>s.phase===goal.phase)?.title||goal.phase)}</small>
      </div>
      <span className={goal.status==="completed"?"wb-badge wb-badge--success":"wb-badge"}>{status}</span>
    </div>
    <div className="wb-goal-actions">
      <button type="button" onClick={toggle} className="wb-secondary">{t(expanded?"收起详情":"展开详情")}</button>
      {["paused","planned","blocked","waiting_runtime","waiting_verifier","needs_evidence"].includes(goal.status)&&
        <button type="button" className="wb-secondary" onClick={()=>void action("resume")}><Play size={15}/>{t("恢复")}</button>}
      {["running","queued"].includes(goal.status)&&<button className="wb-secondary" onClick={()=>void action("pause")}><Pause size={15}/>{t("暂停")}</button>}
      {!["cancelled","completed"].includes(goal.status)&&<button className="wb-secondary wb-danger" onClick={()=>void action("cancel")}><X size={15}/>{t("终止")}</button>}
    </div>
    {expanded&&<div className="wb-goal-details">
      {goal.error&&<p className="wb-error-line"><CircleAlert size={15}/>{goal.error}</p>}
      {goal.plan.length>0&&<div className="wb-detail-block"><h4>{t("计划步骤")}</h4>
        {goal.plan.map(step=><div className="wb-task-line" key={step.id}><span>{step.id}</span>
          <div><strong>{step.title}</strong><small>{step.role} · {step.acceptance}</small></div></div>)}</div>}
      <div className="wb-detail-block"><h4>{t("执行轨迹")}</h4>
        {goal.events.slice(0,18).map((item,index)=><p className="wb-event" key={item.time+index}>
          <time>{readable(item.time,language)}</time><strong>{item.event}</strong><span>{item.details}</span></p>)}
      </div>
      <div className="wb-detail-block"><h4>{t("验证收据")}</h4>
        {goal.evidence.length===0?<p className="wb-muted">{t("尚无执行证据")}</p>:
          goal.evidence.map((item,index)=><p className="wb-evidence" key={item.digest+index}><CheckCircle2 size={15}/>
            <strong>{item.phase}</strong><code>{item.digest.slice(0,16)}…</code><small>{item.location}</small></p>)}
      </div>
    </div>}
  </article>;
}
function Approvals({language,state,call}:{
  language:Language;state:WorkbenchState;call:<T>(path:string,payload:unknown,noticeText?:string)=>Promise<T|null>
}){
  const t=(s:string)=>workbenchTranslate(language,s);
  return <section className="wb-approvals">
    <div className="wb-block-title"><div><h2>{t("待批准操作")}</h2>
      <p>{t("批准即执行这条已固定参数的操作。")}</p></div><span>{state.approvals.length}</span></div>
    {state.approvals.length===0?<p className="wb-muted">{t("没有待批准操作")}</p>:
    <div className="wb-approval-list">{state.approvals.map(item=><article className="wb-approval" key={item.id}>
      <span className="wb-approval-icon"><LockKeyhole size={17}/></span>
      <div><strong>{item.summary}</strong><small>{item.type} · {readable(item.createdAt,language)}</small></div>
      <button className="wb-secondary" onClick={()=>void call("/approvals/"+item.id+"/decision",{decision:"reject"})}>{t("拒绝")}</button>
      <button className="wb-primary" onClick={()=>void call("/approvals/"+item.id+"/decision",{decision:"approve"})}><Check size={15}/>{t("批准")}</button>
    </article>)}</div>}
  </section>;
}

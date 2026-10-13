import { localeTag } from "./lib/i18n";
import {useEffect,useMemo,useRef,useState} from "react";
import type {ChangeEvent,FormEvent,ReactNode} from "react";
import {
  Activity,ArrowLeft,ArrowRight,AudioLines,BookOpen,BrainCircuit,Camera,Check,CheckCircle2,
  ChevronRight,CircleAlert,Cloud,Code2,Download,FileCode2,FilePlus2,
  FileText,Folder,FolderOpen,GitBranch,Globe2,History,Layers,
  LoaderCircle,Mic,Monitor,PackageCheck,Pause,Play,Plus,RefreshCcw,
  RotateCcw,Search,Server,ShieldCheck,Sparkles,Star,TabletSmartphone,Terminal,
  Wallet,Workflow,X
} from "lucide-react";
import type {LucideIcon} from "lucide-react";
import type {Conversation} from "./types";
import type {Language} from "./lib/i18n";
import {studioTranslate} from "./lib/studio-i18n";
import {studioApi,humanBytes} from "./lib/studio-api";
import type {StudioTab,StudioCapabilities,DraftProject,KnowledgeDoc,KnowledgeHit,
  NativeJob,Telemetry,MarketEntry,NativeService,ModelOverview,TrainingDetail} from "./lib/studio-api";
import {probeNativeShell,sendNativeNotification} from "./lib/native-shell";
import type {NativeShellStatus} from "./lib/native-shell";
import {commercialApi} from "./lib/commercial-api";
import type {CommerceState} from "./lib/commercial-api";

type LibraryOp="folder"|"branch"|"checkpoint"|"restore";
type Props={language:Language;section:StudioTab;conversations:Conversation[];
  onNavigate:(target:string)=>void;
  onLibraryAction:(op:LibraryOp,id:string,value:string|number)=>void};
type RuntimeResult={status:string;jobId?:string;summary?:string|null;verified?:boolean;
  sources?:{title:string;url:string;excerpt:string}[];evidence?:unknown[]};

const modules:{id:StudioTab;name:string;desc:string;icon:LucideIcon;gate:keyof StudioCapabilities|null}[]=[
  {id:"thinking",name:"持续思考",desc:"推理控制台",icon:BrainCircuit,gate:"thinking"},
  {id:"ide",name:"代码工作区",desc:"安全草稿编辑器",icon:Code2,gate:"ide"},
  {id:"knowledge",name:"知识与文件",desc:"搜索知识库",icon:BookOpen,gate:"knowledge"},
  {id:"research",name:"研究工作台",desc:"多来源检索与交叉验证",icon:Globe2,gate:"research"},
  {id:"media",name:"多模态工作台",desc:"图片 · 语音 · 视频",icon:Camera,gate:"media"},
  {id:"compute",name:"算力与成本",desc:"GPU 实时遥测",icon:Activity,gate:"compute"},
  {id:"library",name:"历史对话与版本",desc:"本地会话可搜索、分支和恢复；打开跨设备同步后将随对话快照同步。",icon:History,gate:"conversations"},
  {id:"marketplace",name:"官方应用与技能",desc:"可信签名目录",icon:Layers,gate:"marketplace"},
  {id:"devices",name:"跨平台终端",desc:"浏览器 PWA",icon:TabletSmartphone,gate:"devices"}
];
// What each entry can actually do on this server right now (from /api/studio/capabilities), not a fixed list.
type ModuleLevel="ok"|"partial"|"off"|"unknown";
function serviceState(x:NativeService|undefined):{level:ModuleLevel;label:string}{
  if(!x)return {level:"unknown",label:"检测中…"};
  return x.configured?(x.verified?{level:"ok",label:"可用"}:{level:"partial",label:"已配置，待验证"}):{level:"off",label:"未连接"};
}
function moduleState(id:string,caps:StudioCapabilities|null):{level:ModuleLevel;label:string}{
  if(!caps)return {level:"unknown",label:"检测中…"};
  switch(id){
    case "thinking":return serviceState(caps.thinking.provider);
    case "research":return serviceState(caps.research);
    case "media":return serviceState(caps.media);
    case "compute":return serviceState(caps.compute.modelControl);
    case "ide":return caps.ide.sandboxExecution.configured?{level:"ok",label:"可用"}:{level:"partial",label:"可编辑，运行需连接"};
    case "knowledge":return caps.knowledge.embedding.configured?{level:"ok",label:"可用"}:{level:"partial",label:"本地搜索可用"};
    case "marketplace":return caps.marketplace.remoteRegistry.configured?{level:"ok",label:"可用"}:{level:"partial",label:"内置目录可用"};
    case "library":case "devices":return {level:"ok",label:"可用"};
    default:return {level:"unknown",label:"未知"};
  }
}
function Status({ready,language}: {ready:boolean;language:Language}){
  const t=(s:string)=>studioTranslate(language,s);
  return <span className={ready?"stu-status stu-status--ready":"stu-status"}>
    {ready?<CheckCircle2 size={14}/>:<CircleAlert size={14}/>}
    {t(ready?"已具备":"待连接")}</span>;
}
function Banner({children}: {children:ReactNode}){
  return <div className="stu-banner"><ShieldCheck size={17}/><span>{children}</span></div>;
}
function Empty({icon:Icon,label,detail}: {icon:LucideIcon;label:string;detail?:string}){
  return <div className="stu-empty"><Icon size={26}/><strong>{label}</strong>{detail&&<p>{detail}</p>}</div>;
}
function JobResult({job,refresh,language}: {job:RuntimeResult|null;refresh:()=>void;language:Language}){
  if(!job)return null;const t=(s:string)=>studioTranslate(language,s);
  return <section className="stu-card stu-result"><div className="stu-section-head">
    <h3><Activity size={16}/>{t("任务回执")}</h3>
    <button type="button" className="stu-light-button" onClick={refresh}><RefreshCcw size={14}/>{t("刷新任务")}</button></div>
    <div className="stu-result-line"><span className="stu-tag">{job.status}</span>
      {job.verified===false&&<span className="stu-tag stu-tag--warn">{t("待验证")}</span>}
      <code>{job.jobId}</code></div>
    {job.summary&&<p className="stu-result-text">{job.summary}</p>}
    {job.sources?.length? <div className="stu-source-list">{job.sources.map((s,i)=>
      <a key={s.url+i} href={s.url} target="_blank" rel="noopener noreferrer">
        <span>[{i+1}] {s.title}</span><small>{s.excerpt||s.url}</small><ChevronRight size={15}/>
      </a>)}</div>:null}
    {job.evidence?.length?<div className="stu-evidence">{job.evidence.length} {t("保留证据")}</div>:null}
  </section>;
}
function NativeNote({provider,language}: {provider?:NativeService;language:Language}){
  const t=(s:string)=>studioTranslate(language,s);
  return <Banner>{provider?.configured?t("已配置，待核验"):t("未连接原生运行时")} ·
    {t("已连接服务并不等于已通过独立验收。")}</Banner>;
}

export default function StudioCenter({language,section,conversations,onNavigate,onLibraryAction}:Props){
  const t=(s:string)=>studioTranslate(language,s);
  const [caps,setCaps]=useState<StudioCapabilities|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [loading,setLoading]=useState(false);
  const [projects,setProjects]=useState<DraftProject[]>([]);
  const [selectedProject,setSelectedProject]=useState<DraftProject|null>(null);
  const [projectName,setProjectName]=useState(""),[newFile,setNewFile]=useState(""),
    [selectedPath,setSelectedPath]=useState(""),[fileContent,setFileContent]=useState(""),
    [checkpointLabel,setCheckpointLabel]=useState("Release candidate"),
    [runnerTask,setRunnerTask]=useState("test");
  const [documents,setDocuments]=useState<KnowledgeDoc[]>([]),[knowledgeQuery,setKnowledgeQuery]=useState(""),
    [knowledgeHits,setKnowledgeHits]=useState<KnowledgeHit[]>([]);
  const [objective,setObjective]=useState(""),[minutes,setMinutes]=useState(5),
    [priority,setPriority]=useState(1),[thinkJob,setThinkJob]=useState<RuntimeResult|null>(null);
  const [researchQuery,setResearchQuery]=useState(""),[researchDepth,setResearchDepth]=useState("quick"),
    [researchJob,setResearchJob]=useState<RuntimeResult|null>(null);
  const [mediaFile,setMediaFile]=useState<File|null>(null),[mediaJob,setMediaJob]=useState<RuntimeResult|null>(null),
    [recording,setRecording]=useState(false);
  const recorderRef=useRef<MediaRecorder|null>(null),chunksRef=useRef<Blob[]>([]),recordStream=useRef<MediaStream|null>(null);
  const [telemetry,setTelemetry]=useState<Telemetry[]>([]),[commercial,setCommercial]=useState<CommerceState|null>(null);
  const [modelOverview,setModelOverview]=useState<ModelOverview|null>(null);
  const [trainingDetail,setTrainingDetail]=useState<TrainingDetail|null>(null);
  const [registry,setRegistry]=useState<{connected:boolean;items:MarketEntry[];selected:{id:string}[]}|null>(null);
  const [libraryQuery,setLibraryQuery]=useState(""),[folderDraft,setFolderDraft]=useState(""),
    [branchAt,setBranchAt]=useState(0),[libraryActive,setLibraryActive]=useState<string|null>(null);
  const [installPrompt,setInstallPrompt]=useState<{prompt:()=>Promise<void>}|null>(null);
  const [nativeShell,setNativeShell]=useState<NativeShellStatus|null>(null);
  const [noticePermission,setNoticePermission]=useState(typeof Notification==="undefined"?"unsupported":Notification.permission);

  /** Buttons that need a native adapter stay clickable and explain exactly what to configure. */
  function needs(configured:boolean|undefined,env:string){
    if(configured)return {};
    return {"aria-disabled":true as const,title:t("需要先在服务端配置：")+env,
      onClickCapture:(event:{preventDefault:()=>void;stopPropagation:()=>void})=>{
        event.preventDefault();event.stopPropagation();
        setNotice("");setError(t("该功能需要连接原生服务。请在服务端 .env 配置 ")+env+t(" 后重启。"));
      }};
  }
  const chosen=useMemo(()=>selectedProject?.files.find(f=>f.path===selectedPath)||null,[selectedProject,selectedPath]);
  const libraryList=useMemo(()=>conversations.filter(c=>[c.title,...c.messages.map(m=>m.content)]
    .join(" ").toLowerCase().includes(libraryQuery.toLowerCase()))
    .sort((a,b)=>b.updatedAt-a.updatedAt),[conversations,libraryQuery]);
  const selectedChat=conversations.find(x=>x.id===libraryActive);
  
  useEffect(()=>{
    let active=true;
    void studioApi<StudioCapabilities>("/capabilities").then(x=>{if(active)setCaps(x);})
      .catch(e=>{if(active)setError(String(e));});
    return ()=>{active=false;};
  },[]);
  useEffect(()=>{
    if(section!=="devices")return;
    let active=true;
    void probeNativeShell().then(x=>{if(active)setNativeShell(x);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:String(e));});
    return ()=>{active=false;};
  },[section]);
  useEffect(()=>{
    const onInstall=(event:Event)=>{
      const typed=event as Event&{prompt?:()=>Promise<void>;preventDefault:()=>void};
      if(typed.prompt){typed.preventDefault();setInstallPrompt({prompt:typed.prompt.bind(typed)});}
    };
    window.addEventListener("beforeinstallprompt",onInstall);
    return ()=>window.removeEventListener("beforeinstallprompt",onInstall);
  },[]);
  useEffect(()=>()=>{recorderRef.current?.state==="recording"&&recorderRef.current.stop();
    recordStream.current?.getTracks().forEach(x=>x.stop());},[]);
  useEffect(()=>{
    if(section!=="compute")return;
    const timer=setInterval(()=>{
      void studioApi<{events:Telemetry[]}>("/compute").then(data=>setTelemetry(data.events)).catch(()=>{});
    },12000);
    return ()=>clearInterval(timer);
  },[section]);
  useEffect(()=>{
    let active=true;
    const get=async()=>{
      try{
        if(section==="ide"){
          const x=await studioApi<{projects:DraftProject[]}>("/projects");
          if(active)setProjects(x.projects);
        }
        if(section==="knowledge"){
          const x=await studioApi<{documents:KnowledgeDoc[]}>("/knowledge");
          if(active)setDocuments(x.documents);
        }
        if(section==="compute"){
          if(caps?.compute.modelControl.configured){
            const overview=await studioApi<ModelOverview>("/model-control");
            if(active)setModelOverview(overview);
          }
          const [x,b]=await Promise.all([
            studioApi<{events:Telemetry[]}>("/compute"),commercialApi<CommerceState>("/state")
          ]);
          if(active){setTelemetry(x.events);setCommercial(b);}
        }
        if(section==="marketplace"){
          const x=await studioApi<{connected:boolean;items:MarketEntry[];selected:{id:string}[]}>("/marketplace");
          if(active)setRegistry(x);
        }
      }catch(e){if(active)setError(e instanceof Error?e.message:String(e));}
    };
    void get();
    return ()=>{active=false;};
  },[section,caps?.compute.modelControl.configured]);
  async function run(task:()=>Promise<void>,success=""){
    setError("");setNotice("");setLoading(true);
    try{await task();if(success)setNotice(t(success));}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setLoading(false);}
  }
  async function refreshProjects(){
    const x=await studioApi<{projects:DraftProject[]}>("/projects");setProjects(x.projects);
  }
  async function selectProject(id:string){
    await run(async()=>{
      const {project}=await studioApi<{project:DraftProject}>("/projects/"+id);
      setSelectedProject(project);setSelectedPath(project.files[0]?.path||"");
      setFileContent(project.files[0]?.content||"");
    });
  }
  function focusFile(project:DraftProject,path:string){
    const item=project.files.find(f=>f.path===path);
    setSelectedPath(path);setFileContent(item?.content||"");
  }
  async function saveFile(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!selectedProject)return;
    const path=selectedPath||newFile.trim();
    await run(async()=>{
      const data=await studioApi<{project:DraftProject}>("/projects/"+selectedProject.id+"/file","PUT",{
        baseRevision:selectedProject.revision,path,content:fileContent
      });
      setSelectedProject(data.project);setSelectedPath(path);setNewFile("");await refreshProjects();
    },"保存");
  }
  async function importFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";
    if(!file)return;
    if(!/\.(txt|md|markdown|csv|json|xml|yaml|yml|ts|tsx|js|jsx|py|go|rs|sql|log)$/i.test(file.name)||
      file.size>120000){setError(t("不支持该格式"));return;}
    await run(async()=>{
      const content=await file.text();
      const r=await studioApi<{document:KnowledgeDoc}>("/knowledge/import","POST",{
        title:file.name,text:content,source:"local-upload"
      });
      setDocuments(old=>[r.document,...old.filter(x=>x.id!==r.document.id)]);
    },"保存");
  }
  async function searchKnowledge(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    await run(async()=>{
      const data=await studioApi<{results:KnowledgeHit[]}>("/knowledge/search?q="+encodeURIComponent(knowledgeQuery.trim()));
      setKnowledgeHits(data.results);
    });
  }
  async function poll(type:"think"|"research"|"media"){
    const target=type==="think"?thinkJob:type==="research"?researchJob:mediaJob;
    if(!target?.jobId)return;
    await run(async()=>{
      const path=type==="think"?"/think/jobs/"+target.jobId:
        type==="research"?"/research/"+target.jobId:"/media/jobs/"+target.jobId;
      const response=await studioApi<NativeJob>(path);
      if(type==="think")setThinkJob(response);
      if(type==="research")setResearchJob(response);
      if(type==="media")setMediaJob(response);
    });
  }
  async function startThinking(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    await run(async()=>{
      const data=await studioApi<NativeJob>("/think/jobs","POST",{
        objective:objective.trim(),maxSeconds:minutes*60,priority
      });
      setThinkJob(data);
    },"已提交");
  }
  async function startResearch(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    await run(async()=>{
      const data=await studioApi<NativeJob>("/research","POST",{
        query:researchQuery.trim(),depth:researchDepth
      });
      setResearchJob(data);
    },"已提交");
  }
  async function uploadMedia(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!mediaFile)return;
    const kind=mediaFile.type.startsWith("image/")?"image":
      mediaFile.type.startsWith("audio/")?"audio":"video";
    await run(async()=>{
      const session=await studioApi<{jobId:string;uploadUrl:string;uploadMethod:string;uploadHeaders:Record<string,string>}>("/media/jobs","POST",{
        filename:mediaFile.name,mime:mediaFile.type,bytes:mediaFile.size,kind
      });
      const uploaded=await fetch(session.uploadUrl,{method:"PUT",body:mediaFile,headers:session.uploadHeaders,
        credentials:"omit",redirect:"error"});
      if(!uploaded.ok)throw new Error("Media upload HTTP "+uploaded.status);
      const response=await studioApi<NativeJob>("/media/jobs/"+session.jobId+"/complete","POST",{});
      setMediaJob({...response,jobId:session.jobId,verified:false});
    },"已提交");
  }
  async function startRecording(){
    if(typeof MediaRecorder==="undefined"||!navigator.mediaDevices?.getUserMedia){
      setError(t("当前浏览器不支持"));return;
    }
    await run(async()=>{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      recordStream.current=stream;chunksRef.current=[];
      const mime=MediaRecorder.isTypeSupported("audio/webm")?"audio/webm":"";
      const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{});
      recorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data.size>0)chunksRef.current.push(e.data);};
      recorder.onstop=()=>{
        const mimeType=recorder.mimeType||"audio/webm";
        const blob=new Blob(chunksRef.current,{type:mimeType});
        setMediaFile(new File([blob],"ciro-voice-"+Date.now()+".webm",{type:mimeType}));
        stream.getTracks().forEach(track=>track.stop());
        setRecording(false);
      };
      recorder.start();setRecording(true);
    });
  }
  function stopRecording(){if(recorderRef.current?.state==="recording")recorderRef.current.stop();}
  async function refreshCompute(){
    await run(async()=>{
      const [x,b]=await Promise.all([studioApi<{events:Telemetry[]}>("/compute"),commercialApi<CommerceState>("/state")]);
      setTelemetry(x.events);setCommercial(b);
    });
  }
  function labelledNumber(n:number|undefined,suffix=""){
    return typeof n==="number"?new Intl.NumberFormat(localeTag(language),{maximumFractionDigits:1}).format(n)+suffix:"—";
  }
  return <div className="stu-root">
    <header className="stu-header">
      <div><div className="stu-eyebrow"><Sparkles size={15}/> CIRO UNIFIED STUDIO · V0.7</div>
        <h1>{section==="studio"?t("融合工作台"):t(modules.find(x=>x.id===section)?.name||"融合工作台")}</h1>
        <p>{section==="studio"?t("从灵感到交付，保持每一步可见。"):
          t(modules.find(x=>x.id===section)?.desc||"全能对话 + 自主执行")}</p>
      </div>
      {section!=="studio"&&<button className="stu-light-button" onClick={()=>onNavigate("studio")}><ArrowLeft size={16}/>{t("融合工作台")}</button>}
    </header>
    {error&&<div className="stu-alert stu-alert--error" role="alert"><CircleAlert size={17}/><span>{error}</span>
      <button onClick={()=>setError("")}><X size={14}/></button></div>}
    {notice&&<div className="stu-alert stu-alert--good" role="status"><Check size={16}/>{notice}</div>}
    {loading&&<div className="stu-progress" role="status"><LoaderCircle size={16} className="stu-spin"/>{t("载入中")}</div>}

    {section==="studio"&&<>
      <div className="stu-hero">
        <div><div className="stu-hero-tag"><Star size={14}/>{t("全能对话 + 自主执行")}</div>
          <h2>{t("从灵感到交付，保持每一步可见。")}</h2>
          <p>{t("选择并完成一个任务；真实代码执行需要 CIRO 原生运行时和独立验证器。")}</p>
          <div className="stu-actions">
            <button className="stu-primary" onClick={()=>onNavigate("chat")}><ArrowRight size={15}/>{t("开始聊天")}</button>
            <button className="stu-hero-secondary" onClick={()=>onNavigate("goals")}><Workflow size={16}/>{t("打开协作空间")}</button>
          </div>
        </div>
        <div className="stu-hero-orbit" aria-hidden="true"><BrainCircuit size={70}/><span>CIRO</span></div>
      </div>
      <div className="stu-section-head"><h3><Layers size={18}/>{t("功能入口")}</h3>
        <span>{t("控制层就绪，原生能力待接通。")}</span></div>
      <div className="stu-module-grid">
        <button className="stu-module stu-module--accent" onClick={()=>onNavigate("goals")}>
          <span className="stu-module-icon"><Workflow size={24}/></span><strong>{t("打开协作空间")}</strong>
          <p>{t("选择并完成一个任务；真实代码执行需要 CIRO 原生运行时和独立验证器。")}</p>
          <ChevronRight size={16} className="stu-module-arrow"/>
        </button>
        {modules.map(item=>{
          const Icon=item.icon;
          const state=moduleState(item.id,caps);
          return <button className="stu-module" key={item.id} onClick={()=>onNavigate(item.id)}>
            <span className="stu-module-icon"><Icon size={24}/></span>
            <strong>{t(item.name)}</strong><p>{t(item.desc)}</p>
            <span className={"stu-mini-state stu-mini-state--"+state.level}>{t(state.label)}</span>
            <ChevronRight size={16} className="stu-module-arrow"/>
          </button>;
        })}
      </div>
      <Banner>{t("真实能力取决于服务端和 CIRO 原生模型；未配置时会明确失败。")}</Banner>
    </>}

    {section==="thinking"&&<>
      <NativeNote provider={caps?.thinking.provider} language={language}/>
      <div className="stu-feature-grid">
        <section className="stu-card">
          <div className="stu-section-head"><h3><BrainCircuit size={18}/>{t("持续推演任务")}</h3></div>
          <form className="stu-form" onSubmit={e=>void startThinking(e)}>
            <label>{t("问题或目标")}<textarea required maxLength={5000} rows={5} value={objective}
              placeholder={t("问题或目标")} onChange={e=>setObjective(e.target.value)}/></label>
            <div className="stu-dual">
              <label>{t("时间预算")}<select value={minutes} onChange={e=>setMinutes(Number(e.target.value))}>
                {[1,2,5,10,20,30,60].map(n=><option key={n} value={n}>{n} {t("分钟")}</option>)}</select></label>
              <label>{t("算力优先级")}<select value={priority} onChange={e=>setPriority(Number(e.target.value))}>
                {[1,2,5].map(n=><option key={n} value={n}>{n}×</option>)}</select></label>
            </div>
            <button className="stu-primary" disabled={loading} {...needs(caps?.thinking.provider.configured,"CIRO_REASONING_URL / CIRO_REASONING_TOKEN")}><Play size={15}/>{t("创建思考任务")}</button>
          </form>
        </section>
        <section className="stu-card stu-split-info"><h3>{t("推理策略")}</h3>
          <div className="stu-mode-list">
            <div><span>01</span><strong>{t("快速回答")}</strong><Status ready language={language}/></div>
            <div><span>02</span><strong>{t("深度思考")}</strong><Status ready={Boolean(caps?.thinking.deepChatSupported)} language={language}/></div>
            <div><span>03</span><strong>{t("持续思考")}</strong><Status ready={Boolean(caps?.thinking.provider.configured)} language={language}/></div>
          </div>
          <p>{t("服务未接通，不能开始真实推演。")}</p>
        </section>
      </div>
      <JobResult job={thinkJob} refresh={()=>void poll("think")} language={language}/>
      {thinkJob?.jobId&&caps?.thinking.provider.configured&&<div className="stu-actions stu-job-actions">
        {(["pause","resume","cancel"] as const).map(action=><button className="stu-light-button" key={action}
          onClick={()=>void run(async()=>{
            const data=await studioApi<NativeJob>("/think/jobs/"+thinkJob.jobId+"/actions","POST",{action});
            setThinkJob(old=>old?{...old,status:data.status}:old);
          })}>{t(action==="pause"?"暂停任务":action==="resume"?"恢复任务":"取消任务")}</button>)}
      </div>}
    </>}

    {section==="ide"&&<>
      <Banner>{t("保存到本地项目服务器，不执行宿主机命令。")}</Banner>
      <div className="stu-ide-toolbar">
        <form onSubmit={e=>{e.preventDefault();void run(async()=>{
          const r=await studioApi<{project:DraftProject}>("/projects","POST",{name:projectName});
          setProjectName("");await refreshProjects();await selectProject(r.project.id);
        });}}>
          <input aria-label={t("项目名称")} value={projectName} maxLength={90}
            onChange={e=>setProjectName(e.target.value)} placeholder={t("项目名称")} required/>
          <button className="stu-primary" disabled={loading}><Plus size={15}/>{t("创建项目")}</button>
        </form>
        <select aria-label={t("项目文件")} value={selectedProject?.id||""} onChange={e=>void selectProject(e.target.value)}>
          <option value="">{t("选择一个模块开始")}</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>
      </div>
      {selectedProject?<div className="stu-ide-layout">
        <aside className="stu-file-tree">
          <div className="stu-pane-head"><FolderOpen size={17}/><strong>{selectedProject.name}</strong>
            <small>r{selectedProject.revision}</small></div>
          {selectedProject.files.map(f=><button key={f.path} className={selectedPath===f.path?"stu-file-selected":""}
            onClick={()=>focusFile(selectedProject,f.path)}><FileCode2 size={15}/>{f.path}</button>)}
          <div className="stu-new-file">
            <input aria-label={t("新文件路径")} placeholder="src/module.ts" value={newFile} onChange={e=>setNewFile(e.target.value)}/>
            <button className="stu-light-button" disabled={!newFile.trim()} onClick={()=>{
              focusFile(selectedProject,newFile.trim());setFileContent("");
            }}><FilePlus2 size={15}/>{t("新建")}</button>
          </div>
        </aside>
        <div className="stu-editor-pane">
          <div className="stu-pane-head"><Code2 size={17}/><strong>{selectedPath||t("文件内容")}</strong>
            <small>revision {selectedProject.revision}</small></div>
          <form onSubmit={e=>void saveFile(e)}>
            <textarea className="stu-code-editor" aria-label={t("文件内容")} rows={18} spellCheck={false}
              value={fileContent} onChange={e=>setFileContent(e.target.value)}/>
            <div className="stu-actions"><button className="stu-primary" disabled={!selectedPath||loading}>
              <Check size={15}/>{t("保存文件")}</button>
              <span className="stu-small">{humanBytes(new Blob([fileContent]).size,language)}</span></div>
          </form>
        </div>
      </div>:<Empty icon={Folder} label={t("没有项目，先创建一个。")}/>}
      {selectedProject&&<>
        <div className="stu-feature-grid">
          <section className="stu-card"><div className="stu-section-head"><h3><History size={18}/>{t("创建检查点")}</h3></div>
            <form className="stu-inline-form" onSubmit={e=>{e.preventDefault();void run(async()=>{
              await studioApi("/projects/"+selectedProject.id+"/checkpoints","POST",{label:checkpointLabel});
              await selectProject(selectedProject.id);
            },"保存");}}>
              <input aria-label={t("检查点名称")} maxLength={90} value={checkpointLabel} onChange={e=>setCheckpointLabel(e.target.value)}/>
              <button className="stu-primary"><Plus size={15}/>{t("创建检查点")}</button></form>
            {selectedProject.checkpoints.map(check=><div className="stu-check-row" key={check.id}>
              <div><strong>{check.label}</strong><small>{check.digest.slice(0,12)} · r{check.revision}</small></div>
              <button className="stu-light-button" onClick={()=>{if(window.confirm(t("恢复操作会替换该对话的当前消息。")))
                void run(async()=>{
                  const {project}=await studioApi<{project:DraftProject}>("/projects/"+selectedProject.id+"/restore","POST",{
                    checkpointId:check.id,baseRevision:selectedProject.revision
                  });setSelectedProject(project);focusFile(project,selectedPath);
                },"保存");}}><RotateCcw size={14}/>{t("恢复此版本")}</button></div>)}
          </section>
          <section className="stu-card"><h3><Terminal size={18}/>{t("安全测试")}</h3>
            <NativeNote provider={caps?.ide.sandboxExecution} language={language}/>
            <div className="stu-inline-form"><select aria-label={t("运行任务")} value={runnerTask} onChange={e=>setRunnerTask(e.target.value)}>
              <option value="test">{t("运行测试")}</option><option value="build">{t("构建项目")}</option>
              <option value="lint">{t("检查代码")}</option></select>
              <button className="stu-primary" disabled={loading} {...needs(caps?.ide.sandboxExecution.configured,"CIRO_IDE_RUNNER_URL / CIRO_IDE_RUNNER_TOKEN")}
                onClick={()=>void run(async()=>{
                  const data=await studioApi<{jobId:string}>("/projects/"+selectedProject.id+"/run","POST",{task:runnerTask});
                  setNotice(data.jobId);
                })}><Play size={15}/>{t("运行任务")}</button></div>
            <p className="stu-small">{t("请先取得工作台的 task.run 授权。")}</p>
            <button className="stu-link" onClick={()=>onNavigate("permissions")}>{t("关联协作空间")} <ArrowRight size={14}/></button>
          </section>
        </div>
        {chosen&&<section className="stu-card"><h3><GitBranch size={17}/>{t("版本差异")}</h3>
          <div className="stu-diff-grid"><div><span>{t("已保存版本")} · {chosen.path}</span>
            <pre>{chosen.content}</pre></div><div><span>{t("当前版本")}</span><pre>{fileContent}</pre></div></div></section>}
      </>}
    </>}

    {section==="knowledge"&&<>
      <div className="stu-feature-grid">
        <section className="stu-card"><div className="stu-section-head"><h3><FilePlus2 size={17}/>{t("导入文本文件")}</h3>
          <span>{documents.length}/120</span></div>
          <label className="stu-dropzone"><FileText size={30}/><strong>{t("导入文本文件")}</strong>
            <small>{t("最多 120 份文档，每份最多 60,000 字符。")}</small>
            <input aria-label={t("导入文本文件")} type="file" accept=".txt,.md,.markdown,.csv,.json,.xml,.yaml,.yml,.ts,.tsx,.js,.jsx,.py,.go,.rs,.sql,.log"
              onChange={e=>void importFile(e)}/></label>
          <p className="stu-small">{t("本地关键词检索可用；PDF、OCR 与语义嵌入需要另外接线。")}</p>
        </section>
        <section className="stu-card"><div className="stu-section-head"><h3><Search size={17}/>{t("搜索知识库")}</h3></div>
          <form className="stu-inline-form" onSubmit={e=>void searchKnowledge(e)}>
            <input aria-label={t("搜索知识库")} value={knowledgeQuery} required maxLength={120}
              onChange={e=>setKnowledgeQuery(e.target.value)} placeholder={t("搜索文本和代码来源")}/>
            <button className="stu-primary"><Search size={15}/>{t("搜索知识库")}</button>
            <button type="button" className="stu-light-button" {...needs(caps?.knowledge.embedding.configured,"CIRO_KNOWLEDGE_INDEX_URL / CIRO_KNOWLEDGE_INDEX_TOKEN")}
              onClick={()=>void run(async()=>{
                const data=await studioApi<{results:KnowledgeHit[]}>("/knowledge/semantic","POST",{query:knowledgeQuery.trim()});
                setKnowledgeHits(data.results);
              })}>{t("语义搜索")}</button></form>
          {knowledgeHits.length===0&&<p className="stu-small">{t("没有检索结果")}</p>}
          {knowledgeHits.map(hit=><div className="stu-hit" key={hit.id}><strong>{hit.title}</strong>
            <p>{hit.excerpt}</p><code>{t("引用位置")}: {hit.citation} · {hit.sha256.slice(0,12)}</code></div>)}
        </section>
      </div>
      <section className="stu-card"><div className="stu-section-head"><h3><BookOpen size={17}/>{t("文档数量")}: {documents.length}</h3></div>
        {documents.map(doc=><div className="stu-document" key={doc.id}>
          <FileText size={17}/><span><strong>{doc.title}</strong><small>{humanBytes(doc.bytes,language)} · SHA256 {doc.sha256.slice(0,12)}</small></span>
          <button className="stu-light-button" disabled={Boolean(doc.indexedAt)} {...needs(caps?.knowledge.embedding.configured,"CIRO_KNOWLEDGE_INDEX_URL / CIRO_KNOWLEDGE_INDEX_TOKEN")}
            onClick={()=>{if(window.confirm(t("建立语义索引需将该文档发送到你配置的原生服务，是否继续？")))
              void run(async()=>{
                await studioApi("/knowledge/"+doc.id+"/index","POST",{confirmExternalUpload:true});
                const data=await studioApi<{documents:KnowledgeDoc[]}>("/knowledge");setDocuments(data.documents);
              },"保存");}}>
            <Layers size={14}/>{t(doc.indexedAt?"已建立索引":"建立语义索引")}</button>
          <button className="stu-light-button" onClick={()=>{if(window.confirm(t("删除文档")+"?"))void run(async()=>{
            await studioApi("/knowledge/"+doc.id,"DELETE");setDocuments(old=>old.filter(x=>x.id!==doc.id));
          });}}><X size={15}/>{t("删除文档")}</button></div>)}
      </section>
    </>}

    {section==="research"&&<>
      <NativeNote provider={caps?.research} language={language}/>
      <section className="stu-card">
        <div className="stu-section-head"><h3><Globe2 size={18}/>{t("多来源检索与交叉验证")}</h3></div>
        <form className="stu-form" onSubmit={e=>void startResearch(e)}>
          <label>{t("研究主题")}<textarea required maxLength={900} rows={4} value={researchQuery}
            onChange={e=>setResearchQuery(e.target.value)} placeholder={t("研究主题")}/></label>
          <div className="stu-actions"><label>{t("研究深度")}
            <select value={researchDepth} onChange={e=>setResearchDepth(e.target.value)}>
              <option value="quick">{t("快速")}</option><option value="deep">{t("深入")}</option>
            </select></label><button className="stu-primary" disabled={loading} {...needs(caps?.research.configured,"CIRO_RESEARCH_SERVICE_URL / CIRO_RESEARCH_SERVICE_TOKEN")}>
              <Search size={16}/>{t("启动研究")}</button></div>
        </form>
        {!caps?.research.configured&&<p className="stu-small">{t("模型与搜索服务尚未接入。")}</p>}
      </section>
      <JobResult job={researchJob} refresh={()=>void poll("research")} language={language}/>
      {researchJob&&!researchJob.sources?.length&&<Banner>{t("没有可信来源，不能标记为已验证。")}</Banner>}
    </>}

    {section==="media"&&<>
      <NativeNote provider={caps?.media} language={language}/>
      <div className="stu-feature-grid">
        <section className="stu-card">
          <div className="stu-section-head"><h3><Camera size={18}/>{t("选择媒体文件")}</h3></div>
          <form className="stu-form" onSubmit={e=>void uploadMedia(e)}>
            <label className="stu-dropzone"><Camera size={32}/><strong>{mediaFile?.name||t("选择媒体文件")}</strong>
              <small>{mediaFile?humanBytes(mediaFile.size,language):t("支持图片 PNG/JPEG/WebP、音频 WAV/MP3/WebM/MP4、视频 MP4/WebM。")}</small>
              <input type="file" aria-label={t("选择媒体文件")}
                accept="image/png,image/jpeg,image/webp,audio/wav,audio/mpeg,audio/webm,audio/mp4,video/mp4,video/webm"
                onChange={e=>setMediaFile(e.target.files?.[0]||null)}/></label>
            <button className="stu-primary" disabled={!mediaFile||loading} {...needs(caps?.media.configured,"CIRO_MEDIA_SERVICE_URL / CIRO_MEDIA_SERVICE_TOKEN")}>
              <ArrowRight size={15}/>{t("上传并分析")}</button>
          </form>
        </section>
        <section className="stu-card"><h3><Mic size={18}/>{t("开始录音")}</h3>
          <div className="stu-record-circle"><AudioLines size={34}/><span>{recording?"REC":"VOICE"}</span></div>
          <button className={recording?"stu-danger":"stu-light-button"} onClick={()=>recording?stopRecording():void startRecording()}>
            {recording?<Pause size={16}/>:<Mic size={16}/>}
            {t(recording?"停止录音":"开始录音")}</button>
          <p className="stu-small">{t("媒体不会在未连接时上传到外部服务器。")}</p>
        </section>
      </div>
      <JobResult job={mediaJob} refresh={()=>void poll("media")} language={language}/>
    </>}

    {section==="compute"&&<>
      <Banner>{t("禁止使用模拟数值填充真实监控。")}</Banner>
      <div className="stu-section-head"><h3><Activity size={18}/>{t("GPU 实时遥测")}</h3>
        <button className="stu-light-button" onClick={()=>void refreshCompute()}><RefreshCcw size={15}/>{t("刷新状态")}</button></div>
      {telemetry.length===0?<Empty icon={Server} label={t("尚无签名硬件数据")} detail={t("原生服务")}/>:
        <div className="stu-metric-grid">
          {Object.entries(telemetry.at(-1)?.metrics||{}).map(([key,value])=><div className="stu-metric" key={key}>
            <span>{key}</span><strong>{labelledNumber(value,["cpuPct","gpuPct"].includes(key)?"%":"")}</strong>
            <small>{t("最后记录")}: {new Date(telemetry.at(-1)!.observedAt).toLocaleString()}</small></div>)}
        </div>}
      <section className="stu-card"><h3><Wallet size={18}/>{t("算力与成本")}</h3>
        <div className="stu-metric-grid">
          <div className="stu-metric"><span>CWU</span><strong>{commercial?.billing.hasUsage?labelledNumber(commercial.billing.units.CWU):"—"}</strong></div>
          <div className="stu-metric"><span>GWU</span><strong>{commercial?.billing.hasUsage?labelledNumber(commercial.billing.units.GWU):"—"}</strong></div>
          <div className="stu-metric"><span>{t("文档数量")} (Events)</span><strong>{commercial?.billing.eventsCount??"—"}</strong></div>
        </div>
        <button className="stu-link" onClick={()=>onNavigate("billing")}>{t("查看账单")} <ArrowRight size={14}/></button>
      </section>
    </>}

      <section className="stu-card stu-model-console">
        <div className="stu-section-head"><h3><BrainCircuit size={18}/>{t("模型与训练控制台")}</h3>
          <button type="button" className="stu-light-button" {...needs(caps?.compute.modelControl.configured,"CIRO_MODEL_CONTROL_URL / CIRO_MODEL_CONTROL_TOKEN")}
            onClick={()=>void run(async()=>setModelOverview(await studioApi<ModelOverview>("/model-control")))}>
            <RefreshCcw size={15}/>{t("从原生模型读取")}</button></div>
        <NativeNote provider={caps?.compute.modelControl} language={language}/>
        {!modelOverview?<p className="stu-small">{t("尚无来自 CIRO 的训练数据")}</p>:
          <div className="stu-model-grid">
            <div><h4>{t("模型版本")} · {modelOverview.models.length}</h4>
              {modelOverview.models.map((m,i)=><div className="stu-model-item" key={String(m.id||i)}>
                <strong>{String(m.id||"")}</strong><small>{String(m.version||"—")} · {String(m.architecture||"—")}</small>
                <code>{String(m.qualification||"未独立验收")}</code></div>)}</div>
            <div><h4>{t("训练任务")} · {modelOverview.trainingRuns.length}</h4>
              {modelOverview.trainingRuns.map((m,i)=><button className="stu-model-item stu-model-run" key={String(m.id||i)}
                onClick={()=>void run(async()=>{
                  setTrainingDetail(await studioApi<TrainingDetail>("/model-control/runs/"+encodeURIComponent(String(m.id))));
                })}>
                <strong>{String(m.id||"")}</strong><small>{String(m.status||"unknown")} · step {String(m.step??"—")}</small>
                <span>{t("查看训练曲线")} <ArrowRight size={13}/></span></button>)}</div>
            <div><h4>{t("数据集")} · {modelOverview.datasets.length}</h4>
              {modelOverview.datasets.map((m,i)=><div className="stu-model-item" key={String(m.id||i)}>
                <strong>{String(m.id||"")}</strong><small>{String(m.version||"—")} · {String(m.examples??"—")} items</small>
                <code>{String(m.sha256||"—").slice(0,24)}</code></div>)}</div>
            <div><h4>Checkpoint · {modelOverview.checkpoints.length}</h4>
              {modelOverview.checkpoints.map((m,i)=><div className="stu-model-item" key={String(m.id||i)}>
                <strong>{String(m.id||"")}</strong><small>step {String(m.step??"—")} · {String(m.modelId||"—")}</small>
                <code>{String(m.sha256||"—").slice(0,24)}</code></div>)}</div>
          </div>}
        {trainingDetail&&<div className="stu-training-graph">
          <h4>{t("训练损失曲线")} · {trainingDetail.id} <span>{trainingDetail.status}</span></h4>
          {trainingDetail.metrics.length>1?<svg viewBox="0 0 500 148" role="img" aria-label={t("训练损失曲线")}
            preserveAspectRatio="none">
            {(()=>{
              const rows=trainingDetail.metrics;
              const lo=Math.min(...rows.map(r=>r.loss)),hi=Math.max(...rows.map(r=>r.loss));
              const first=rows[0].step,last=rows[rows.length-1].step;
              const points=rows.map(r=>{
                const x=12+(r.step-first)/Math.max(1,last-first)*476;
                const y=130-(r.loss-lo)/Math.max(1e-8,hi-lo)*111;
                return x.toFixed(1)+","+y.toFixed(1);
              }).join(" ");
              return <polyline points={points} stroke="#36996a" strokeWidth={2.5}
                fill="none" strokeLinejoin="round" strokeLinecap="round"/>;
            })()}
          </svg>:<p className="stu-small">{t("训练数据不足以绘制曲线")}</p>}
          <div className="stu-training-foot"><span>{t("真实训练指标")} · {trainingDetail.metrics.length}</span>
            <span>SHA256: {trainingDetail.evidenceSha256||t("无独立证据")}</span></div>
        </div>}
      </section>

        {section==="library"&&<>
      <Banner>{t("本地会话可搜索、分支和恢复；打开跨设备同步后将随对话快照同步。")}</Banner>
      <label className="stu-search-bar"><Search size={17}/>
        <input aria-label={t("历史对话与版本")} value={libraryQuery} onChange={e=>setLibraryQuery(e.target.value)}
          placeholder={t("搜索知识库")}/></label>
      <div className="stu-library-layout"><aside className="stu-library-list">
        {libraryList.map(c=><button key={c.id} className={libraryActive===c.id?"stu-library-selected":""}
          onClick={()=>{setLibraryActive(c.id);setFolderDraft(c.folder||"");setBranchAt(c.messages.length);}}>
          <BookOpen size={17}/><span><strong>{c.title}</strong><small>{c.folder||"Inbox"} · {c.messages.length} {t("消息")}</small></span></button>)}
        {libraryList.length===0&&<Empty icon={History} label={t("没有历史对话")}/>}
      </aside><div className="stu-library-detail">
        {selectedChat?<><h3>{selectedChat.title}</h3>
          <p className="stu-small">{selectedChat.parentId&&t("分支来源")+": "+selectedChat.parentId}</p>
          <section className="stu-card"><h3><Folder size={17}/>{t("归档到文件夹")}</h3>
            <div className="stu-inline-form"><input aria-label={t("文件夹名称")} value={folderDraft} maxLength={60}
              placeholder={t("文件夹名称")} onChange={e=>setFolderDraft(e.target.value)}/>
              <button className="stu-primary" onClick={()=>onLibraryAction("folder",selectedChat.id,folderDraft)}>
                <Check size={15}/>{t("保存")}</button></div></section>
          <section className="stu-card"><h3><GitBranch size={17}/>{t("创建分支")}</h3>
            <div className="stu-inline-form"><select aria-label={t("消息")} value={branchAt} onChange={e=>setBranchAt(Number(e.target.value))}>
              {selectedChat.messages.map((m,i)=><option key={m.id} value={i+1}>{i+1}: {m.role} · {m.content.slice(0,48)}</option>)}
            </select><button className="stu-primary" disabled={!branchAt} onClick={()=>onLibraryAction("branch",selectedChat.id,branchAt)}>
              <GitBranch size={15}/>{t("创建分支")}</button></div></section>
          <section className="stu-card"><h3><History size={17}/>{t("创建会话检查点")}</h3>
            <button className="stu-primary" onClick={()=>onLibraryAction("checkpoint",selectedChat.id,"Snapshot "+new Date().toLocaleString())}>
              <Plus size={15}/>{t("创建检查点")}</button>
            {(selectedChat.checkpoints||[]).map(c=><div className="stu-check-row" key={c.id}>
              <div><strong>{c.label}</strong><small>{c.messages.length} {t("消息")} · {new Date(c.createdAt).toLocaleString()}</small></div>
              <button className="stu-light-button" onClick={()=>{if(window.confirm(t("恢复操作会替换该对话的当前消息。")))
                onLibraryAction("restore",selectedChat.id,c.id);}}><RotateCcw size={14}/>{t("恢复检查点")}</button></div>)}
          </section>
        </>:<Empty icon={BookOpen} label={t("选择一个模块开始")}/>}
      </div></div>
    </>}

    {section==="marketplace"&&<>
      <NativeNote provider={caps?.marketplace.remoteRegistry} language={language}/>
      <div className="stu-feature-grid">
        <button className="stu-feature-launch" onClick={()=>onNavigate("apps")}><Layers size={27}/>
          <strong>{t("查看官方应用")}</strong><ChevronRight size={17}/></button>
        <button className="stu-feature-launch" onClick={()=>onNavigate("skills")}><PackageCheck size={27}/>
          <strong>{t("查看技能中心")}</strong><ChevronRight size={17}/></button>
      </div>
      <section className="stu-card"><div className="stu-section-head"><h3><ShieldCheck size={18}/>{t("可信签名目录")}</h3>
        <button className="stu-light-button" onClick={()=>void run(async()=>{
          const data=await studioApi<{connected:boolean;items:MarketEntry[];selected:{id:string}[]}>("/marketplace");
          setRegistry(data);
        })}><RefreshCcw size={15}/>{t("刷新状态")}</button></div>
        {!registry?.connected&&<Empty icon={ShieldCheck} label={t("没有签名市场服务")}/>}
        {registry?.items.map(item=><div className="stu-market-row" key={item.id}>
          <div><strong>{item.title}</strong><p>{item.description}</p>
            <small>{item.kind} · v{item.version} · {item.sha256.slice(0,12)}</small>
            <div>{item.permissions.map(p=><code key={p}>{p}</code>)}</div></div>
          <button className="stu-light-button" onClick={()=>void run(async()=>{
            await studioApi("/marketplace/select","POST",{id:item.id,enabled:!registry.selected.some(s=>s.id===item.id)});
            const data=await studioApi<typeof registry>("/marketplace");setRegistry(data);
          })}>{t(registry.selected.some(s=>s.id===item.id)?"取消选择":"启用清单")}</button>
        </div>)}
        <p className="stu-small">{t("登记不等于执行；第三方代码只能由隔离原生运行器加载。")}</p>
      </section>
    </>}

    {section==="devices"&&<>
      <div className="stu-feature-grid">
        <section className="stu-card"><h3><TabletSmartphone size={18}/>{t("浏览器 PWA")}</h3>
          <Status ready={typeof navigator!=="undefined"&&"serviceWorker" in navigator} language={language}/>
          <p>{t("离线缓存只包含公开界面资源，不缓存私有聊天或密钥。")}</p>
          <button className="stu-primary" disabled={!installPrompt} onClick={()=>void run(async()=>{
            if(!installPrompt)throw new Error(t("当前浏览器不支持"));
            await installPrompt.prompt();setInstallPrompt(null);
          })}><Download size={16}/>{t("安装到设备")}</button>
        </section>
        <section className="stu-card"><h3><Cloud size={18}/>{t("通知权限")}</h3>
          <p>{noticePermission}</p>
          <button className="stu-light-button" disabled={typeof Notification==="undefined"} onClick={()=>void run(async()=>{
            const p=await Notification.requestPermission();setNoticePermission(p);
          })}><Check size={15}/>{t("请求通知权限")}</button>
        </section>
        <section className="stu-card"><h3><Server size={18}/>{t("原生桥接协议")}</h3>
          <Status ready={nativeShell?.available===true} language={language}/>
          <p>{nativeShell?.available
            ?nativeShell.platform+" · "+nativeShell.version+" · "+t("检测到桥接，但尚未独立认证")
            :t("尚未检测到签约的原生容器")}</p>
          <button className="stu-light-button" disabled={!nativeShell?.available||!nativeShell.grants.includes("notifications")}
            onClick={()=>void run(async()=>{
              if(!nativeShell)throw new Error(t("待连接"));
              await sendNativeNotification(nativeShell,"Ciro","Native shell notification test");
            },"已提交")}>{t("测试原生通知")}</button>
        </section>
        <section className="stu-card"><h3><Monitor size={18}/>{t("桌面客户端")}</h3>
          <Status ready={false} language={language}/>
          <p>{t("Windows / macOS 原生封装待构建")}</p></section>
        <section className="stu-card"><h3><TabletSmartphone size={18}/>{t("移动端")}</h3>
          <Status ready={false} language={language}/>
          <p>{t("Android / iOS 原生封装待构建")}</p>
          <button className="stu-link" onClick={()=>onNavigate("sync")}>{t("跨平台终端")} <ArrowRight size={15}/></button>
        </section>
      </div>
    </>}
  </div>;
}

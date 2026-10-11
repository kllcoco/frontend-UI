import {randomUUID,createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,statSync} from "node:fs";
import {join} from "node:path";

const MAX_DOCS=120,MAX_PROJECTS=24,MAX_FILES=100,MAX_CHECKPOINTS=30,MAX_METRICS=400;
const MAX_DOC_TEXT=60000,MAX_FILE_TEXT=100000;
const now=()=>new Date().toISOString();
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const validText=(value,max,name)=>{
  if(typeof value!=="string"||!value.trim()||value.length>max)throw fail("Invalid "+name);
  return value.trim();
};
export function safeStudioPath(value){
  if(typeof value!=="string"||value.length<1||value.length>180||
    value.startsWith("/")||value.includes("\\")||value.includes("..")||
    !/^[a-zA-Z0-9/_\-.]+$/.test(value)||
    value.split("/").some(part=>!part||part.startsWith("."))||
    /(?:^|\/)(?:node_modules|secrets?|\.git|\.env)(?:\/|$)/i.test(value))
    throw fail("Invalid workspace-relative file path");
  return value;
}
function fresh(){
  return {version:1,documents:[],projects:[],telemetry:[],audit:[]};
}
export function createStudioStore(directory){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const filepath=join(directory,"studio-state.json");
  let state=fresh();
  if(existsSync(filepath)){
    const stat=statSync(filepath);
    if(process.platform!=="win32"&&(stat.mode&0o077)!==0)throw fail("Unsafe Studio state file permissions",500);
    const decoded=JSON.parse(readFileSync(filepath,"utf8"));
    if(decoded?.version!==1||!Array.isArray(decoded.documents)||!Array.isArray(decoded.projects)||
      !Array.isArray(decoded.telemetry)||!Array.isArray(decoded.audit))
      throw fail("Unknown Studio state schema; migration required",500);
    state=decoded;
  }
  function persist(){
    const tmp=filepath+"."+process.pid+"."+randomUUID()+".tmp";
    writeFileSync(tmp,JSON.stringify(state),{flag:"wx",mode:0o600});
    renameSync(tmp,filepath);
  }
  function change(name,callback){
    callback(state);
    state.audit.unshift({id:randomUUID(),at:now(),event:name});
    state.audit=state.audit.slice(0,100);
    persist();
    return state;
  }
  function getProject(id){
    const p=state.projects.find(x=>x.id===id);
    if(!p)throw fail("Project not found",404);
    return p;
  }
  function createProject(body){
    const name=validText(body?.name,90,"project name");
    if(state.projects.length>=MAX_PROJECTS)throw fail("Project limit reached",409);
    const project={id:randomUUID(),name,revision:0,files:[],checkpoints:[],createdAt:now(),updatedAt:now()};
    change("project.created",s=>s.projects.push(project));
    return project;
  }
  function editFile(id,body){
    const path=safeStudioPath(body?.path),content=body?.content;
    if(typeof content!=="string"||content.length>MAX_FILE_TEXT)throw fail("Invalid file content");
    if(!Number.isSafeInteger(body?.baseRevision)||body.baseRevision<0)throw fail("baseRevision required");
    const project=getProject(id);
    if(project.revision!==body.baseRevision)
      throw fail("Project revision conflict; refresh before saving",409);
    const old=project.files.find(x=>x.path===path);
    if(!old&&project.files.length>=MAX_FILES)throw fail("Project file limit reached",409);
    if(Buffer.byteLength(content)>200000)throw fail("File exceeds byte limit");
    const totalBytes=project.files.reduce((sum,x)=>sum+(x.path===path?0:Buffer.byteLength(x.content)),0)+Buffer.byteLength(content);
    if(totalBytes>2000000)throw fail("Project is over the 2 MB draft storage limit",409);
    change("project.file.saved",()=>{
      if(old){old.content=content;old.version++;old.updatedAt=now();}
      else project.files.push({path,content,version:1,updatedAt:now()});
      project.revision++;project.updatedAt=now();
    });
    return project;
  }
  function checkpoint(id,body){
    const project=getProject(id),label=validText(body?.label||"Snapshot",90,"checkpoint label");
    if(project.checkpoints.length>=MAX_CHECKPOINTS)throw fail("Project checkpoint limit reached",409);
    const manifest=project.files.map(({path,content,version})=>({path,content,version}));
    const digest=createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    const entry={id:randomUUID(),label,createdAt:now(),revision:project.revision,digest,files:manifest};
    change("project.checkpoint.created",()=>{
      project.checkpoints.unshift(entry);project.updatedAt=now();
    });
    return {id:entry.id,label,digest,revision:entry.revision,createdAt:entry.createdAt};
  }
  function restoreCheckpoint(id,body){
    const project=getProject(id);
    if(!Number.isSafeInteger(body?.baseRevision)||project.revision!==body.baseRevision)
      throw fail("Project revision conflict; refresh before restore",409);
    const target=project.checkpoints.find(x=>x.id===body.checkpointId);
    if(!target)throw fail("Checkpoint not found",404);
    change("project.checkpoint.restored",()=>{
      project.files=target.files.map(x=>({...x,updatedAt:now()}));
      project.revision++;project.updatedAt=now();
    });
    return project;
  }
  function publicProject(project,{withContent=false}={}){
    return {id:project.id,name:project.name,revision:project.revision,
      updatedAt:project.updatedAt,createdAt:project.createdAt,
      files:project.files.map(f=>({...f,...(withContent?{}:{content:undefined})})),
      checkpoints:project.checkpoints.map(({id,label,digest,createdAt,revision})=>({
        id,label,digest,createdAt,revision}))};
  }
  function addDocument(body){
    const title=validText(body?.title,130,"document title");
    const text=validText(body?.text,MAX_DOC_TEXT,"document text");
    const source=typeof body.source==="string"&&body.source.length<=160?body.source:"local-upload";
    if(state.documents.length>=MAX_DOCS)throw fail("Knowledge library limit reached",409);
    const bytes=Buffer.byteLength(text);
    if(bytes>125000)throw fail("Document exceeds 125 KB",413);
    const hash=createHash("sha256").update(text).digest("hex");
    const existing=state.documents.find(x=>x.sha256===hash);
    if(existing)return {...existing,duplicate:true};
    const entry={id:randomUUID(),title,text,source,bytes,sha256:hash,createdAt:now()};
    change("knowledge.imported",s=>s.documents.push(entry));
    return {...entry,text:undefined,duplicate:false};
  }
  function searchDocuments(query,limit=8){
    const term=validText(query,120,"search query").toLowerCase();
    const tokens=term.split(/\s+/).filter(Boolean);
    const matches=[];
    for(const d of state.documents){
      const lower=d.text.toLowerCase(),head=d.title.toLowerCase();
      const matched=tokens.every(t=>head.includes(t)||lower.includes(t));
      if(!matched)continue;
      const first=Math.max(0,lower.indexOf(tokens[0]));
      const excerpt=d.text.slice(Math.max(0,first-65),Math.min(d.text.length,first+230));
      const line=1+d.text.slice(0,first).split("\n").length-1;
      const score=tokens.reduce((n,t)=>n+(head.includes(t)?5:0)+(lower.includes(t)?1:0),0);
      matches.push({id:d.id,title:d.title,source:d.source,sha256:d.sha256,
        citation:"knowledge:"+d.id+":L"+line,excerpt,line,score});
    }
    return matches.sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,Math.max(1,Math.min(20,limit)));
  }
  function recordTelemetry(body){
    if(!body||typeof body!=="object"||Array.isArray(body))throw fail("Invalid telemetry event");
    const {eventId,observedAt,source,metrics}=body;
    if(typeof eventId!=="string"||!/^[A-Za-z0-9_:-]{8,100}$/.test(eventId))throw fail("Invalid telemetry event ID");
    if(typeof observedAt!=="string"||!Number.isFinite(Date.parse(observedAt))||
      Date.parse(observedAt)>Date.now()+300000||Date.parse(observedAt)<Date.now()-86400000)
      throw fail("Telemetry timestamp outside 24-hour window");
    if(!["inference","training","agent","system"].includes(source))throw fail("Invalid telemetry source");
    if(!metrics||typeof metrics!=="object"||Array.isArray(metrics))throw fail("Invalid telemetry metrics");
    const allowed=["cpuPct","gpuPct","gpuMemoryMb","gpuMemoryTotalMb","ramMb","ramTotalMb","latencyMs","tokensPerSecond","queueDepth","runningJobs","powerWatts"];
    const measurements={};
    for(const [k,v] of Object.entries(metrics)){
      if(!allowed.includes(k)||typeof v!=="number"||!Number.isFinite(v)||v<0||v>1000000)
        throw fail("Unsupported telemetry metric "+k);
      if((k==="cpuPct"||k==="gpuPct")&&v>100)throw fail("Invalid percentage");
      measurements[k]=v;
    }
    if(!Object.keys(measurements).length)throw fail("Empty telemetry metrics");
    const old=state.telemetry.find(x=>x.eventId===eventId);
    if(old){
      if(JSON.stringify(old.metrics)!==JSON.stringify(measurements)||old.source!==source||
        old.observedAt!==new Date(observedAt).toISOString())throw fail("Telemetry event ID conflict",409);
      return {...old,duplicate:true};
    }
    const entry={eventId,observedAt:new Date(observedAt).toISOString(),receivedAt:now(),source,metrics:measurements};
    change("telemetry.recorded",s=>{s.telemetry.push(entry);s.telemetry=s.telemetry.slice(-MAX_METRICS);});
    return {...entry,duplicate:false};
  }
  return {
    get:()=>state,change,getProject,createProject,editFile,checkpoint,restoreCheckpoint,
    publicProject,addDocument,searchDocuments,recordTelemetry,limits:{
      maxFiles:MAX_FILES,maxDocuments:MAX_DOCS,maxDocumentText:MAX_DOC_TEXT,maxProjectText:MAX_FILE_TEXT
    },newId:randomUUID
  };
}

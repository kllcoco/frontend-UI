import express from "express";
import {createHash,verify as verifySignature} from "node:crypto";
import {join} from "node:path";
import {createStudioStore,safeStudioPath} from "./studio-store.mjs";
import {createWorkbenchStore} from "./workbench-store.mjs";
import {decision} from "./agent-policy.mjs";
import {verifySignedReceipt,assertBudgetAdmission} from "./commercial-billing.mjs";

const problem=(reason,statusCode=400)=>Object.assign(new Error(reason),{statusCode});
const bounded=(value,max,name)=>{
  if(typeof value!=="string"||!value.trim()||value.length>max)throw problem("Invalid "+name);
  return value.trim();
};
const knownServices={
  think:["CIRO_REASONING_URL","CIRO_REASONING_TOKEN"],
  code:["CIRO_IDE_RUNNER_URL","CIRO_IDE_RUNNER_TOKEN"],
  research:["CIRO_RESEARCH_SERVICE_URL","CIRO_RESEARCH_SERVICE_TOKEN"],
  media:["CIRO_MEDIA_SERVICE_URL","CIRO_MEDIA_SERVICE_TOKEN"],
  index:["CIRO_KNOWLEDGE_INDEX_URL","CIRO_KNOWLEDGE_INDEX_TOKEN"],
  market:["CIRO_MARKETPLACE_URL","CIRO_MARKETPLACE_TOKEN"],
  model:["CIRO_MODEL_CONTROL_URL","CIRO_MODEL_CONTROL_TOKEN"]
};
function trustedEndpoint(value){
  if(typeof value!=="string"||value.length>350)throw problem("Invalid adapter endpoint",503);
  let parsed;
  try{parsed=new URL(value);}catch{throw problem("Invalid adapter URL",503);}
  const host=parsed.hostname.toLowerCase();
  const local=["127.0.0.1","localhost","[::1]"].includes(host);
  if(!((parsed.protocol==="https:")||(parsed.protocol==="http:"&&local))||
    parsed.username||parsed.password||parsed.search||parsed.hash)
    throw problem("Adapter URL must be HTTPS or local loopback HTTP",503);
  return parsed.href.replace(/\/+$/,"");
}
export function serviceConfigured(env,service){
  const keys=knownServices[service];
  return Boolean(keys && env[keys[0]] && env[keys[1]]);
}
export function studioCapabilities(env=process.env){
  const providers=Object.fromEntries(Object.keys(knownServices).map(k=>[k,{
    configured:serviceConfigured(env,k),verified:false,
    status:serviceConfigured(env,k)?"configured_unverified":"not_connected"
  }]));
  const modes=new Set(["fast",...(env.CIRO_CHAT_REASONING_MODES||"").split(",").map(x=>x.trim()).filter(x=>["deep","continuous"].includes(x))]);
  return {
    version:"ciro-studio.v1",mode:"chat+workbench",languageDefault:"zh-CN",
    thinking:{modes:[...modes],provider:providers.think,deepChatSupported:modes.has("deep")},
    workbench:{status:"control_plane_ready_native_adapter_required"},
    ide:{draftEditor:true,projectCheckpoint:true,sandboxExecution:providers.code},
    knowledge:{localTextIndex:true,embedding:providers.index},
    research:providers.research,media:providers.media,
    compute:{signedTelemetry:true,status:"requires_signed_native_runtime_receipts",modelControl:providers.model},
    conversations:{folderAndBranch:"local_browser",checkpoint:"local_browser"},
    marketplace:{builtInDirectory:true,remoteRegistry:providers.market},
    devices:{pwaShell:true,nativeApps:"not_packaged",accountSync:"v0.6_optional"}
  };
}
export async function invokeStudio(env,service,path,payload,{fetchFn=fetch,method="POST",timeoutMs=15000}={}){
  if(!Object.hasOwn(knownServices,service))throw problem("Unsupported adapter",400);
  if(!serviceConfigured(env,service))throw problem(service+" native adapter not connected",503);
  const [baseKey,tokenKey]=knownServices[service];
  const base=trustedEndpoint(env[baseKey]);
  if(!/^\/v1\/[A-Za-z0-9/_:.-]+$/.test(path)||path.includes("..")||path.includes("//"))throw problem("Adapter path not allowed");
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const result=await fetchFn(base+path,{
      method,redirect:"error",signal:controller.signal,
      headers:{"Authorization":"Bearer "+env[tokenKey],"Accept":"application/json",
        ...(method==="POST"?{"Content-Type":"application/json"}:{})},
      ...(method==="POST"?{body:JSON.stringify(payload)}:{})
    });
    if(!result.ok)throw problem(service+" adapter rejected the request (HTTP "+result.status+")",502);
    const length=Number(result.headers.get("content-length")||"0");
    if(length>650000)throw problem("Adapter response too large",502);
    const raw=await result.text();
    if(raw.length>650000)throw problem("Adapter response too large",502);
    let data;try{data=JSON.parse(raw);}catch{throw problem("Adapter returned invalid JSON",502);}
    if(!data||typeof data!=="object"||Array.isArray(data))throw problem("Adapter response schema invalid",502);
    return data;
  }catch(error){
    if(controller.signal.aborted)throw problem(service+" adapter timed out",504);
    if(error.statusCode)throw error;
    throw problem("Unable to reach "+service+" adapter",502);
  }finally{clearTimeout(timer);}
}
function urlString(value){
  if(typeof value!=="string"||value.length>1500)return null;
  try{const u=new URL(value);return u.protocol==="https:"||u.protocol==="http:"?u.href:null;}catch{return null;}
}
const REMOTE_KINDS=new Set(["app","skill"]);
function manifestPayload(item){
  return JSON.stringify({id:item.id,kind:item.kind,version:item.version,
    sha256:item.sha256,permissions:item.permissions});
}
export function verifyMarketplaceManifest(item,publicKey){
  if(!item||typeof item!=="object"||!REMOTE_KINDS.has(item.kind)||
    typeof item.id!=="string"||!/^[a-z0-9][a-z0-9_.-]{2,100}$/.test(item.id)||
    typeof item.version!=="string"||!/^\d+\.\d+\.\d+$/.test(item.version)||
    typeof item.sha256!=="string"||!/^[a-f0-9]{64}$/.test(item.sha256)||
    !Array.isArray(item.permissions)||item.permissions.length>15||
    item.permissions.some(x=>typeof x!=="string"||!/^[a-z.:-]{1,70}$/.test(x))||
    typeof item.signature!=="string"||item.signature.length>500||!publicKey)return false;
  try{return verifySignature(null,Buffer.from(manifestPayload(item)),publicKey,Buffer.from(item.signature,"base64"));}
  catch{return false;}
}
export function createStudioRouter({env=process.env,dir,fetchFn=fetch}={}){
  const folder=dir||env.CIRO_WORKSPACE_DATA_DIR||join(process.cwd(),".ciro-runtime");
  const store=createStudioStore(folder);
  const router=express.Router();
  const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(error=>
    res.status(error.statusCode||400).json({error:error.message||"Invalid Studio request"}));
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  router.get("/capabilities",(_req,res)=>res.json(studioCapabilities(env)));
  router.get("/projects",(_req,res)=>res.json({projects:store.get().projects.map(x=>store.publicProject(x))}));
  router.post("/projects",wrap((req,res)=>res.status(201).json({project:store.publicProject(store.createProject(req.body))})));
  router.get("/projects/:id",wrap((req,res)=>
    res.json({project:store.publicProject(store.getProject(req.params.id),{withContent:true})})));
  router.put("/projects/:id/file",wrap((req,res)=>{
    const project=store.editFile(req.params.id,req.body);
    res.json({project:store.publicProject(project,{withContent:true})});
  }));
  router.post("/projects/:id/checkpoints",wrap((req,res)=>
    res.status(201).json({checkpoint:store.checkpoint(req.params.id,req.body)})));
  router.post("/projects/:id/restore",wrap((req,res)=>{
    const project=store.restoreCheckpoint(req.params.id,req.body);
    res.json({project:store.publicProject(project,{withContent:true})});
  }));
  router.post("/projects/:id/run",wrap(async(req,res)=>{
    const project=store.getProject(req.params.id);
    const task=bounded(req.body?.task,20,"runner task");
    if(!["test","build","lint"].includes(task))throw problem("Only approved sandbox task types are allowed");
    // No local host terminal: all execution is delegated to an isolated native provider.
    // A user must explicitly grant task.run in scoped Workbench policy.
    const policy=createWorkbenchStore(folder).get().policy;
    if(decision(policy,"task.run",{repo:policy.repo}).result!=="allow")
      throw problem("Sandbox execution requires an approved Workbench task.run policy",403);
    assertBudgetAdmission(env,createWorkbenchStore(folder).get());
    const data=await invokeStudio(env,"code","/v1/ide/jobs",{
      contract:"ciro-ide-run.v1",task,projectId:project.id,projectRevision:project.revision,
      scope:{repo:policy.repo,permission:"task.run"},
      files:project.files.map(f=>({path:f.path,content:f.content,sha256:createHash("sha256").update(f.content).digest("hex")}))
    },{fetchFn,timeoutMs:20000});
    if(typeof data.jobId!=="string"||!/^[A-Za-z0-9_.-]{5,120}$/.test(data.jobId))
      throw problem("Native IDE runner returned invalid jobId",502);
    res.status(202).json({jobId:data.jobId,status:"submitted_to_native_runner",verified:false});
  }));
  router.get("/projects/:id/jobs/:jobId",wrap(async(req,res)=>{
    store.getProject(req.params.id);
    if(!/^[A-Za-z0-9_.-]{5,120}$/.test(req.params.jobId))throw problem("Invalid runner jobId");
    const data=await invokeStudio(env,"code","/v1/ide/jobs/"+req.params.jobId,null,{fetchFn,method:"GET"});
    res.json({jobId:req.params.jobId,status:typeof data.status==="string"?data.status:"unknown",
      summary:typeof data.summary==="string"?data.summary.slice(0,4000):null,
      evidence:Array.isArray(data.evidence)?data.evidence.slice(0,20):[],verified:false});
  }));
  router.get("/knowledge",(_req,res)=>res.json({
    documents:store.get().documents.map(({text,...rest})=>rest),limits:store.limits
  }));
  router.get("/knowledge/search",wrap((req,res)=>{
    if(typeof req.query.q!=="string")throw problem("Search string required");
    res.json({query:req.query.q,results:store.searchDocuments(req.query.q)});
  }));
  router.post("/knowledge/:id/index",wrap(async(req,res)=>{
    const entry=store.get().documents.find(x=>x.id===req.params.id);
    if(!entry)throw problem("Knowledge source not found",404);
    if(req.body?.confirmExternalUpload!==true)throw problem("External indexing requires explicit consent",403);
    const data=await invokeStudio(env,"index","/v1/knowledge/documents",{
      contract:"ciro-knowledge-index.v1",documentId:entry.id,title:entry.title,
      source:entry.source,sha256:entry.sha256,content:entry.text
    },{fetchFn,timeoutMs:20000});
    if(data.accepted!==true||data.sha256!==entry.sha256||typeof data.indexId!=="string"||
      !/^[a-zA-Z0-9_.:-]{4,120}$/.test(data.indexId))
      throw problem("Index service did not confirm exact document digest",502);
    store.change("knowledge.indexed",()=>{
      entry.indexedAt=new Date().toISOString();entry.indexId=data.indexId;
    });
    res.json({indexed:true,documentId:entry.id,sha256:entry.sha256,indexId:data.indexId,
      verified:false});
  }));
  router.post("/knowledge/semantic",wrap(async(req,res)=>{
    const query=bounded(req.body?.query,120,"semantic search query");
    const indexed=store.get().documents.filter(x=>x.indexedAt&&x.indexId);
    if(!indexed.length)throw problem("Index at least one document before semantic search",409);
    const data=await invokeStudio(env,"index","/v1/knowledge/search",{
      contract:"ciro-knowledge-index.v1",query,maxResults:12,
      corpus:indexed.map(x=>({documentId:x.id,indexId:x.indexId,sha256:x.sha256}))
    },{fetchFn});
    const matches=(Array.isArray(data.matches)?data.matches:[]).slice(0,20).flatMap(hit=>{
      const doc=indexed.find(x=>x.id===hit?.documentId);
      if(!doc||!Number.isSafeInteger(hit?.line)||hit.line<1||hit.line>doc.text.split("\n").length||
        typeof hit?.score!=="number"||!Number.isFinite(hit.score)||hit.score<0||hit.score>1)return [];
      const lines=doc.text.split("\n");
      const excerpt=lines.slice(Math.max(0,hit.line-2),Math.min(lines.length,hit.line+2)).join("\n").slice(0,600);
      return [{id:doc.id,title:doc.title,source:doc.source,sha256:doc.sha256,
        citation:"knowledge:"+doc.id+":L"+hit.line,excerpt,line:hit.line,score:hit.score}];
    });
    res.json({query,results:matches,source:"indexed_adapter_hits_rebound_to_local_sha256"});
  }));
  router.get("/knowledge/:id",wrap((req,res)=>{
    const entry=store.get().documents.find(x=>x.id===req.params.id);
    if(!entry)throw problem("Knowledge source not found",404);
    res.json({document:entry});
  }));
  router.post("/knowledge/import",wrap((req,res)=>
    res.status(201).json({document:store.addDocument(req.body)})));
  router.delete("/knowledge/:id",wrap((req,res)=>{
    if(!store.get().documents.some(x=>x.id===req.params.id))throw problem("Knowledge source not found",404);
    store.change("knowledge.deleted",s=>{s.documents=s.documents.filter(x=>x.id!==req.params.id);});
    res.json({deleted:true});
  }));
  router.post("/research",wrap(async(req,res)=>{
    const query=bounded(req.body?.query,900,"research query");
    const depth=["quick","deep"].includes(req.body?.depth)?req.body.depth:"quick";
    assertBudgetAdmission(env,createWorkbenchStore(folder).get());
    const data=await invokeStudio(env,"research","/v1/research/jobs",{
      contract:"ciro-research.v1",query,depth,maxSources:depth==="deep"?12:6,
      evidenceRequired:true,mode:"user_initiated"
    },{fetchFn,timeoutMs:20000});
    if(typeof data.jobId!=="string"||!/^[a-zA-Z0-9_.:-]{5,120}$/.test(data.jobId))
      throw problem("Research adapter must return a jobId",502);
    res.status(202).json({jobId:data.jobId,status:"submitted",verified:false});
  }));
  router.get("/research/:id",wrap(async(req,res)=>{
    if(!/^[a-zA-Z0-9_.:-]{5,120}$/.test(req.params.id))throw problem("Invalid research jobId");
    const data=await invokeStudio(env,"research","/v1/research/jobs/"+req.params.id,null,{fetchFn,method:"GET"});
    const sources=(Array.isArray(data.sources)?data.sources:[]).slice(0,20).map(x=>({
      title:typeof x.title==="string"?x.title.slice(0,180):"",
      url:urlString(x.url),excerpt:typeof x.excerpt==="string"?x.excerpt.slice(0,750):""
    })).filter(x=>x.url&&x.title);
    res.json({jobId:req.params.id,status:typeof data.status==="string"?data.status:"unknown",
      summary:typeof data.summary==="string"?data.summary.slice(0,10000):null,
      sources,verified:sources.length>0&&data.status==="completed"});
  }));
  router.post("/think/jobs",wrap(async(req,res)=>{
    const objective=bounded(req.body?.objective,5000,"objective");
    const maxSeconds=req.body?.maxSeconds;
    const priority=req.body?.priority;
    if(!Number.isSafeInteger(maxSeconds)||maxSeconds<30||maxSeconds>3600)throw problem("Thinking time must be 30-3600 seconds");
    if(![1,2,5].includes(priority))throw problem("Thinking priority must be 1, 2 or 5");
    assertBudgetAdmission(env,createWorkbenchStore(folder).get());
    const data=await invokeStudio(env,"think","/v1/reasoning/jobs",{
      contract:"ciro-reasoning.v1",objective,maxSeconds,priority,
      allowUnboundedSpending:false,requireEvidence:true
    },{fetchFn});
    if(typeof data.jobId!=="string"||!/^[a-zA-Z0-9_.:-]{5,120}$/.test(data.jobId))
      throw problem("Reasoning adapter must return jobId",502);
    res.status(202).json({jobId:data.jobId,status:"submitted",verified:false});
  }));
  router.get("/think/jobs/:id",wrap(async(req,res)=>{
    if(!/^[a-zA-Z0-9_.:-]{5,120}$/.test(req.params.id))throw problem("Invalid reasoning jobId");
    const data=await invokeStudio(env,"think","/v1/reasoning/jobs/"+req.params.id,null,{fetchFn,method:"GET"});
    res.json({jobId:req.params.id,status:typeof data.status==="string"?data.status:"unknown",
      summary:typeof data.summary==="string"?data.summary.slice(0,12000):null,
      evidence:Array.isArray(data.evidence)?data.evidence.slice(0,12):[],verified:false});
  }));
  router.post("/think/jobs/:id/actions",wrap(async(req,res)=>{
    if(!/^[a-zA-Z0-9_.:-]{5,120}$/.test(req.params.id))throw problem("Invalid reasoning jobId");
    const action=req.body?.action;
    if(!["pause","resume","cancel"].includes(action))throw problem("Unsupported reasoning job action");
    const data=await invokeStudio(env,"think","/v1/reasoning/jobs/"+req.params.id+"/actions",{
      contract:"ciro-reasoning.v1",action
    },{fetchFn});
    if(typeof data.status!=="string"||data.status.length>90)
      throw problem("Reasoning adapter did not acknowledge state",502);
    res.json({jobId:req.params.id,status:data.status,confirmedByAdapter:true});
  }));
  router.post("/media/jobs",wrap(async(req,res)=>{
    const filename=bounded(req.body?.filename,150,"media filename");
    const mime=bounded(req.body?.mime,90,"media MIME type");
    const bytes=req.body?.bytes;
    const kind=req.body?.kind;
    const types={
      image:["image/png","image/jpeg","image/webp"],
      audio:["audio/wav","audio/mpeg","audio/webm","audio/mp4"],
      video:["video/mp4","video/webm"]
    };
    if(!types[kind]?.includes(mime)||!Number.isSafeInteger(bytes)||bytes<1||bytes>150*1024*1024)
      throw problem("Unsupported or oversized media");
    assertBudgetAdmission(env,createWorkbenchStore(folder).get());
    const data=await invokeStudio(env,"media","/v1/media/jobs",{
      contract:"ciro-media.v1",filename,mime,bytes,kind,task:"analyze",
      maxUploadBytes:150*1024*1024
    },{fetchFn});
    if(typeof data.jobId!=="string"||!/^[a-zA-Z0-9_.:-]{5,120}$/.test(data.jobId))
      throw problem("Media adapter returned invalid jobId",502);
    const uploaded=urlString(data.uploadUrl);
    const allowed=(env.CIRO_MEDIA_UPLOAD_ORIGINS||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!uploaded||!uploaded.startsWith("https://")||!allowed.includes(new URL(uploaded).origin))
      throw problem("Media adapter upload destination not on trusted origin list",502);
    // Do not forward opaque provider credentials back to the browser.
    const headers={};
    for(const [k,v] of Object.entries(data.uploadHeaders||{})){
      if(/^(content-type|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+)$/i.test(k)&&typeof v==="string"&&v.length<2000)
        headers[k]=v;
    }
    res.status(201).json({jobId:data.jobId,uploadUrl:uploaded,
      uploadMethod:"PUT",uploadHeaders:headers,status:"awaiting_upload",verified:false});
  }));
  router.post("/media/jobs/:id/complete",wrap(async(req,res)=>{
    if(!/^[a-zA-Z0-9_.:-]{5,120}$/.test(req.params.id))throw problem("Invalid media job ID");
    const data=await invokeStudio(env,"media","/v1/media/jobs/"+req.params.id+"/complete",{
      contract:"ciro-media.v1",confirmUploaded:true
    },{fetchFn});
    res.json({jobId:req.params.id,status:typeof data.status==="string"?data.status:"submitted"});
  }));
  router.get("/media/jobs/:id",wrap(async(req,res)=>{
    if(!/^[a-zA-Z0-9_.:-]{5,120}$/.test(req.params.id))throw problem("Invalid media job ID");
    const data=await invokeStudio(env,"media","/v1/media/jobs/"+req.params.id,null,{fetchFn,method:"GET"});
    res.json({jobId:req.params.id,status:typeof data.status==="string"?data.status:"unknown",
      summary:typeof data.summary==="string"?data.summary.slice(0,12000):null,
      evidence:Array.isArray(data.evidence)?data.evidence.slice(0,12):[]});
  }));
  router.get("/model-control",wrap(async(_req,res)=>{
    const data=await invokeStudio(env,"model","/v1/model-control/overview",null,{fetchFn,method:"GET"});
    const pick=(x,fields)=>Object.fromEntries(fields.flatMap(k=>{
      const v=x?.[k];
      return (typeof v==="string"&&v.length<=2000)||(typeof v==="number"&&Number.isFinite(v))?
        [[k,v]]:[];
    }));
    res.json({
      source:"configured_native_model_control_unverified",
      models:(Array.isArray(data.models)?data.models:[]).slice(0,60)
        .map(x=>pick(x,["id","version","architecture","parameters","qualification","checkpointSha256"])),
      trainingRuns:(Array.isArray(data.trainingRuns)?data.trainingRuns:[]).slice(0,70)
        .map(x=>pick(x,["id","status","step","loss","datasetId","latestCheckpointSha256","startedAt"])),
      datasets:(Array.isArray(data.datasets)?data.datasets:[]).slice(0,70)
        .map(x=>pick(x,["id","version","examples","sha256","license"])),
      checkpoints:(Array.isArray(data.checkpoints)?data.checkpoints:[]).slice(0,70)
        .map(x=>pick(x,["id","modelId","step","sha256","sizeBytes"]))
    });
  }));
  router.get("/model-control/runs/:id",wrap(async(req,res)=>{
    if(!/^[A-Za-z0-9_.:-]{3,120}$/.test(req.params.id))throw problem("Invalid native training run ID");
    const data=await invokeStudio(env,"model","/v1/model-control/runs/"+req.params.id,null,{fetchFn,method:"GET"});
    const metrics=(Array.isArray(data.metrics)?data.metrics:[]).slice(-300).flatMap(item=>{
      if(!Number.isSafeInteger(item?.step)||item.step<0||
        typeof item.loss!=="number"||!Number.isFinite(item.loss)||item.loss<0)return [];
      return [{step:item.step,loss:item.loss,
        ...(typeof item.validationLoss==="number"&&Number.isFinite(item.validationLoss)?{validationLoss:item.validationLoss}:{})}];
    });
    res.json({id:req.params.id,source:"native_unverified",
      status:typeof data.status==="string"?data.status.slice(0,70):"unknown",metrics,
      evidenceSha256:typeof data.evidenceSha256==="string"&&/^[a-f0-9]{64}$/.test(data.evidenceSha256)?data.evidenceSha256:null});
  }));
  router.get("/compute",(_req,res)=>{
    const events=store.get().telemetry.slice(-100);
    res.json({source:"signed_native_runtime_receipts",verifiedMeasurements:events.length>0,
      latest:events.at(-1)||null,events,status:events.length?"receipts_available":"awaiting_native_telemetry"});
  });
  router.post("/compute/ingest",wrap((req,res)=>{
    verifySignedReceipt(req,env);
    const entry=store.recordTelemetry(req.body);
    res.status(entry.duplicate?200:201).json({accepted:true,duplicate:entry.duplicate,eventId:entry.eventId});
  }));
  async function marketCatalog(){
    if(!serviceConfigured(env,"market"))return {connected:false,items:[],selected:store.get().marketplace||[]};
    const key=env.CIRO_MARKETPLACE_PUBLIC_KEY;
    if(!key)throw problem("Marketplace public verification key not configured",503);
    const data=await invokeStudio(env,"market","/v1/marketplace/catalog",null,{fetchFn,method:"GET"});
    const items=(Array.isArray(data.items)?data.items:[]).slice(0,60)
      .filter(x=>verifyMarketplaceManifest(x,key))
      .map(x=>({id:x.id,kind:x.kind,version:x.version,sha256:x.sha256,
        title:typeof x.title==="string"?x.title.slice(0,100):x.id,
        description:typeof x.description==="string"?x.description.slice(0,500):"",
        permissions:x.permissions,signature:x.signature,status:"signature_verified_not_executed"}));
    return {connected:true,items,selected:store.get().marketplace||[]};
  }
  router.get("/marketplace",wrap(async(_req,res)=>res.json(await marketCatalog())));
  router.post("/marketplace/select",wrap(async(req,res)=>{
    const id=bounded(req.body?.id,100,"manifest id");
    const enabled=req.body?.enabled;
    if(typeof enabled!=="boolean")throw problem("Explicit enabled boolean required");
    const registry=await marketCatalog();
    const found=registry.items.find(x=>x.id===id);
    if(!found)throw problem("Signed registry entry not found",404);
    store.change("marketplace.selection.updated",s=>{
      s.marketplace=Array.isArray(s.marketplace)?s.marketplace:[];
      s.marketplace=s.marketplace.filter(x=>x.id!==found.id);
      if(enabled)s.marketplace.push({id:found.id,kind:found.kind,version:found.version,sha256:found.sha256});
    });
    res.json({id:found.id,selected:enabled,executable:false,
      status:"selected_manifest_only_native_sandbox_required"});
  }));
  return {router,store,capabilities:()=>studioCapabilities(env)};
}

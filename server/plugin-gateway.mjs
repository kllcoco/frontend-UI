import express from "express";
import {createHash,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import {join} from "node:path";
import {createPluginConnectionStore} from "./plugin-connection-store.mjs";
import {createPluginInstallStore} from "./plugin-install-store.mjs";
import {createWorkbenchStore} from "./workbench-store.mjs";
import {decision,validateRepo,safeFilePath,safeBranch} from "./agent-policy.mjs";
import {createSupabaseMcpSession} from "./mcp-client.mjs";
import {supabaseOAuthConfig,supabaseStartAuthorization,supabaseToken,supabaseIdentity} from "./supabase-oauth.mjs";
import {verifyAgentPluginCapability} from "./plugin-agent-capability.mjs";
import {fetchSignedPluginPackage} from "./plugin-package-verifier.mjs";
import {createPluginJobQueue} from "./plugin-job-queue.mjs";

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const CATALOG=Object.freeze([
 {id:"github",title:"GitHub",status:"oauth_supported",tools:["github.read_file","github.create_branch","github.write_file","github.open_pull_request"]},
 {id:"supabase",title:"Supabase",status:"requires_user_delegated_connector",tools:["supabase.list_tools","supabase.call_tool"]}
]);
const sha=value=>createHash("sha256").update(value).digest("hex");
const safeEqual=(a,b)=>{
 const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));
 return aa.length===bb.length&&timingSafeEqual(aa,bb);
};
function bounded(value,max,name) {
 if(typeof value!=="string"||!value.trim()||value.length>max)throw fail("Invalid "+name);
 return value.trim();
}
function endpoint(value){
 let url;try{url=new URL(value);}catch{throw fail("Invalid service URL",503);}
 if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash||
    url.hostname==="localhost"||url.hostname.endsWith(".localhost"))
   throw fail("Connector requires configured HTTPS endpoint",503);
 return url.href.replace(/\/+$/,"");
}
async function jsonRequest(url,{method="GET",body,token,fetchFn=fetch,timeoutMs=12000,accept="application/json",externalSignal}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 const relay=()=>controller.abort();
 if(externalSignal?.aborted)relay();
 externalSignal?.addEventListener("abort",relay,{once:true});
 try {
  const response=await fetchFn(url,{method,redirect:"error",signal:controller.signal,
   headers:{"Accept":accept,...(token?{"Authorization":"Bearer "+token}:{}),
    ...(body?{"Content-Type":"application/json"}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  const bytes=await response.text();
  if(bytes.length>600000)throw fail("Connector response is too large",502);
  if(!response.ok)throw fail("Connector returned HTTP "+response.status,502);
  try{return bytes?JSON.parse(bytes):{};}catch{throw fail("Connector response is not JSON",502);}
 }finally{clearTimeout(timer);externalSignal?.removeEventListener("abort",relay);}
}
function repoAllowed(env,repo){
 validateRepo(repo);
 const repos=(env.CIRO_GITHUB_REPOS||"").split(",").map(x=>x.trim());
 if(!repos.includes(repo))throw fail("Repository outside server allowlist",403);
 return repo;
}
async function githubCall(env,secret,method,path,body,fetchFn,externalSignal){
 return jsonRequest("https://api.github.com"+path,{method,body,token:secret.accessToken,fetchFn,externalSignal,accept:"application/vnd.github+json"});
}
const encodePath=p=>p.split("/").map(encodeURIComponent).join("/");
async function runGithub(env,credential,tool,args,fetchFn,signal){
 const repo=repoAllowed(env,bounded(args.repo,210,"repository"));
 const prefix="/repos/"+repo;
 if(tool==="github.read_file"){
   const path=safeFilePath(args.path);
   const branch=args.branch?safeBranch(args.branch):"";
   const result=await githubCall(env,credential,"GET",prefix+"/contents/"+encodePath(path)+(branch?"?ref="+encodeURIComponent(branch):""),undefined,fetchFn,signal);
   if(result.type!=="file"||result.encoding!=="base64"||result.size>180000)throw fail("Unsupported file",400);
   return {repo,path,sha:result.sha,content:Buffer.from(result.content.replace(/\s/g,""),"base64").toString("utf8")};
 }
 if(env.CIRO_GITHUB_WRITES!=="true")throw fail("Server-side GitHub writes are disabled",403);
 if(tool==="github.create_branch"){
   const branch=safeBranch(args.branch);
   const meta=await githubCall(env,credential,"GET",prefix,undefined,fetchFn,signal);
   const base=await githubCall(env,credential,"GET",prefix+"/git/ref/heads/"+encodeURIComponent(meta.default_branch),undefined,fetchFn,signal);
   return githubCall(env,credential,"POST",prefix+"/git/refs",{ref:"refs/heads/"+branch,sha:base.object.sha},fetchFn,signal);
 }
 if(tool==="github.open_pull_request"){
   if(env.CIRO_GITHUB_SELF_REPAIR_ENABLED!=="true"||env.CIRO_GITHUB_SELF_REPO!==repo)
     throw fail("Self-repair PR creation is disabled for this repository",403);
   const branch=safeBranch(args.branch);
   const base=bounded(args.base,130,"pull request base");
   if(!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,128}$/.test(base)||base.includes("..")||
      base.includes("//")||base.endsWith("/")||base===branch)
     throw fail("Invalid PR base or head",400);
   const title=bounded(args.title,120,"PR title");
   const body=typeof args.body==="string"&&args.body.length<=3000?args.body:"";
   const result=await githubCall(env,credential,"POST",prefix+"/pulls",
     {title,body,base,head:branch,draft:true,maintainer_can_modify:false},fetchFn,signal);
   if(!Number.isInteger(result.number)||typeof result.html_url!=="string")
     throw fail("GitHub PR creation response invalid",502);
   return {repo,number:result.number,url:result.html_url,draft:true,base,head:branch};
 }
 if(tool==="github.write_file"){
   const branch=safeBranch(args.branch),path=safeFilePath(args.path),message=bounded(args.message,150,"commit message");
   if(typeof args.content!=="string"||Buffer.byteLength(args.content)>180000)throw fail("Invalid file contents");
   if(args.expectedSha&&!/^[a-f0-9]{40}$/.test(args.expectedSha))throw fail("Invalid content SHA");
   const payload={branch,message,content:Buffer.from(args.content).toString("base64"),
     ...(args.expectedSha?{sha:args.expectedSha}:{})};
   return githubCall(env,credential,"PUT",prefix+"/contents/"+encodePath(path),payload,fetchFn,signal);
 }
 throw fail("Tool unavailable",404);
}
function checkToolPolicy(policy,provider,tool,args,source){
 if(source!=="chat"&&source!=="agent"&&source!=="manual")throw fail("Unknown tool source");
 if(provider==="github"){
   const action=tool==="github.read_file"?"github.read":tool==="github.create_branch"?"github.branch":
     tool==="github.write_file"?"github.write":tool==="github.open_pull_request"?"github.write":null;
   if(!action)throw fail("Unregistered GitHub tool",404);
   if(policy.repo!==args.repo)throw fail("Repository is outside selected scope",403);
   const verdict=decision(policy,action,{repo:args.repo});
   if(verdict.result==="deny")return verdict;
   // Even Full Access cannot bypass a separate approval for external mutations.
   if(action==="github.write"||action==="github.branch")
     return {result:"approval",reason:"External repository changes always require per-operation consent."};
   return verdict;
 }
 if(provider==="supabase"){
   if(!["supabase.list_tools","supabase.call_tool"].includes(tool))throw fail("Unknown tool",404);
   if(policy.mode==="custom"&&!policy.custom.externalNetwork)return {result:"deny",reason:"Network access denied"};
   return {result:tool==="supabase.call_tool"?"approval":"allow"};
 }
 return {result:"deny"};
}
function reviewedAction(provider,tool,args){
 if(provider==="github"&&tool==="github.write_file"){
  const repo=bounded(args.repo,210,"repository"),branch=safeBranch(args.branch),
    path=safeFilePath(args.path);
  if(typeof args.content!=="string"||Buffer.byteLength(args.content)>180000)
   throw fail("Invalid file contents");
  return "GitHub 写入 "+repo+" @ "+branch+" / "+path+
   " · 内容 SHA256 "+sha(args.content).slice(0,16)+
   (typeof args.message==="string"?" · 提交说明 "+args.message.slice(0,70):"");
 }
 if(provider==="github"&&tool==="github.create_branch")
  return "GitHub 创建分支 "+bounded(args.repo,210,"repository")+" @ "+safeBranch(args.branch);
 if(provider==="github"&&tool==="github.open_pull_request")
  return "GitHub 创建草稿 PR · "+bounded(args.repo,210,"repository")+" · "+safeBranch(args.branch)+
   " -> "+bounded(args.base,130,"base")+" · "+bounded(args.title,120,"title");
 if(provider==="supabase"&&tool==="supabase.call_tool")
  return "Supabase MCP 调用 "+bounded(args.name,100,"tool name")+
   " · 参数 SHA256 "+sha(JSON.stringify(args.arguments??{})).slice(0,16);
 return provider+" / "+tool;
}
export function createPluginGateway({env=process.env,dir,fetchFn=fetch}={}){
 const router=express.Router();
 const folder=dir||env.CIRO_WORKSPACE_DATA_DIR||join(process.cwd(),".ciro-runtime");
 const store=createPluginConnectionStore({dir:folder,env});
 const installs=createPluginInstallStore({dir:folder,readyProviders:{supabase:supabaseOAuthConfig(env).ready &&
  Boolean((env.CIRO_SUPABASE_MCP_TOOLS||"").trim())}});
 const jobs=createPluginJobQueue({dir:folder,env});
 // Workbench stores are independently persisted; load fresh policy on EVERY request.
 // Cached policy can silently retain access after a user revokes permission.
 const workbenchPolicy=()=>createWorkbenchStore(folder).get().policy;
 const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>res.status(e.statusCode||400).json({error:e.message||"Plugin gateway rejected request"}));
 const owner=req=>req.principal?.id||"local";
 const policy=()=>workbenchPolicy();
 function assertInstalled(user,provider){const record=installs.installed(user,provider);
  if(!record||!record.enabled)throw fail("Install and enable the plugin in the marketplace first",403);
  return record;
 }
 const activeToolRequests=new Map();
 const operationKey=(user,provider)=>user+"::"+provider;
 async function revokeProviderGrant(user,provider,recordOverride=null){
  const record=recordOverride||store.connection(user,provider);
  if(!record)return {upstreamRevoked:false,reason:"no_active_connection"};
  if(provider!=="github")return {upstreamRevoked:false,reason:"provider_revoke_manual"};
  const client=env.CIRO_GITHUB_OAUTH_CLIENT_ID,secret=env.CIRO_GITHUB_OAUTH_CLIENT_SECRET;
  if(record.secret?.authMethod==="fine_grained_pat")
    return {upstreamRevoked:false,reason:"fine_grained_pat_removed_locally_revoke_it_in_github_settings"};
  if(!client||!secret||!record.secret?.accessToken)
    return {upstreamRevoked:false,reason:"oauth_configuration_missing"};
  try {
   const response=await fetchFn("https://api.github.com/applications/"+encodeURIComponent(client)+"/grant",{
    method:"DELETE",redirect:"error",signal:AbortSignal.timeout(12000),
    headers:{"Accept":"application/vnd.github+json",
     "Authorization":"Basic "+Buffer.from(client+":"+secret).toString("base64"),
     "Content-Type":"application/json"},
    body:JSON.stringify({access_token:record.secret.accessToken})
   });
   return {upstreamRevoked:response.status===204,
    reason:response.status===204?"provider_grant_revoked":"provider_revoke_failed"};
  }catch{return {upstreamRevoked:false,reason:"provider_unreachable"};}
 }
 function abortOperations(user,provider){
  const key=operationKey(user,provider),active=activeToolRequests.get(key);
  if(active)for(const controller of active)controller.abort();
 }
 function trackOperation(user,provider){
  const key=operationKey(user,provider),controller=new AbortController();
  if(!activeToolRequests.has(key))activeToolRequests.set(key,new Set());
  activeToolRequests.get(key).add(controller);
  return {signal:controller.signal,finish(){
    const set=activeToolRequests.get(key);set?.delete(controller);
    if(set?.size===0)activeToolRequests.delete(key);
  }};
 }
 const tokenRefreshLocks=new Map();
 async function credentialFor(user,provider){
  let credential=store.connection(user,provider);
  if(!credential)throw fail("Connect this plugin before invoking it",403);
  const installation=installs.installed(user,provider);
  if(!installation?.enabled||!installation.installationId||
    credential.installationId!==installation.installationId)
    throw fail("Plugin installation changed; reconnect account after reinstall",403);
  const needsRefresh=x=>Number.isFinite(x?.secret?.expiresAt) &&
    x.secret.expiresAt < Date.now()+60000;
  if(!needsRefresh(credential))return credential;
  const key=user+":"+provider;
  if(!tokenRefreshLocks.has(key)){
   const job=(async()=>{
    const current=store.connection(user,provider);
    if(!current||!needsRefresh(current))return;
    if(typeof current.secret.refreshToken!=="string"||!current.secret.refreshToken)
      throw fail("Plugin OAuth session expired: reconnect your account",401);
    let next;
    if(provider==="supabase"){
      next=await supabaseToken(env,{type:"refresh_token",refreshToken:current.secret.refreshToken},fetchFn);
    }else if(provider==="github"){
      const client=bounded(env.CIRO_GITHUB_OAUTH_CLIENT_ID,150,"GitHub client ID");
      const secret=bounded(env.CIRO_GITHUB_OAUTH_CLIENT_SECRET,500,"GitHub client secret");
      const form=new URLSearchParams({client_id:client,client_secret:secret,
       grant_type:"refresh_token",refresh_token:current.secret.refreshToken});
      const response=await fetchFn("https://github.com/login/oauth/access_token",{
        method:"POST",redirect:"error",signal:AbortSignal.timeout(14000),
        headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},
        body:form.toString()});
      if(!response.ok)throw fail("GitHub refresh failed: reconnect account",401);
      const data=await response.json();
      if(typeof data.access_token!=="string"||!data.access_token||
         typeof data.refresh_token!=="string"||!data.refresh_token||
         !Number.isFinite(data.expires_in)||data.expires_in<=0)
        throw fail("GitHub refresh response invalid",502);
      next={accessToken:data.access_token,refreshToken:data.refresh_token,
       expiresAt:Date.now()+data.expires_in*1000};
    }else throw fail("Provider token refresh unsupported",403);
    store.rotateConnectionSecret(user,provider,current.generation,next);
   })();
   tokenRefreshLocks.set(key,job);
   void job.finally(()=>{if(tokenRefreshLocks.get(key)===job)tokenRefreshLocks.delete(key);}).catch(()=>{});
  }
  await tokenRefreshLocks.get(key);
  credential=store.connection(user,provider);
  if(!credential)throw fail("Connection was revoked during refresh",403);
  return credential;
 }
 async function execute(user,provider,tool,args,source,approval=false){
  assertInstalled(user,provider);
  const verdict=checkToolPolicy(policy(),provider,tool,args,source);
  if(verdict.result==="deny")throw fail(verdict.reason||"Permission denied",403);
  const connection=await credentialFor(user,provider);
  if(verdict.result==="approval"&&!approval){
   const pending=store.queueApproval({ownerId:user,provider,tool,args,source,
    policySignature:sha(JSON.stringify(policy())),generation:connection.generation,
    summary:reviewedAction(provider,tool,args)});
   return {approvalRequired:true,...pending};
  }
  const operation=trackOperation(user,provider);
  let output;
  try{
   if(provider==="github")output=await runGithub(env,connection.secret,tool,args,fetchFn,operation.signal);
   else if(provider==="supabase"){
    const conf=supabaseOAuthConfig(env);
    if(!conf.ready||connection.secret.projectRef!==conf.projectRef)
      throw fail("User-scoped Supabase MCP configuration changed",403);
    const allowed=new Set((env.CIRO_SUPABASE_MCP_TOOLS||"").split(",")
      .map(x=>x.trim()).filter(x=>/^[A-Za-z0-9_.:-]{1,100}$/.test(x)));
    if(!allowed.size)throw fail("No Supabase MCP tools allowlisted",403);
    const mcp=await createSupabaseMcpSession({projectRef:conf.projectRef,
      accessToken:connection.secret.accessToken,fetchFn,signal:operation.signal});
    try{
      const visible=(await mcp.listTools()).filter(x=>allowed.has(x.name));
      if(tool==="supabase.list_tools")output={tools:visible};
      else if(tool==="supabase.call_tool"){
        const name=bounded(args.name,100,"MCP tool name");
        const declared=visible.find(x=>x.name===name);
        if(!declared)throw fail("MCP tool outside allowlist or missing from discovery",403);
        const params=args.arguments;
        if(!params||typeof params!=="object"||Array.isArray(params)||JSON.stringify(params).length>32000)
          throw fail("Invalid MCP arguments",400);
        for(const field of declared.inputSchema.required||[]){
          if(typeof field==="string"&&!Object.hasOwn(params,field))
            throw fail("Missing required MCP argument",400);
        }
        output=await mcp.callTool(name,params);
        if(output.isError)throw fail("MCP tool reported an error",502);
      }else throw fail("Unsupported Supabase MCP operation",404);
    }finally{await mcp.close();}
   }else throw fail("Unknown connector",404);
   store.change("tool.executed",()=>{}, {ownerId:user,provider,tool,source,outcome:"ok"});
   return {executed:true,provider,tool,result:output};
  }catch(e){
   store.change("tool.failed",()=>{}, {ownerId:user,provider,tool,source,outcome:"failed"});
   throw e;
  }finally{operation.finish();}
 }

 const MODEL_TOOLS=Object.freeze({
  ciro_github_read_file:{name:"github.read_file",description:"读取 GitHub 仓库中已授权范围内的文本文件。",
    properties:{repo:{type:"string"},path:{type:"string"},branch:{type:"string"}},required:["repo","path"]},
  ciro_github_create_branch:{name:"github.create_branch",description:"在已授权仓库创建功能分支（可能需要用户审批）。",
    properties:{repo:{type:"string"},branch:{type:"string"}},required:["repo","branch"]},
  ciro_github_write_file:{name:"github.write_file",description:"写入已授权功能分支的仓库文件，必须经用户审批；不得直接写入主分支。",
    properties:{repo:{type:"string"},branch:{type:"string"},path:{type:"string"},
      content:{type:"string"},message:{type:"string"},expectedSha:{type:"string"}},
    required:["repo","branch","path","content","message"]},
  ciro_github_open_pull_request:{name:"github.open_pull_request",description:"仅在指定自研仓库创建草稿 PR，不会自动合并；操作必须由用户审批。",
    properties:{repo:{type:"string"},branch:{type:"string"},base:{type:"string"},
      title:{type:"string"},body:{type:"string"}},
    required:["repo","branch","base","title"]}
 });
 function listModelTools(user) {
  const result=[];
  const installedGitHub=installs.installed(user,"github");
  const connectedGitHub=store.connection(user,"github");
  if(installedGitHub?.enabled&&installedGitHub.installationId&&
     connectedGitHub?.installationId===installedGitHub.installationId){
   const permission=policy(),repo=permission.repo;
   if(repo && (env.CIRO_GITHUB_REPOS||"").split(",").map(x=>x.trim()).includes(repo)){
    for(const [functionName,item] of Object.entries(MODEL_TOOLS)){
     const action=item.name==="github.read_file"?"github.read":
      item.name==="github.create_branch"?"github.branch":"github.write";
     if(item.name==="github.open_pull_request"&&
        (env.CIRO_GITHUB_SELF_REPAIR_ENABLED!=="true"||env.CIRO_GITHUB_SELF_REPO!==repo))continue;
     if(action!=="github.read"&&env.CIRO_GITHUB_WRITES!=="true")continue;
     if(decision(permission,action,{repo}).result==="deny")continue;
     result.push({type:"function",function:{name:functionName,description:item.description,
      parameters:{type:"object",additionalProperties:false,properties:{
       ...item.properties,repo:{type:"string",enum:[repo]}
      },required:item.required}}});
    }
   }
  }
  if(installs.installed(user,"supabase")?.enabled&&
     installs.installed(user,"supabase")?.installationId&&
     store.connection(user,"supabase")?.installationId===
      installs.installed(user,"supabase")?.installationId&&
     supabaseOAuthConfig(env).ready &&
     !(policy().mode==="custom"&&!policy().custom.externalNetwork)){
   const names=(env.CIRO_SUPABASE_MCP_TOOLS||"").split(",")
     .map(x=>x.trim()).filter(x=>/^[A-Za-z0-9_.:-]{1,100}$/.test(x));
   if(names.length)result.push({type:"function",function:{
    name:"ciro_supabase_call_tool",description:"调用用户自行授权的 Supabase RLS 隔离 MCP 工具。每次调用需要用户批准。",
    parameters:{type:"object",additionalProperties:false,properties:{
     name:{type:"string",enum:names},
     arguments:{type:"object",description:"按 MCP 工具参数定义传参"}
    },required:["name","arguments"]}}});
  }
  return result;
 }
 async function executeModelTool(user,functionName,args,source="chat") {
  if(!listModelTools(user).some(x=>x.function.name===functionName))
   throw fail("Tool not installed, connected or granted",403);
  if(functionName==="ciro_supabase_call_tool")
   return execute(user,"supabase","supabase.call_tool",args,source);
  const mapping=MODEL_TOOLS[functionName];
  if(!mapping)throw fail("Unknown plugin function",404);
  return execute(user,"github",mapping.name,args,source);
 }


 // Only side-effect-free reads are accepted into the automatic durable worker.
 // Approved writes receive a durable ledger entry but execute in the foreground
 // under the existing one-shot human approval; they are NEVER auto-replayed.
 async function enqueueSafeRead(user,provider,tool,args,idempotencyKey){
  if(!((provider==="github"&&tool==="github.read_file")||
       (provider==="supabase"&&tool==="supabase.list_tools")))
   throw fail("Automatic queue accepts read-only tools; external writes require human approval",403);
  if(!args||typeof args!=="object"||Array.isArray(args)||
     JSON.stringify(args).length>200000)throw fail("Invalid queued tool arguments",400);
  const installation=assertInstalled(user,provider);
  const verdict=checkToolPolicy(policy(),provider,tool,args,"manual");
  if(verdict.result!=="allow")throw fail("Queued operation is not currently allowed",403);
  const connection=await credentialFor(user,provider);
  return jobs.enqueue({ownerId:user,provider,tool,args,source:"manual",
   idempotencyKey,effect:false,installationId:installation.installationId,
   generation:connection.generation,policySignature:sha(JSON.stringify(policy()))});
 }
 async function runNextJob({workerId}={}){
  const item=jobs.claim({workerId,readsOnly:true});
  if(!item)return null;
  const {ownerId,provider,tool,request}=item;
  try{
   const install=assertInstalled(ownerId,provider);
   if(!install.installationId||install.installationId!==request.installationId)
    throw fail("Queued tool installation changed",403);
   const credential=await credentialFor(ownerId,provider);
   if(credential.generation!==request.generation||
      sha(JSON.stringify(policy()))!==request.policySignature)
    throw fail("Queued tool authorization or policy changed",403);
   if(checkToolPolicy(policy(),provider,tool,request.args,"manual").result!=="allow")
    throw fail("Queued permission was revoked before execution",403);
   const result=await execute(ownerId,provider,tool,request.args,"manual");
   if(result.approvalRequired)throw fail("Read queue cannot elevate into an approved effect",403);
   return jobs.finalize({id:item.id,workerId,result:result.result??result});
  }catch(error){
   return jobs.finalize({id:item.id,workerId,errorCode:
     error?.statusCode===403?"permission_revoked":"tool_read_failed",
     retryable:error?.statusCode===502||error?.statusCode===503});
  }
 }

 router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
 router.get("/catalog",wrap((req,res)=>res.json({
   catalog:installs.catalog,
   githubScope:{
    allowedRepositories:(env.CIRO_GITHUB_REPOS||"").split(",").map(x=>x.trim())
      .filter(x=>/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(x)&&!x.includes("..")),
    selectedRepository:policy().repo||"",
    mode:policy().mode,
    custom:policy().custom,
    writesEnabled:env.CIRO_GITHUB_WRITES==="true",
    oauthConfigured:env.CIRO_ACCOUNTS_ENABLED==="true"&&
     Boolean(env.CIRO_GITHUB_OAUTH_CLIENT_ID&&env.CIRO_GITHUB_OAUTH_CLIENT_SECRET&&env.CIRO_PUBLIC_ORIGIN),
    tokenConnectionEnabled:env.CIRO_ACCOUNTS_ENABLED==="true"&&
     env.CIRO_GITHUB_FINE_GRAINED_PAT_ENABLED==="true"&&env.CIRO_DEPLOYMENT_MODE!=="production",
    selfRepairEnabled:env.CIRO_GITHUB_SELF_REPAIR_ENABLED==="true"&&
     env.CIRO_GITHUB_SELF_REPO===policy().repo&&env.CIRO_GITHUB_WRITES==="true"
   },
   installed:installs.list(owner(req)),installAudit:installs.audit(owner(req)),
   jobs:jobs.list(owner(req)),
   connections:store.publicConnections(owner(req)),approvals:store.publicApprovals(owner(req)),
   audit:store.audit(owner(req))})));
 router.get("/jobs",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Authenticated browser session required",403);
  res.json({jobs:jobs.list(owner(req))});
 }));
 router.get("/jobs/:id",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Authenticated browser session required",403);
  res.json(jobs.get(owner(req),req.params.id));
 }));
 router.post("/jobs",wrap(async(req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Authenticated browser session required",403);
  const provider=bounded(req.body?.provider,40,"provider");
  const tool=bounded(req.body?.tool,100,"tool");
  const created=await enqueueSafeRead(owner(req),provider,tool,
    req.body?.args,req.body?.idempotencyKey);
  res.status(created.duplicate?200:202).json(created);
 }));
 router.post("/jobs/:id/cancel",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Authenticated browser session required",403);
  res.json(jobs.cancel(owner(req),req.params.id));
 }));
 router.post("/marketplace/:id/prepare",wrap(async(req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required for plugin installation",403);
  let verifiedPackage=null;
  if(env.CIRO_PLUGIN_REGISTRY_ORIGIN){
    if(typeof env.CIRO_PLUGIN_TRUSTED_KEYS_JSON!=="string"||
       env.CIRO_PLUGIN_TRUSTED_KEYS_JSON.length>64000)
      throw fail("Trusted plugin signer list is not configured",503);
    let keys;
    try{keys=JSON.parse(env.CIRO_PLUGIN_TRUSTED_KEYS_JSON);}
    catch{throw fail("Invalid plugin trust configuration",503);}
    const hosts=(env.CIRO_PLUGIN_REGISTRY_HOST_ALLOWLIST||"").split(",").map(x=>x.trim()).filter(Boolean);
    verifiedPackage=await fetchSignedPluginPackage({id:req.params.id,
      registryOrigin:env.CIRO_PLUGIN_REGISTRY_ORIGIN,
      allowedRegistryHosts:hosts,keys,fetchFn});
  }else if(env.CIRO_DEPLOYMENT_MODE==="production"){
    throw fail("Production marketplace requires a pinned signed package registry",503);
  }
  res.json(installs.prepare({ownerId:owner(req),sessionId:req.principal.sessionId,
    id:req.params.id,verifiedPackage}));
 }));
 router.post("/marketplace/:id/install",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required for plugin installation",403);
  const record=installs.install({ownerId:owner(req),sessionId:req.principal.sessionId,id:req.params.id,
   nonce:req.body?.nonce,fingerprint:req.body?.fingerprint,confirm:req.body?.confirm});
  res.status(201).json({installed:true,plugin:record});
 }));
 router.post("/installed/:id/uninstall",wrap(async(req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required for plugin removal",403);
  abortOperations(owner(req),req.params.id);
  const previous=store.connection(owner(req),req.params.id);
  const result=installs.uninstall(owner(req),req.params.id);
  store.removeConnection(owner(req),req.params.id);
  const provider=await revokeProviderGrant(owner(req),req.params.id,previous);
  res.json({...result,...provider});
 }));
 router.post("/installed/:id/enabled",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required",403);
  if(req.body?.enabled===false)abortOperations(owner(req),req.params.id);
  res.json(installs.setEnabled(owner(req),req.params.id,req.body?.enabled));
 }));
 // Internal / desktop single-owner mode only. An independently issued fine-grained
 // GitHub PAT is provided directly by the user inside the local CIRO app (never in chat).
 // Never use this alternative for a public/multi-tenant deployment or a remote browser.
 router.post("/github/connect-token",wrap(async(req,res)=>{
  if(env.CIRO_GITHUB_FINE_GRAINED_PAT_ENABLED!=="true"||
     env.CIRO_ACCOUNTS_ENABLED!=="true"||env.CIRO_DEPLOYMENT_MODE==="production"||
     req.principal?.mode!=="session")
    throw fail("Local authenticated GitHub token connection is disabled",403);
  const remote=req.socket.remoteAddress||"";
  const originHeader=req.get("origin")||"";
  const host=req.get("host")||"";
  let origin;
  try{origin=new URL(originHeader);}catch{throw fail("Same-origin desktop session required",403);}
  if(!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(remote)||
     !["127.0.0.1","localhost","[::1]"].includes(origin.hostname)||
     origin.protocol!=="http:"||origin.host!==host||
     (req.get("sec-fetch-site")&&!["same-origin","none"].includes(req.get("sec-fetch-site"))))
    throw fail("GitHub personal token may only be connected from the local app",403);
  const installation=assertInstalled(owner(req),"github");
  if(!installation.installationId)throw fail("Plugin must be reinstalled",409);
  const repo=repoAllowed(env,policy().repo);
  const token=req.body?.token;
  if(typeof token!=="string"||!/^github_pat_[A-Za-z0-9_]{40,300}$/.test(token))
    throw fail("Use a repository-restricted GitHub fine-grained PAT",400);
  const identity=await jsonRequest("https://api.github.com/user",{
    token,fetchFn,accept:"application/vnd.github+json"});
  if(!Number.isInteger(identity.id)||typeof identity.login!=="string"||
     identity.login.length>100)
    throw fail("GitHub identity could not be verified",502);
  await jsonRequest("https://api.github.com/repos/"+repo,{
    token,fetchFn,accept:"application/vnd.github+json"});
  assertInstalled(owner(req),"github");
  if(policy().repo!==repo)throw fail("Repository scope changed during connection",403);
  store.putConnection({ownerId:owner(req),provider:"github",
    installationId:installation.installationId,
    account:{id:identity.id,login:identity.login},
    secret:{accessToken:token,authMethod:"fine_grained_pat"},
    scopes:["selected_repo_only","provider_token_permissions_unverified"]});
  res.json({connected:true,provider:"github",login:identity.login,repo,
    note:"Token encrypted locally. Revoke the fine-grained PAT in GitHub settings when finished."});
 }));
 router.post("/github/connect",wrap((req,res)=>{
  const installation=assertInstalled(owner(req),"github");
  if(!installation.installationId)throw fail("Legacy installation must be reinstalled",409);
  if(env.CIRO_ACCOUNTS_ENABLED!=="true"||req.principal?.mode!=="session")
    throw fail("GitHub OAuth requires an authenticated browser session",403);
  const client=bounded(env.CIRO_GITHUB_OAUTH_CLIENT_ID,150,"GitHub OAuth client ID");
  bounded(env.CIRO_GITHUB_OAUTH_CLIENT_SECRET,500,"GitHub OAuth client secret");
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const state=randomBytes(32).toString("base64url");
  store.addOAuth({ownerId:owner(req),sessionId:req.principal.sessionId,stateHash:sha(state),
    verifier:state,installationId:installation.installationId});
  const url=new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id",client);
  url.searchParams.set("redirect_uri",origin+"/api/plugins/github/callback");
  url.searchParams.set("state",state);
  url.searchParams.set("scope","repo read:user offline_access");
  res.json({authorizeUrl:url.toString(),expiresInSeconds:600});
 }));
 router.get("/github/callback",wrap(async(req,res)=>{
  if(env.CIRO_ACCOUNTS_ENABLED!=="true"||req.principal?.mode!=="session")throw fail("Session required",403);
  assertInstalled(owner(req),"github");
  const code=bounded(req.query.code,300,"authorization code");
  const state=bounded(req.query.state,150,"authorization state");
  const pending=store.takeOAuth({ownerId:owner(req),sessionId:req.principal.sessionId,stateHash:sha(state)});
  if(!pending||!safeEqual(pending.verifier,state)||
   !pending.installationId||
   installs.installed(owner(req),"github")?.installationId!==pending.installationId)
    throw fail("OAuth state invalid or plugin installation changed",403);
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const body=new URLSearchParams({client_id:env.CIRO_GITHUB_OAUTH_CLIENT_ID,
   client_secret:env.CIRO_GITHUB_OAUTH_CLIENT_SECRET,code,redirect_uri:origin+"/api/plugins/github/callback"}).toString();
  const response=await fetchFn("https://github.com/login/oauth/access_token",{
   method:"POST",redirect:"error",headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded"},body});
  if(!response.ok)throw fail("GitHub token exchange failed",502);
  const data=await response.json();
  if(typeof data.access_token!=="string"||!data.access_token)throw fail("GitHub OAuth rejected authorization",403);
  const identity=await jsonRequest("https://api.github.com/user",{token:data.access_token,fetchFn,
   accept:"application/vnd.github+json"});
  if(!Number.isInteger(identity.id)||typeof identity.login!=="string")throw fail("GitHub account could not be verified",502);
  assertInstalled(owner(req),"github");
  store.putConnection({ownerId:owner(req),provider:"github",installationId:pending.installationId,
   account:{id:identity.id,login:identity.login},secret:{accessToken:data.access_token,
    refreshToken:typeof data.refresh_token==="string"?data.refresh_token:null,
    expiresAt:Number.isFinite(data.expires_in)?Date.now()+data.expires_in*1000:null},
   scopes:typeof data.scope==="string"?data.scope.split(","):[]});
  res.redirect(303,"/?view=plugins&connection=github");
 }));
 router.post("/supabase/connect",wrap((req,res)=>{
  const installation=assertInstalled(owner(req),"supabase");
  if(!installation.installationId)throw fail("Legacy installation must be reinstalled",409);
  if(env.CIRO_ACCOUNTS_ENABLED!=="true"||req.principal?.mode!=="session")
    throw fail("Supabase OAuth requires an authenticated browser session",403);
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const started=supabaseStartAuthorization(env,origin+"/api/plugins/supabase/callback");
  store.addOAuth({provider:"supabase",ownerId:owner(req),sessionId:req.principal.sessionId,
    stateHash:sha(started.state),verifier:started.state,
    codeVerifier:started.codeVerifier,installationId:installation.installationId});
  res.json({authorizeUrl:started.authorizeUrl,expiresInSeconds:600});
 }));
 router.get("/supabase/callback",wrap(async(req,res)=>{
  if(env.CIRO_ACCOUNTS_ENABLED!=="true"||req.principal?.mode!=="session")
    throw fail("Authenticated session required",403);
  assertInstalled(owner(req),"supabase");
  const code=bounded(req.query.code,300,"authorization code");
  const state=bounded(req.query.state,150,"authorization state");
  const pending=store.takeOAuth({provider:"supabase",ownerId:owner(req),
    sessionId:req.principal.sessionId,stateHash:sha(state)});
  if(!pending||!safeEqual(pending.verifier,state)||typeof pending.codeVerifier!=="string"||
     !pending.installationId||
     installs.installed(owner(req),"supabase")?.installationId!==pending.installationId)
    throw fail("OAuth state invalid or expired",403);
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const token=await supabaseToken(env,{type:"authorization_code",code,
    codeVerifier:pending.codeVerifier,redirectUri:origin+"/api/plugins/supabase/callback"},fetchFn);
  const identity=await supabaseIdentity(env,token.accessToken,fetchFn);
  assertInstalled(owner(req),"supabase");
  // No administrator credential or service-role token is permitted.
  store.putConnection({ownerId:owner(req),provider:"supabase",installationId:pending.installationId,
    account:identity,secret:token,scopes:token.scopes});
  res.redirect(303,"/?view=plugins&connection=supabase");
 }));
 router.post("/:provider/disconnect",wrap(async(req,res)=>{
  if(!CATALOG.some(x=>x.id===req.params.provider))throw fail("Unknown provider",404);
  abortOperations(owner(req),req.params.provider);
  const previous=store.connection(owner(req),req.params.provider);
  store.removeConnection(owner(req),req.params.provider);
  const remote=await revokeProviderGrant(owner(req),req.params.provider,previous);
  res.json({revokedLocally:true,provider:req.params.provider,...remote,
   note:remote.upstreamRevoked?"Upstream app authorization revoked.":
    "Local token removed; revoke app access at provider if still authorized."});
 }));
 router.post("/agent/invoke",wrap(async(req,res)=>{
  // The account guard exempts exactly this machine-to-machine route.
  // A bearer is useful ONLY while the named, user-owned job is actively running.
  const token=req.get("x-ciro-agent-capability")||"";
  const id=bounded(req.body?.jobId,120,"agent job ID");
  const name=bounded(req.body?.tool,100,"agent tool");
  const args=req.body?.args;
  if(!args||typeof args!=="object"||Array.isArray(args)||JSON.stringify(args).length>32000)
    throw fail("Invalid agent tool arguments",400);
  const snapshot=createWorkbenchStore(folder).get();
  const goal=snapshot.goals.find(x=>x.id===id&&x.ownerId);
  if(!goal)throw fail("Active owner-scoped agent job not found",403);
  verifyAgentPluginCapability({secret:env.CIRO_AGENT_TOOL_CAPABILITY_SECRET,token,goal});
  if(goal.policySnapshot!==JSON.stringify(snapshot.policy)||goal.repo!==snapshot.policy.repo)
    throw fail("Agent task permissions changed",403);
  const result=await executeModelTool(goal.ownerId,name,args,"agent");
  res.status(result.approvalRequired?202:200).json(result);
 }));
 router.post("/invoke",wrap(async(req,res)=>{
  const provider=bounded(req.body?.provider,40,"provider");
  const tool=bounded(req.body?.tool,100,"tool");
  const args=req.body?.args;
  if(!args||typeof args!=="object"||Array.isArray(args))throw fail("Tool arguments must be an object");
  if(JSON.stringify(args).length>200000)throw fail("Arguments too large");
  if(req.body.source&&req.body.source!=="manual")throw fail("API callers cannot impersonate agents or model calls",403);
  const result=await execute(owner(req),provider,tool,args,"manual");
  res.status(result.approvalRequired?202:200).json(result);
 }));
 router.post("/approvals/:id",wrap(async(req,res)=>{
  if(env.CIRO_ACCOUNTS_ENABLED==="true"&&req.principal?.mode!=="session")
    throw fail("Authenticated browser approval required",403);
  if(!["approve","reject"].includes(req.body?.decision))throw fail("Bad decision");
  const user=owner(req);
  const item=store.takeApproval(user,req.params.id,req.body.decision);
  if(req.body.decision==="reject")return res.json({status:"rejected"});
  let claimed=null,writerId=null;
  try{
   const install=assertInstalled(user,item.provider);
   const current=await credentialFor(user,item.provider);
   if(current.generation!==item.generation||sha(JSON.stringify(policy()))!==item.policySignature)
     throw fail("Connection or permissions changed; create a new request",403);
   const receipt=jobs.enqueue({ownerId:user,provider:item.provider,
    tool:item.request.tool,args:item.request.args,source:item.request.source,
    idempotencyKey:"approval:"+item.id,effect:true,approvalId:item.id,
    installationId:install.installationId,generation:item.generation,
    policySignature:item.policySignature});
   writerId=randomUUID();
   claimed=jobs.claim({workerId:writerId,id:receipt.id,readsOnly:false});
   if(!claimed)throw fail("Approved write could not acquire durable execution lease",409);
   const result=await execute(user,item.provider,item.request.tool,item.request.args,item.request.source,true);
   jobs.finalize({id:claimed.id,workerId:writerId,
    result:{completed:true,provider:item.provider,tool:item.request.tool,
     resultDigest:sha(JSON.stringify(result.result??result))}});
   store.finishApproval(user,item.id,"approved");
   res.json({status:"approved",jobId:claimed.id,result});
  }catch(error){
   if(claimed&&writerId){
    // A network mutation may already have reached the provider. Never retry it.
    try{jobs.finalize({id:claimed.id,workerId:writerId,
      errorCode:"external_effect_unknown",mayHaveSideEffect:true});}catch{}
   }
   try{store.finishApproval(user,item.id,"failed");}catch{}
   throw error;
  }
 }));
 return {router,store,installs,jobs,listModelTools,executeModelTool,runNextJob};
}

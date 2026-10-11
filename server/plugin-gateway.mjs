import express from "express";
import {createHash,randomBytes,timingSafeEqual} from "node:crypto";
import {join} from "node:path";
import {createPluginConnectionStore} from "./plugin-connection-store.mjs";
import {createPluginInstallStore} from "./plugin-install-store.mjs";
import {createWorkbenchStore} from "./workbench-store.mjs";
import {decision,validateRepo,safeFilePath,safeBranch} from "./agent-policy.mjs";
import {createSupabaseMcpSession} from "./mcp-client.mjs";
import {supabaseOAuthConfig,supabaseStartAuthorization,supabaseToken,supabaseIdentity} from "./supabase-oauth.mjs";
import {verifyAgentPluginCapability} from "./plugin-agent-capability.mjs";

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const CATALOG=Object.freeze([
 {id:"github",title:"GitHub",status:"oauth_supported",tools:["github.read_file","github.create_branch","github.write_file"]},
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
     tool==="github.write_file"?"github.write":null;
   if(!action)throw fail("Unregistered GitHub tool",404);
   if(policy.repo!==args.repo)throw fail("Repository is outside selected scope",403);
   return decision(policy,action,{repo:args.repo});
 }
 if(provider==="supabase"){
   if(!["supabase.list_tools","supabase.call_tool"].includes(tool))throw fail("Unknown tool",404);
   if(policy.mode==="custom"&&!policy.custom.externalNetwork)return {result:"deny",reason:"Network access denied"};
   return {result:tool==="supabase.call_tool"?"approval":"allow"};
 }
 return {result:"deny"};
}
export function createPluginGateway({env=process.env,dir,fetchFn=fetch}={}){
 const router=express.Router();
 const folder=dir||env.CIRO_WORKSPACE_DATA_DIR||join(process.cwd(),".ciro-runtime");
 const store=createPluginConnectionStore({dir:folder,env});
 const installs=createPluginInstallStore({dir:folder,readyProviders:{supabase:supabaseOAuthConfig(env).ready &&
  Boolean((env.CIRO_SUPABASE_MCP_TOOLS||"").trim())}});
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
    summary:provider+" / "+tool});
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
  ciro_github_write_file:{name:"github.write_file",description:"写入已授权功能分支的仓库文件（可能需要用户审批）。",
    properties:{repo:{type:"string"},branch:{type:"string"},path:{type:"string"},
      content:{type:"string"},message:{type:"string"},expectedSha:{type:"string"}},
    required:["repo","branch","path","content","message"]}
 });
 function listModelTools(user) {
  const result=[];
  if(installs.installed(user,"github")?.enabled && store.connection(user,"github")){
   const permission=policy(),repo=permission.repo;
   if(repo && (env.CIRO_GITHUB_REPOS||"").split(",").map(x=>x.trim()).includes(repo)){
    for(const [functionName,item] of Object.entries(MODEL_TOOLS)){
     const action=item.name==="github.read_file"?"github.read":
      item.name==="github.create_branch"?"github.branch":"github.write";
     if(action!=="github.read"&&env.CIRO_GITHUB_WRITES!=="true")continue;
     if(decision(permission,action,{repo}).result==="deny")continue;
     result.push({type:"function",function:{name:functionName,description:item.description,
      parameters:{type:"object",additionalProperties:false,properties:{
       ...item.properties,repo:{type:"string",enum:[repo]}
      },required:item.required}}});
    }
   }
  }
  if(installs.installed(user,"supabase")?.enabled&&store.connection(user,"supabase")&&
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

 router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
 router.get("/catalog",wrap((req,res)=>res.json({catalog:installs.catalog,
   installed:installs.list(owner(req)),installAudit:installs.audit(owner(req)),
   connections:store.publicConnections(owner(req)),approvals:store.publicApprovals(owner(req)),
   audit:store.audit(owner(req))})));
 router.post("/marketplace/:id/prepare",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required for plugin installation",403);
  res.json(installs.prepare({ownerId:owner(req),sessionId:req.principal.sessionId,id:req.params.id}));
 }));
 router.post("/marketplace/:id/install",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required for plugin installation",403);
  const record=installs.install({ownerId:owner(req),sessionId:req.principal.sessionId,id:req.params.id,
   nonce:req.body?.nonce,fingerprint:req.body?.fingerprint,confirm:req.body?.confirm});
  res.status(201).json({installed:true,plugin:record});
 }));
 router.post("/installed/:id/uninstall",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required for plugin removal",403);
  abortOperations(owner(req),req.params.id);
  const result=installs.uninstall(owner(req),req.params.id);
  store.removeConnection(owner(req),req.params.id);
  res.json(result);
 }));
 router.post("/installed/:id/enabled",wrap((req,res)=>{
  if(req.principal?.mode!=="session")throw fail("Browser session required",403);
  if(req.body?.enabled===false)abortOperations(owner(req),req.params.id);
  res.json(installs.setEnabled(owner(req),req.params.id,req.body?.enabled));
 }));
 router.post("/github/connect",wrap((req,res)=>{
  assertInstalled(owner(req),"github");
  if(env.CIRO_ACCOUNTS_ENABLED!=="true"||req.principal?.mode!=="session")
    throw fail("GitHub OAuth requires an authenticated browser session",403);
  const client=bounded(env.CIRO_GITHUB_OAUTH_CLIENT_ID,150,"GitHub OAuth client ID");
  bounded(env.CIRO_GITHUB_OAUTH_CLIENT_SECRET,500,"GitHub OAuth client secret");
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const state=randomBytes(32).toString("base64url");
  store.addOAuth({ownerId:owner(req),sessionId:req.principal.sessionId,stateHash:sha(state),verifier:state});
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
  if(!pending||!safeEqual(pending.verifier,state))throw fail("OAuth state invalid or expired",403);
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
  store.putConnection({ownerId:owner(req),provider:"github",
   account:{id:identity.id,login:identity.login},secret:{accessToken:data.access_token,
    refreshToken:typeof data.refresh_token==="string"?data.refresh_token:null,
    expiresAt:Number.isFinite(data.expires_in)?Date.now()+data.expires_in*1000:null},
   scopes:typeof data.scope==="string"?data.scope.split(","):[]});
  res.redirect(303,"/settings?section=plugins&connection=github");
 }));
 router.post("/supabase/connect",wrap((req,res)=>{
  assertInstalled(owner(req),"supabase");
  if(env.CIRO_ACCOUNTS_ENABLED!=="true"||req.principal?.mode!=="session")
    throw fail("Supabase OAuth requires an authenticated browser session",403);
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const started=supabaseStartAuthorization(env,origin+"/api/plugins/supabase/callback");
  store.addOAuth({provider:"supabase",ownerId:owner(req),sessionId:req.principal.sessionId,
    stateHash:sha(started.state),verifier:started.state,codeVerifier:started.codeVerifier});
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
  if(!pending||!safeEqual(pending.verifier,state)||typeof pending.codeVerifier!=="string")
    throw fail("OAuth state invalid or expired",403);
  const origin=endpoint(env.CIRO_PUBLIC_ORIGIN);
  const token=await supabaseToken(env,{type:"authorization_code",code,
    codeVerifier:pending.codeVerifier,redirectUri:origin+"/api/plugins/supabase/callback"},fetchFn);
  const identity=await supabaseIdentity(env,token.accessToken,fetchFn);
  // No administrator credential or service-role token is permitted.
  store.putConnection({ownerId:owner(req),provider:"supabase",
    account:identity,secret:token,scopes:token.scopes});
  res.redirect(303,"/settings?section=plugins&connection=supabase");
 }));
 router.post("/:provider/disconnect",wrap((req,res)=>{
  if(!CATALOG.some(x=>x.id===req.params.provider))throw fail("Unknown provider",404);
  abortOperations(owner(req),req.params.provider);
  store.removeConnection(owner(req),req.params.provider);
  res.json({revokedLocally:true,provider:req.params.provider,
   note:"Local token removed. Revoke app access at the provider to invalidate upstream authorization."});
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
  const user=owner(req),item=store.getApproval(user,req.params.id);
  if(!item)throw fail("Approval expired or already used",404);
  store.finishApproval(user,item.id,"processing");
  if(req.body.decision==="reject"){
   store.finishApproval(user,item.id,"rejected");return res.json({status:"rejected"});
  }
  try{
   const current=await credentialFor(user,item.provider);
   if(current.generation!==item.generation||sha(JSON.stringify(policy()))!==item.policySignature)
     throw fail("Connection or permissions changed; create a new request",403);
   const result=await execute(user,item.provider,item.request.tool,item.request.args,item.request.source,true);
   store.finishApproval(user,item.id,"approved");res.json({status:"approved",result});
  }catch(error){store.finishApproval(user,item.id,"failed");throw error;}
 }));
 return {router,store,installs,listModelTools,executeModelTool};
}

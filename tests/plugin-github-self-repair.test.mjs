import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";
import {createWorkbenchStore} from "../server/workbench-store.mjs";

test("CIRO local-only fine-grained GitHub credentials and approval-only draft PR",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-self-repair-"));
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_ACCOUNTS_ENABLED:"true",CIRO_DEPLOYMENT_MODE:"single-owner",
  CIRO_GITHUB_FINE_GRAINED_PAT_ENABLED:"true",
  CIRO_GITHUB_REPOS:"ciro/app",CIRO_GITHUB_WRITES:"true",
  CIRO_GITHUB_SELF_REPAIR_ENABLED:"true",CIRO_GITHUB_SELF_REPO:"ciro/app"};
 const token="github_pat_"+("A".repeat(85));
 const provider=[];
 const fetchFn=async(url,options={})=>{
  const request={url:String(url),method:options.method||"GET",body:options.body};
  provider.push(request);
  assert.equal(options.headers.Authorization,"Bearer "+token);
  if(request.url==="https://api.github.com/user")
   return new Response(JSON.stringify({id:1234,login:"ciro-maintainer"}),{status:200});
  if(request.url==="https://api.github.com/repos/ciro/app")
   return new Response(JSON.stringify({full_name:"ciro/app"}),{status:200});
  if(request.url==="https://api.github.com/repos/ciro/app/pulls"){
   assert.equal(request.method,"POST");
   const payload=JSON.parse(request.body);
   assert.equal(payload.draft,true);
   assert.equal(payload.base,"main");
   assert.equal(payload.head,"ciro/self-repair-test");
   assert.equal(payload.maintainer_can_modify,false);
   return new Response(JSON.stringify({number:12,html_url:"https://github.com/ciro/app/pull/12"}),
     {status:201});
  }
  throw Error("Unexpected GitHub request "+request.url);
 };
 const gateway=createPluginGateway({env,dir,fetchFn});
 const intent=gateway.installs.prepare({ownerId:"alice",sessionId:"s-a",id:"github"});
 gateway.installs.install({ownerId:"alice",sessionId:"s-a",id:"github",
  nonce:intent.nonce,fingerprint:intent.fingerprint,confirm:true});
 const policyStore=createWorkbenchStore(dir);
 policyStore.change("test",{},state=>{
  state.policy={mode:"request",repo:"ciro/app",custom:{
   githubRead:true,githubWrite:false,taskExecution:false,recurringTasks:false,externalNetwork:false}};
 });
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{req.principal={mode:"session",id:"alice",sessionId:"s-a"};next();});
 app.use("/api/plugins",gateway.router);
 const server=await new Promise(resolve=>{
  const result=app.listen(0,"127.0.0.1",()=>resolve(result));
 });
 const base="http://127.0.0.1:"+server.address().port;
 async function post(path,body,origin=base){
  const response=await fetch(base+path,{method:"POST",headers:{
   "Content-Type":"application/json","Origin":origin,"Sec-Fetch-Site":"same-origin"},
   body:JSON.stringify(body)});
  return {status:response.status,body:await response.json()};
 }
 try{
  assert.equal((await post("/api/plugins/github/connect-token",{token},"https://untrusted.example")).status,403);
  assert.equal(provider.length,0);
  assert.equal((await post("/api/plugins/github/connect-token",{token:"ghp_"+("A".repeat(90))})).status,400);
  assert.equal(provider.length,0);
  const connected=await post("/api/plugins/github/connect-token",{token});
  assert.equal(connected.status,200,JSON.stringify(connected.body));
  assert.equal(connected.body.login,"ciro-maintainer");
  assert.ok(!JSON.stringify(connected.body).includes(token));
  assert.equal(provider.length,2);
  assert.ok(!readFileSync(join(dir,"plugin-control.sqlite")).includes(Buffer.from(token)));
  assert.ok(gateway.listModelTools("alice").some(x=>x.function.name==="ciro_github_open_pull_request"));
  const invalid=await post("/api/plugins/invoke",{provider:"github",tool:"github.open_pull_request",
   args:{repo:"ciro/app",branch:"main",base:"main",title:"No"}})
  assert.equal(invalid.status,400);
  const proposed=await post("/api/plugins/invoke",{provider:"github",tool:"github.open_pull_request",
   source:"manual",args:{repo:"ciro/app",branch:"ciro/self-repair-test",base:"main",
    title:"Ciro proposes a fix",body:"Human-reviewed source change"}});
  assert.equal(proposed.status,202,JSON.stringify(proposed.body));
  assert.equal(proposed.body.approvalRequired,true);
  assert.equal(provider.length,2);
  const approved=await post("/api/plugins/approvals/"+proposed.body.id,{decision:"approve"});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  assert.equal(approved.body.result.result.url,"https://github.com/ciro/app/pull/12");
  assert.equal(provider.length,3);
  assert.equal((await post("/api/plugins/approvals/"+proposed.body.id,{decision:"approve"})).status,404);
  const disconnected=await post("/api/plugins/github/disconnect",{});
  assert.equal(disconnected.status,200);
  assert.equal(disconnected.body.revokedLocally,true);
  assert.equal(disconnected.body.upstreamRevoked,false);
  assert.equal(gateway.listModelTools("alice").length,0);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  gateway.store.close?.();gateway.installs.close?.();gateway.jobs.close?.();
  rmSync(dir,{recursive:true,force:true});
 }
});

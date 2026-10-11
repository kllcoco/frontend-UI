import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";
import {createWorkbenchRouter} from "../server/workbench.mjs";
import {runPluginChat} from "../server/plugin-chat-runtime.mjs";

test("installed GitHub plugin completes scoped OAuth, model read, human-approved write, revoke and uninstall",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-plugin-real-chain-"));
 const env={
  CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_ACCOUNTS_ENABLED:"true",
  CIRO_PUBLIC_ORIGIN:"https://ciro.example.org",
  CIRO_GITHUB_OAUTH_CLIENT_ID:"ciro-test-client",
  CIRO_GITHUB_OAUTH_CLIENT_SECRET:"ciro-test-client-secret",
  CIRO_GITHUB_REPOS:"demo/repository,demo/other-repository",
  CIRO_GITHUB_WRITES:"true"
 };
 const token="secret-never-expose-me-in-the-marketplace";
 const providerRequests=[];
 const fakeProvider=async(url,options={})=>{
  const value=String(url);
  providerRequests.push({url:value,method:options.method||"GET"});
  if(value==="https://github.com/login/oauth/access_token"){
   const params=new URLSearchParams(options.body);
   assert.equal(params.get("client_secret"),env.CIRO_GITHUB_OAUTH_CLIENT_SECRET);
   assert.equal(params.get("redirect_uri"),env.CIRO_PUBLIC_ORIGIN+"/api/plugins/github/callback");
   return new Response(JSON.stringify({access_token:token,token_type:"bearer",scope:"repo,read:user"}),{status:200});
  }
  if(value==="https://api.github.com/user"){
   assert.equal(options.headers.Authorization,"Bearer "+token);
   return new Response(JSON.stringify({id:12345,login:"scope-test-user"}),{status:200});
  }
  if(value==="https://api.github.com/repos/demo/repository/contents/README.md"){
   assert.equal(options.headers.Authorization,"Bearer "+token);
   return new Response(JSON.stringify({
    type:"file",encoding:"base64",size:5,sha:"a".repeat(40),
    content:Buffer.from("hello").toString("base64")
   }),{status:200});
  }
  if(value==="https://api.github.com/repos/demo/repository/contents/note.txt"&&options.method==="PUT"){
   const payload=JSON.parse(options.body);
   assert.equal(payload.branch,"feature/plugin-sample");
   assert.equal(Buffer.from(payload.content,"base64").toString("utf8"),"approved content");
   return new Response(JSON.stringify({
    content:{sha:"b".repeat(40)},commit:{sha:"c".repeat(40)}
   }),{status:200});
  }
  if(value==="https://api.github.com/applications/ciro-test-client/grant"){
   assert.equal(options.method,"DELETE");
   assert.equal(JSON.parse(options.body).access_token,token);
   return new Response(null,{status:204});
  }
  throw new Error("Unexpected outbound provider call: "+value);
 };
 const gateway=createPluginGateway({env,dir,fetchFn:fakeProvider});
 const workbench=createWorkbenchRouter({env,dir,automaticScheduler:false,fetchFn:fakeProvider});
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{
  req.principal={
   id:req.get("x-test-principal")==="other"?"other":"alice",
   mode:"session",sessionId:req.get("x-test-principal")==="other"?"other-session":"alice-session"
  };
  next();
 });
 app.use("/plugins",gateway.router);
 app.use("/workbench",workbench.router);
 const server=await new Promise(resolve=>{
  const s=app.listen(0,"127.0.0.1",()=>resolve(s));
 });
 const base="http://127.0.0.1:"+server.address().port;
 async function send(path,body,principal="alice"){
  const response=await fetch(base+path,{
   method:body===undefined?"GET":"POST",redirect:"manual",
   headers:{"x-test-principal":principal,
    ...(body===undefined?{}:{"Content-Type":"application/json"})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  return {status:response.status,headers:response.headers,
   body:response.status===303?null:await response.json()};
 }
 try{
  assert.deepEqual((await send("/plugins/catalog")).body.installed,[]);
  assert.equal(gateway.listModelTools("alice").length,0);
  const prepare=await send("/plugins/marketplace/github/prepare",{});
  assert.equal(prepare.status,200);
  assert.equal((await send("/plugins/marketplace/github/install",{
   nonce:prepare.body.nonce,fingerprint:prepare.body.fingerprint,confirm:true
  })).status,201);
  const catalog=(await send("/plugins/catalog")).body;
  assert.deepEqual(catalog.githubScope.allowedRepositories,["demo/repository","demo/other-repository"]);
  assert.equal(catalog.githubScope.oauthConfigured,true);
  assert.equal(catalog.githubScope.selectedRepository,"");
  assert.equal((await send("/workbench/permissions",{
   mode:"request",repo:"demo/repository",custom:catalog.githubScope.custom
  })).status,200);
  assert.equal((await send("/plugins/catalog")).body.githubScope.selectedRepository,"demo/repository");
  assert.equal(gateway.listModelTools("alice").length,0);
  const initiated=await send("/plugins/github/connect",{});
  assert.equal(initiated.status,200);
  const authorize=new URL(initiated.body.authorizeUrl);
  assert.equal(authorize.origin,"https://github.com");
  assert.equal(authorize.searchParams.get("redirect_uri"),
    env.CIRO_PUBLIC_ORIGIN+"/api/plugins/github/callback");
  const validState=authorize.searchParams.get("state");
  const wrong=await send("/plugins/github/callback?"+new URLSearchParams({
   code:"auth-code",state:"wrong"+validState
  }));
  assert.equal(wrong.status,403);
  const callback=await send("/plugins/github/callback?"+new URLSearchParams({
   code:"auth-code",state:validState
  }));
  assert.equal(callback.status,303);
  assert.equal(callback.headers.get("location"),"/?view=plugins&connection=github");
  const connected=(await send("/plugins/catalog")).body;
  assert.equal(connected.connections[0].account.login,"scope-test-user");
  assert.ok(!JSON.stringify(connected).includes(token));
  assert.ok(!readFileSync(join(dir,"plugin-control.sqlite")).toString("utf8").includes(token));
  assert.equal((await send("/plugins/catalog",undefined,"other")).body.connections.length,0);
  assert.equal(gateway.listModelTools("other").length,0);
  assert.ok(gateway.listModelTools("alice").some(x=>x.function.name==="ciro_github_read_file"));
  const denied=await send("/plugins/invoke",{
   provider:"github",tool:"github.read_file",
   args:{repo:"demo/other-repository",path:"README.md"}
  });
  assert.equal(denied.status,403);
  const read=await send("/plugins/invoke",{
   provider:"github",tool:"github.read_file",
   args:{repo:"demo/repository",path:"README.md"}
  });
  assert.equal(read.status,200);
  assert.equal(read.body.result.content,"hello");
  let round=0;
  const modelResult=await runPluginChat({
   payload:{model:"ciro",messages:[{role:"user",content:"读取 README"}]},
   principal:"alice",gateway,upstream:{url:"https://fake-model.invalid/v1/chat/completions"},
   fetchFn:async(_url,options)=>{
    const body=JSON.parse(options.body);
    assert.ok(body.tools.some(x=>x.function.name==="ciro_github_read_file"));
    const next=round++===0?
      {tool_calls:[{id:"read-1",type:"function",function:{
        name:"ciro_github_read_file",
        arguments:JSON.stringify({repo:"demo/repository",path:"README.md"})}}]}:
      {content:"已读取 README"};
    return new Response(JSON.stringify({choices:[{message:next}]}),{status:200});
   }
  });
  assert.equal(modelResult.content,"已读取 README");
  assert.equal(modelResult.toolCalls,1);
  const beforeWrite=providerRequests.filter(x=>x.method==="PUT").length;
  const proposed=await send("/plugins/invoke",{
   provider:"github",tool:"github.write_file",
   args:{repo:"demo/repository",branch:"feature/plugin-sample",path:"note.txt",
    content:"approved content",message:"feat: add plugin sample"}
  });
  assert.equal(proposed.status,202);
  assert.equal(proposed.body.approvalRequired,true);
  assert.equal(providerRequests.filter(x=>x.method==="PUT").length,beforeWrite);
  const approval=await send("/plugins/approvals/"+proposed.body.id,{decision:"approve"});
  assert.equal(approval.status,200,JSON.stringify(approval.body));
  assert.equal(providerRequests.filter(x=>x.method==="PUT").length,beforeWrite+1);
  assert.equal((await send("/plugins/approvals/"+proposed.body.id,{decision:"approve"})).status,404);
  assert.equal((await send("/plugins/installed/github/enabled",{enabled:false})).status,200);
  assert.equal(gateway.listModelTools("alice").length,0);
  assert.equal((await send("/plugins/invoke",{
   provider:"github",tool:"github.read_file",
   args:{repo:"demo/repository",path:"README.md"}
  })).status,403);
  assert.equal((await send("/plugins/installed/github/enabled",{enabled:true})).status,200);
  const removed=await send("/plugins/installed/github/uninstall",{});
  assert.equal(removed.status,200);
  assert.equal(removed.body.upstreamRevoked,true);
  assert.deepEqual((await send("/plugins/catalog")).body.installed,[]);
  assert.equal((await send("/plugins/catalog")).body.connections.length,0);
  assert.equal(gateway.listModelTools("alice").length,0);
  assert.equal((await send("/plugins/invoke",{
   provider:"github",tool:"github.read_file",
   args:{repo:"demo/repository",path:"README.md"}
  })).status,403);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  gateway.jobs.close();gateway.installs.close();gateway.store.close();
  rmSync(dir,{recursive:true,force:true});
 }
});

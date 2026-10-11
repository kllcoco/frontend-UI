import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";

const scratch=()=>mkdtempSync(join(tmpdir(),"ciro-plugins-v08-"));
function fixture(){
 const dir=scratch(),calls=[];
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
   CIRO_GITHUB_REPOS:"example/project",CIRO_GITHUB_WRITES:"true",
   CIRO_ACCOUNTS_ENABLED:"true",
   CIRO_PUBLIC_ORIGIN:"https://ciro.example.com",
   CIRO_GITHUB_OAUTH_CLIENT_ID:"example-client",CIRO_GITHUB_OAUTH_CLIENT_SECRET:"example-secret"};
 const mock=async (url,options={})=>{
  calls.push({url:String(url),options});
  if(String(url)==="https://api.github.com/repos/example/project/contents/README.md")
   return new Response(JSON.stringify({type:"file",encoding:"base64",size:5,
    sha:"a".repeat(40),content:Buffer.from("hello").toString("base64")}),{status:200});
  if(String(url)==="https://api.github.com/repos/example/project/contents/secret")
   throw Error("Forbidden request");
  throw Error("Unexpected outbound request: "+url);
 };
 const runtime=createPluginGateway({env,dir,fetchFn:mock});
 const app=express();app.use(express.json());app.use((req,_res,next)=>{
  req.principal={id:"alice",mode:"session",sessionId:"session-a"};next();
 });app.use("/plugins",runtime.router);
 return {dir,env,calls,runtime,app};
}
async function serve(f){
 const server=await new Promise(resolve=>{const s=f.app.listen(0,"127.0.0.1",()=>resolve(s));});
 const base="http://127.0.0.1:"+server.address().port;
 const call=async (path,body)=>{
  const response=await fetch(base+path,{method:body===undefined?"GET":"POST",
   ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})});
  const raw=await response.text();let json;try{json=JSON.parse(raw);}catch{json=raw;}
  return {status:response.status,json};
 };
 const close=async()=>{await new Promise(resolve=>server.close(resolve));rmSync(f.dir,{recursive:true,force:true});};
 return {call,close};
}
test("GitHub OAuth initiation is session-bound and returns only a provider URL",async()=>{
 const f=fixture(),s=await serve(f);
 try{
  const started=await s.call("/plugins/github/connect",{});
  assert.equal(started.status,200);
  const url=new URL(started.json.authorizeUrl);
  assert.equal(url.origin,"https://github.com");
  assert.equal(url.pathname,"/login/oauth/authorize");
  assert.ok(url.searchParams.get("state"));
  assert.equal(f.runtime.store.get().oauth.length,1);
  assert.ok(!JSON.stringify(f.runtime.store.get()).includes(url.searchParams.get("state")));
 }finally{await s.close();}
});
test("Plugin gateway fails closed and requires a connected principal",async()=>{
 const f=fixture(),s=await serve(f);
 try{
  assert.equal((await s.call("/plugins/invoke",{provider:"github",tool:"github.read_file",
   source:"manual",args:{repo:"example/project",path:"README.md"}})).status,403);
  assert.equal((await s.call("/plugins/invoke",{provider:"supabase",tool:"supabase.call_tool",
   source:"manual",args:{name:"list_tables"}})).status,403);
  assert.equal(f.calls.length,0);
 }finally{await s.close();}
});
test("Connected tool calls respect repository policy and reject revoked access",async()=>{
 const f=fixture(),s=await serve(f);
 try{
  f.runtime.store.putConnection({ownerId:"alice",provider:"github",account:{id:42,login:"example"},
   secret:{accessToken:"private-test-token"},scopes:["repo"]});
  const forbidden=await s.call("/plugins/invoke",{provider:"github",tool:"github.read_file",
   source:"agent",args:{repo:"other/repo",path:"README.md"}});
  assert.equal(forbidden.status,403);
  assert.equal(f.calls.length,0);
  f.runtime.store.removeConnection("alice","github");
  const removed=await s.call("/plugins/invoke",{provider:"github",tool:"github.read_file",
   source:"agent",args:{repo:"example/project",path:"README.md"}});
  assert.equal(removed.status,403);
  assert.equal(f.calls.length,0);
 }finally{await s.close();}
});
test("Write approval is one-shot and binds credential generation and policy",async()=>{
 const f=fixture(),s=await serve(f);
 try{
  f.runtime.store.putConnection({ownerId:"alice",provider:"github",account:{id:42,login:"example"},
   secret:{accessToken:"test-token"},scopes:["repo"]});
  f.runtime.store.get();
  const workbench=(await import("../server/workbench-store.mjs")).createWorkbenchStore(f.dir);
  workbench.change("test.policy",{},state=>{state.policy={mode:"request",repo:"example/project",
   custom:{githubRead:true,githubWrite:false,taskExecution:false,recurringTasks:false,externalNetwork:false}};});
  const request=await s.call("/plugins/invoke",{provider:"github",tool:"github.write_file",
   source:"agent",args:{repo:"example/project",branch:"ciro/test",path:"README.md",
    content:"updated",message:"update README"}});
  assert.equal(request.status,202);
  assert.equal(request.json.approvalRequired,true);
  f.runtime.store.removeConnection("alice","github");
  const after=await s.call("/plugins/approvals/"+request.json.id,{decision:"approve"});
  assert.equal(after.status,404);
  assert.equal(f.calls.length,0);
 }finally{await s.close();}
});

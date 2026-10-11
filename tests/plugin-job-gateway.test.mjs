import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";
import {createWorkbenchStore} from "../server/workbench-store.mjs";

test("durable plugin HTTP jobs isolate users, survive worker restarts and reject revoked grants",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-job-gateway-")),outbound=[];
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_GITHUB_REPOS:"demo/project",CIRO_GITHUB_WRITES:"true",CIRO_ACCOUNTS_ENABLED:"true"};
 const fetchFn=async(url,options)=>{
  outbound.push({url:String(url),method:options.method});
  if(String(url)==="https://api.github.com/repos/demo/project/contents/README.md")
   return new Response(JSON.stringify({type:"file",encoding:"base64",size:5,
    sha:"a".repeat(40),content:Buffer.from("hello").toString("base64")}),{status:200});
  if(String(url)==="https://api.github.com/repos/demo/project/contents/doc.txt"&&options.method==="PUT")
   return new Response(JSON.stringify({content:{sha:"b".repeat(40)},commit:{sha:"c".repeat(40)}}),{status:200});
  throw Error("Unexpected network request: "+url);
 };
 const gw=createPluginGateway({dir,env,fetchFn});
 const wb=createWorkbenchStore(dir);
 wb.change("test.policy",{},s=>{
  s.policy={mode:"full",repo:"demo/project",
   custom:{githubRead:true,githubWrite:true,taskExecution:true,recurringTasks:false,externalNetwork:false}};
 });
 const intent=gw.installs.prepare({ownerId:"alice",sessionId:"session-a",id:"github"});
 gw.installs.install({ownerId:"alice",sessionId:"session-a",id:"github",
  nonce:intent.nonce,fingerprint:intent.fingerprint,confirm:true});
 gw.store.putConnection({ownerId:"alice",provider:"github",account:{id:12,login:"alice"},
  secret:{accessToken:"fake-token"},scopes:["repo"]});
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{const id=req.get("x-test-owner")||"alice";
  req.principal={id,mode:"session",sessionId:id==="alice"?"session-a":"session-b"};next();});
 app.use("/plugins",gw.router);
 const server=await new Promise(resolve=>{const v=app.listen(0,"127.0.0.1",()=>resolve(v));});
 const base="http://127.0.0.1:"+server.address().port+"/plugins";
 async function request(path,body,owner="alice"){
  const response=await fetch(base+path,{method:body===undefined?"GET":"POST",
   headers:{"Content-Type":"application/json","x-test-owner":owner},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json()};
 }
 try{
  const payload={provider:"github",tool:"github.read_file",
   args:{repo:"demo/project",path:"README.md"},idempotencyKey:"read-test-"+randomUUID()};
  const submitted=await request("/jobs",payload);
  assert.equal(submitted.status,202);
  assert.equal(submitted.body.status,"queued");
  assert.equal((await request("/jobs",payload)).body.duplicate,true);
  assert.equal((await request("/jobs",payload,"bob")).status,403);
  assert.deepEqual((await request("/jobs",undefined,"bob")).body.jobs,[]);
  assert.equal(outbound.length,0);
  const first=await gw.runNextJob({workerId:randomUUID()});
  assert.equal(first.status,"succeeded");
  const completed=await request("/jobs/"+submitted.body.id);
  assert.equal(completed.body.result.content,"hello");
  assert.equal(outbound.length,1);
  // Restart the queue connection, not the HTTP app, and confirm the receipt persists.
  const {createPluginJobQueue}=await import("../server/plugin-job-queue.mjs");
  const external=createPluginJobQueue({dir,env});
  try{assert.equal(external.get("alice",submitted.body.id).result.content,"hello");}
  finally{external.close();}
  const second=await request("/jobs",{...payload,idempotencyKey:"read-test-"+randomUUID()});
  assert.equal(second.status,202);
  gw.installs.setEnabled("alice","github",false);
  const denied=await gw.runNextJob({workerId:randomUUID()});
  assert.equal(denied.status,"failed");
  assert.equal(outbound.length,1);
  gw.installs.setEnabled("alice","github",true);
  const write=await request("/invoke",{provider:"github",tool:"github.write_file",
   args:{repo:"demo/project",branch:"feature/approved",path:"doc.txt",
    content:"authorized",message:"Test approval ledger"}});
  assert.equal(write.status,202);
  assert.equal(write.body.approvalRequired,true);
  assert.equal(outbound.length,1);
  const approved=await request("/approvals/"+write.body.id,{decision:"approve"});
  assert.equal(approved.status,200,JSON.stringify(approved.body));
  assert.equal(approved.body.status,"approved");
  assert.equal(outbound.length,2);
  const ledger=(await request("/jobs")).body.jobs.find(x=>x.approvalId===write.body.id);
  assert.equal(ledger.status,"succeeded");
  assert.equal(ledger.effect,true);
  assert.equal((await request("/approvals/"+write.body.id,{decision:"approve"})).status,404);
  assert.equal(outbound.length,2);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  gw.jobs.close();gw.store.close();gw.installs.close();
  rmSync(dir,{recursive:true,force:true});
 }
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";
import {createWorkbenchStore} from "../server/workbench-store.mjs";

test("reinstall cannot resurrect a credential left behind by an interrupted uninstall",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-install-epoch-"));
 let outbound=0;
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_GITHUB_REPOS:"demo/project",CIRO_GITHUB_WRITES:"false"};
 const gateway=createPluginGateway({dir,env,fetchFn:async()=>{outbound++;throw Error("Unexpected network");}});
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{req.principal={id:"alice",sessionId:"alice-1",mode:"session"};next();});
 app.use("/api/plugins",gateway.router);
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const base="http://127.0.0.1:"+server.address().port+"/api/plugins";
 const install=()=>{
  const intent=gateway.installs.prepare({ownerId:"alice",sessionId:"alice-1",id:"github"});
  return gateway.installs.install({ownerId:"alice",sessionId:"alice-1",id:"github",
   nonce:intent.nonce,fingerprint:intent.fingerprint,confirm:true});
 };
 try{
  const first=install();
  gateway.store.putConnection({ownerId:"alice",provider:"github",account:{login:"alice"},
   secret:{accessToken:"test-value"},scopes:["repo"]});
  assert.equal(gateway.store.connection("alice","github").installationId,first.installationId);
  createWorkbenchStore(dir).change("policy",{},state=>{
   state.policy={mode:"request",repo:"demo/project",
    custom:{githubRead:true,githubWrite:false,taskExecution:false,recurringTasks:false,externalNetwork:false}};
  });
  // Simulate process crash between removing installation and removing OAuth record.
  gateway.installs.uninstall("alice","github");
  const second=install();
  assert.notEqual(first.installationId,second.installationId);
  assert.deepEqual(gateway.listModelTools("alice"),[]);
  const response=await fetch(base+"/invoke",{method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({provider:"github",tool:"github.read_file",
    args:{repo:"demo/project",path:"README.md"}})});
  assert.equal(response.status,403);
  const reply=await response.json();
  assert.match(reply.error,/reconnect|installation changed/i);
  assert.equal(outbound,0);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  gateway.close();rmSync(dir,{recursive:true,force:true});
 }
});

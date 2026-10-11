import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";

test("marketplace HTTP lifecycle requires deliberate installation, and removal immediately blocks tool calls",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"ciro-v08-http-"));
  const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
    CIRO_GITHUB_REPOS:"demo/project",CIRO_GITHUB_WRITES:"false"};
  const gateway=createPluginGateway({dir,env});
  const app=express();
  app.use(express.json());
  app.use((req,_res,next)=>{
    req.principal={id:req.get("x-test-user")||"alice",
      mode:"session",sessionId:req.get("x-test-session")||"sess-alice"};
    next();
  });
  app.use("/api/plugins",gateway.router);
  const listener=await new Promise(resolve=>{
    const server=app.listen(0,"127.0.0.1",()=>resolve(server));
  });
  const origin="http://127.0.0.1:"+listener.address().port;
  async function request(path,body,headers={}){
    const response=await fetch(origin+"/api/plugins"+path,{
      method:body===undefined?"GET":"POST",
      headers:{"Content-Type":"application/json",...headers},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    return {status:response.status,body:await response.json()};
  }
  try{
    const empty=await request("/catalog");
    assert.equal(empty.status,200);
    assert.deepEqual(empty.body.installed,[]);
    const bad=await request("/marketplace/github/install",{confirm:true});
    assert.equal(bad.status,403);
    const prepare=await request("/marketplace/github/prepare",{});
    assert.equal(prepare.status,200);
    const payload={nonce:prepare.body.nonce,fingerprint:prepare.body.fingerprint,confirm:true};
    assert.equal((await request("/marketplace/github/install",payload,{"x-test-user":"bob"})).status,403);
    assert.equal((await request("/marketplace/github/install",payload,{"x-test-session":"other"})).status,403);
    assert.equal((await request("/marketplace/github/install",payload)).status,201);
    assert.equal((await request("/marketplace/github/install",payload)).status,403);
    assert.equal((await request("/catalog")).body.installed[0].id,"github");
    assert.deepEqual((await request("/catalog",undefined,{"x-test-user":"bob"})).body.installed,[]);
    assert.equal((await request("/installed/github/enabled",{enabled:false})).body.enabled,false);
    assert.equal((await request("/installed/github/enabled",{enabled:true})).body.enabled,true);
    assert.equal((await request("/invoke",{provider:"github",tool:"github.read_file",
      source:"agent",args:{repo:"demo/project",path:"README.md"}})).status,403);
    assert.equal((await request("/installed/github/uninstall",{})).status,200);
    assert.deepEqual((await request("/catalog")).body.installed,[]);
    assert.equal((await request("/invoke",{provider:"github",tool:"github.read_file",
      args:{repo:"demo/project",path:"README.md"}})).status,403);
  }finally{
    await new Promise(resolve=>listener.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }
});


test("Full Access still forces human approval and shows exact GitHub operation",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-review-"));
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
   CIRO_GITHUB_REPOS:"demo/project",CIRO_GITHUB_WRITES:"true"};
 const outbound=[];
 const gateway=createPluginGateway({dir,env,fetchFn:async(...args)=>{
   outbound.push(args);throw Error("No external GitHub call expected before approval");
 }});
 const {createWorkbenchStore}=await import("../server/workbench-store.mjs");
 const workbench=createWorkbenchStore(dir);
 workbench.change("test.full",{repo:"demo/project"},s=>{
  s.policy={mode:"full",repo:"demo/project",
   custom:{githubRead:true,githubWrite:true,taskExecution:true,recurringTasks:false,externalNetwork:true}};
 });
 const app=express();
 app.use(express.json());
 app.use((_req,_res,next)=>{_req.principal={id:"alice",mode:"session",sessionId:"sess-1"};next();});
 app.use("/plugins",gateway.router);
 const server=await new Promise(resolve=>{
  const value=app.listen(0,"127.0.0.1",()=>resolve(value));
 });
 try{
  const root="http://127.0.0.1:"+server.address().port;
  const post=async(path,body)=>{
   const response=await fetch(root+path,{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
   });
   return {status:response.status,body:await response.json()};
  };
  const request=await post("/plugins/marketplace/github/prepare",{});
  assert.equal(request.status,200);
  assert.equal((await post("/plugins/marketplace/github/install",{
   nonce:request.body.nonce,fingerprint:request.body.fingerprint,confirm:true
  })).status,201);
  gateway.store.putConnection({ownerId:"alice",provider:"github",
   account:{id:100,login:"test"},secret:{accessToken:"fake-test-token"},scopes:["repo"]});
  const write=await post("/plugins/invoke",{provider:"github",tool:"github.write_file",
   args:{repo:"demo/project",branch:"feature/review-only",path:"README.md",
    content:"secret contents",message:"review this change"}});
  assert.equal(write.status,202);
  assert.equal(write.body.approvalRequired,true);
  assert.equal(outbound.length,0);
  const list=await fetch(root+"/plugins/catalog").then(r=>r.json());
  const summary=list.approvals.find(x=>x.id===write.body.id).summary;
  assert.match(summary,/demo\/project/);
  assert.match(summary,/feature\/review-only/);
  assert.match(summary,/README\.md/);
  assert.doesNotMatch(summary,/secret contents/);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});

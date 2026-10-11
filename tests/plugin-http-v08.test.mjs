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

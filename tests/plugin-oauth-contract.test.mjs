import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";

test("GitHub OAuth callback is session-bound, one-shot, and revoke removes a verified grant",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-oauth-contract-"));
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_ACCOUNTS_ENABLED:"true",CIRO_GITHUB_OAUTH_CLIENT_ID:"ciro-test-client",
  CIRO_GITHUB_OAUTH_CLIENT_SECRET:"non-production-test-secret",
  CIRO_PUBLIC_ORIGIN:"https://ciro.example.test",CIRO_GITHUB_REPOS:"demo/repo"};
 const calls=[];
 const fetchFn=async (url,options={})=>{
  calls.push({url:String(url),method:options.method||"GET"});
  if(url==="https://github.com/login/oauth/access_token")
   return new Response(JSON.stringify({access_token:"mock-credential",scope:"repo,read:user"}),{status:200});
  if(url==="https://api.github.com/user")
   return new Response(JSON.stringify({id:789,login:"test-github-user"}),{status:200});
  if(url==="https://api.github.com/applications/ciro-test-client/grant")
   return new Response(null,{status:204});
  throw new Error("Unexpected network request");
 };
 const gateway=createPluginGateway({env,dir,fetchFn});
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{
  req.principal={id:req.get("x-principal-id")||"alice",mode:"session",
   sessionId:req.get("x-browser-session")||"alice-session"};next();
 });
 app.use("/plugins",gateway.router);
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const origin="http://127.0.0.1:"+server.address().port;
 async function call(path,{method="GET",body,principal="alice",session="alice-session"}={}){
  const response=await fetch(origin+path,{method,redirect:"manual",headers:{
   "Content-Type":"application/json","x-principal-id":principal,"x-browser-session":session
  },...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text();
  return {status:response.status,location:response.headers.get("location"),
   value:text&&text.startsWith("{")?JSON.parse(text):text};
 }
 try{
  const pre=await call("/plugins/marketplace/github/prepare",{method:"POST",body:{}});
  assert.equal(pre.status,200);
  const install=await call("/plugins/marketplace/github/install",{
   method:"POST",body:{nonce:pre.value.nonce,fingerprint:pre.value.fingerprint,confirm:true}});
  assert.equal(install.status,201);
  const auth=await call("/plugins/github/connect",{method:"POST",body:{}});
  assert.equal(auth.status,200);
  const state=new URL(auth.value.authorizeUrl).searchParams.get("state");
  assert.ok(state);
  const other=await call("/plugins/github/callback?code=test&state="+state,{session:"other-session"});
  assert.equal(other.status,403);
  const completed=await call("/plugins/github/callback?code=test&state="+state);
  assert.equal(completed.status,303);
  assert.equal(completed.location,"/?view=plugins&connection=github");
  assert.equal(gateway.store.publicConnections("alice")[0].account.login,"test-github-user");
  assert.equal(gateway.store.publicConnections("bob").length,0);
  const replay=await call("/plugins/github/callback?code=test&state="+state);
  assert.equal(replay.status,403);
  const revoked=await call("/plugins/github/disconnect",{method:"POST",body:{}});
  assert.equal(revoked.status,200);
  assert.equal(revoked.value.revokedLocally,true);
  assert.equal(revoked.value.upstreamRevoked,true);
  assert.equal(gateway.store.publicConnections("alice").length,0);
  assert.equal(calls.filter(x=>x.url.includes("/login/oauth/access_token")).length,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  gateway.store.close?.();gateway.installs.close?.();
  rmSync(dir,{recursive:true,force:true});
 }
});

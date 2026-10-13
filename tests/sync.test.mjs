import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createAccountService} from "../server/account.mjs";

const env={CIRO_ACCOUNTS_ENABLED:"true",CIRO_BOOTSTRAP_TOKEN:"bootstrap-secret-of-32-characters-long",
  CIRO_API_KEY_PEPPER:"api-key-hmac-pepper-more-than-24-bytes",CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64")};

async function setup(){
  const dir=mkdtempSync(join(tmpdir(),"ciro-sync-test-"));
  const service=createAccountService({env,dir});
  const app=express();app.use(express.json({limit:"25mb"}));
  app.use("/api/account",service.router);
  const server=await new Promise(r=>{const l=app.listen(0,"127.0.0.1",()=>r(l));});
  const url="http://127.0.0.1:"+server.address().port;
  let cookie="",csrf="";
  async function call(path,{method="GET",body,auth=true}={}){
    const headers={};if(auth&&cookie)headers.Cookie=cookie;if(auth&&csrf&&method!=="GET")headers["X-Ciro-Csrf"]=csrf;
    if(body)headers["Content-Type"]="application/json";
    const r=await fetch(url+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,json:await r.json().catch(()=>null),headers:r.headers};
  }
  const b=await call("/api/account/bootstrap",{method:"POST",auth:false,body:{bootstrapToken:env.CIRO_BOOTSTRAP_TOKEN,
    email:"o@example.com",displayName:"O",password:"a-very-secure-long-password"}});
  cookie=b.headers.get("set-cookie").split(";")[0];csrf=b.json.csrf;
  return {call,dir,anon:p=>call(p,{auth:false}),close:async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};
}
const conv=(id,mtime,title)=>({kind:"conversation",id,mtime,deleted:false,data:{id,title,updatedAt:mtime,createdAt:1,messages:[]}});

test("sync v2 pulls incrementally, keeps newer edits and propagates deletions",async()=>{
  const ctx=await setup();
  try{
    assert.equal((await ctx.anon("/api/account/sync/v2/changes?since=0")).status,401);
    const first=await ctx.call("/api/account/sync/v2/push",{method:"POST",body:{items:[conv("a",100,"A"),conv("b",100,"B")]}});
    assert.equal(first.status,200);assert.equal(first.json.accepted.length,2);assert.equal(first.json.count,2);
    const all=await ctx.call("/api/account/sync/v2/changes?since=0");
    assert.deepEqual(all.json.items.map(x=>x.data.title),["A","B"]);
    const since=all.json.rev;
    // A stale edit (older mtime) is rejected and the server copy is returned.
    const stale=await ctx.call("/api/account/sync/v2/push",{method:"POST",body:{items:[conv("a",50,"old A")]}});
    assert.equal(stale.json.accepted.length,0);assert.equal(stale.json.rejected[0].data.title,"A");
    // A newer edit and a deletion arrive incrementally.
    await ctx.call("/api/account/sync/v2/push",{method:"POST",body:{items:[conv("a",200,"A2 plaintext-marker-7f3e9c"),{kind:"conversation",id:"b",mtime:200,deleted:true}]}});
    const delta=await ctx.call("/api/account/sync/v2/changes?since="+since);
    assert.deepEqual(delta.json.items.map(x=>[x.id,x.deleted,x.data?.title??null]),[["a",false,"A2 plaintext-marker-7f3e9c"],["b",true,null]]);
    assert.equal(delta.json.count,1);
    // Stored encrypted at rest.
    const raw=readdirSync(ctx.dir).filter(f=>f.startsWith("sync.sqlite")).map(f=>readFileSync(join(ctx.dir,f),"latin1")).join("");
    // A long marker: short strings can appear in ciphertext by chance.
    assert.ok(!raw.includes("plaintext-marker-7f3e9c"));
    // Bad input is rejected.
    assert.equal((await ctx.call("/api/account/sync/v2/push",{method:"POST",body:{items:[{kind:"secret",id:"x",mtime:1,deleted:false,data:{}}]}})).status,400);
  }finally{await ctx.close();}
});

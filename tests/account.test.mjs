import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes,createHmac} from "node:crypto";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createAccountService,sealJSON,unsealJSON,verifyStripeEvent} from "../server/account.mjs";
import {createWorkbenchStore} from "../server/workbench-store.mjs";
import {createCommercialRouter} from "../server/commercial.mjs";
import {publicSpending,authorizeSpend} from "../server/spending.mjs";

const key=randomBytes(32).toString("base64");
const env=()=>({
  CIRO_ACCOUNTS_ENABLED:"true",
  CIRO_BOOTSTRAP_TOKEN:"bootstrap-secret-of-32-characters-long",
  CIRO_API_KEY_PEPPER:"api-key-hmac-pepper-more-than-24-bytes",
  CIRO_ACCOUNT_DATA_KEY:key,
  CIRO_BILLING_EVENT_SECRET:"account-test-billing-signature-long",
  CIRO_BILLING_CWU_USD_PER_MILLION:"3",
  CIRO_BILLING_GWU_USD_PER_MILLION:"3"
});
const boot={bootstrapToken:"bootstrap-secret-of-32-characters-long",
  email:"builder@example.com",displayName:"Ciro Owner",password:"a-very-secure-long-password"};
async function setup(config=env(),mock=fetch){
  const dir=mkdtempSync(join(tmpdir(),"ciro-account-test-"));
  const instance=createAccountService({env:config,dir,fetchFn:mock});
  const app=express();
  app.use(express.json({verify:(req,_res,body)=>{req.rawBody=Buffer.from(body);}}));
  app.use("/api/account",instance.router);
  app.use("/api",instance.guard);
  app.post("/api/chat",(_req,res)=>res.json({authorized:true}));
  app.get("/api/workbench/state",(_req,res)=>res.json({authorized:true}));
  const wbStore=createWorkbenchStore(dir);
  const commerce=createCommercialRouter({env:config,store:wbStore,notify:instance.notify});
  app.use("/api/workbench/commercial",commerce.router);
  const server=await new Promise(resolve=>{
    const l=app.listen(0,"127.0.0.1",()=>resolve(l));
  });
  const url="http://127.0.0.1:"+server.address().port;
  let cookie="",csrf="";
  async function request(path,{method="GET",body,auth=true,headers={},raw}={}){
    const extra={...headers};
    if(auth&&cookie)extra.Cookie=cookie;
    if(auth&&csrf&&!["GET","HEAD"].includes(method))extra["X-Ciro-Csrf"]=csrf;
    let text=raw;
    if(text===undefined&&body!==undefined)text=JSON.stringify(body);
    if(text!==undefined)extra["Content-Type"]="application/json";
    const response=await fetch(url+path,{method,headers:extra,...(text===undefined?{}:{body:text})});
    const json=await response.json().catch(()=>null);
    return {status:response.status,json,headers:response.headers};
  }
  async function bootstrap(){
    const r=await request("/api/account/bootstrap",{method:"POST",body:boot,auth:false});
    if(r.status!==201)throw new Error("Bootstrap failed "+JSON.stringify(r));
    cookie=r.headers.get("set-cookie")?.split(";")[0]||"";
    csrf=r.json.csrf;return r;
  }
  return {request,bootstrap,service:instance,store:wbStore,dir,config,
    setSession:(c,t)=>{cookie=c;csrf=t;},getSession:()=>({cookie,csrf}),
    close:async()=>{await new Promise(resolve=>server.close(resolve));rmSync(dir,{force:true,recursive:true});}};
}
test("disabled accounts report honest local-only mode and reject registration",async()=>{
  const ctx=await setup({...env(),CIRO_ACCOUNTS_ENABLED:"false"});
  try{
    const status=await ctx.request("/api/account/session");
    assert.equal(status.json.enabled,false);
    assert.equal(status.json.authenticated,false);
    assert.equal((await ctx.request("/api/account/bootstrap",{method:"POST",auth:false,body:boot})).status,503);
  }finally{await ctx.close();}
});
test("single-owner bootstrap has durable salted password and secure session, no second registration",async()=>{
  const ctx=await setup();
  try{
    assert.equal((await ctx.request("/api/workbench/state",{auth:false})).status,401);
    await ctx.bootstrap();
    assert.equal((await ctx.request("/api/workbench/state")).status,200);
    assert.equal((await ctx.request("/api/account/bootstrap",{method:"POST",body:boot,auth:false})).status,409);
    const disk=readFileSync(join(ctx.dir,"account-state.json"),"utf8");
    assert.ok(!disk.includes(boot.password));
    assert.ok(!disk.includes(ctx.getSession().cookie.split("=")[1]));
    assert.match(disk,/"passwordHash"/);
    assert.equal((await ctx.request("/api/account/session")).json.user.email,boot.email);
    assert.equal((await ctx.request("/api/account/login",{method:"POST",auth:false,body:{email:boot.email,password:"wrong"}})).status,401);
  }finally{await ctx.close();}
});
test("CSRF and cross-site origins cannot mutate scoped account APIs",async()=>{
  const ctx=await setup();
  try{
    await ctx.bootstrap();
    const csrf=ctx.getSession().csrf;ctx.setSession(ctx.getSession().cookie,"");
    assert.equal((await ctx.request("/api/account/profile",{method:"POST",body:{displayName:"evil"}})).status,403);
    ctx.setSession(ctx.getSession().cookie,csrf);
    assert.equal((await ctx.request("/api/account/profile",{method:"POST",body:{displayName:"safe"},headers:{origin:"https://evil.example"}})).status,403);
    assert.equal((await ctx.request("/api/account/profile",{method:"POST",body:{displayName:"Ciro Builder"}})).json.user.displayName,"Ciro Builder");
  }finally{await ctx.close();}
});
test("scoped API keys work once, revoke immediately, never administer account",async()=>{
  const ctx=await setup();
  try{
    await ctx.bootstrap();
    const created=await ctx.request("/api/account/api-keys",{method:"POST",body:{name:"agent",scopes:["chat:invoke"],expiresDays:30}});
    assert.equal(created.status,201);
    assert.match(created.json.key,/^ciro_sk_/);
    const raw=created.json.key,id=created.json.record.id;
    assert.equal((await ctx.request("/api/chat",{method:"POST",body:{},auth:false,headers:{Authorization:"Bearer "+raw}})).status,200);
    assert.equal((await ctx.request("/api/workbench/state",{auth:false,headers:{Authorization:"Bearer "+raw}})).status,403);
    assert.equal((await ctx.request("/api/account/api-keys",{auth:false,headers:{Authorization:"Bearer "+raw}})).status,403);
    assert.ok(!readFileSync(join(ctx.dir,"account-state.json"),"utf8").includes(raw));
    assert.equal((await ctx.request("/api/account/api-keys/"+id+"/revoke",{method:"POST",body:{}})).status,200);
    assert.equal((await ctx.request("/api/chat",{method:"POST",body:{},auth:false,headers:{Authorization:"Bearer "+raw}})).status,401);
    assert.equal((await ctx.request("/api/account/api-keys",{method:"POST",body:{name:"unsafe",scopes:["root"],expiresDays:365}})).status,400);
  }finally{await ctx.close();}
});
test("password change ends other sessions and revokes all API keys",async()=>{
  const ctx=await setup();
  try{
    await ctx.bootstrap();const original=ctx.getSession();
    const other=await ctx.request("/api/account/login",{method:"POST",auth:false,body:{email:boot.email,password:boot.password}});
    const otherCookie=other.headers.get("set-cookie").split(";")[0];
    const created=await ctx.request("/api/account/api-keys",{method:"POST",body:{name:"cli",scopes:["chat:invoke"]}});
    assert.equal((await ctx.request("/api/account/password",{method:"POST",body:{
      currentPassword:boot.password,newPassword:"different-very-long-password"
    }})).status,200);
    ctx.setSession(otherCookie,other.json.csrf);
    assert.equal((await ctx.request("/api/account/profile")).status,401);
    ctx.setSession(original.cookie,original.csrf);
    const keys=await ctx.request("/api/account/api-keys");
    assert.ok(keys.json.keys.every(k=>Boolean(k.revokedAt)));
  }finally{await ctx.close();}
});
test("memory is consent-gated, encrypted on disk and can be deleted",async()=>{
  const ctx=await setup();
  try{
    await ctx.bootstrap();
    const phrase="Never invent final acceptance for CIRO";
    assert.equal((await ctx.request("/api/account/memories",{method:"POST",body:{content:phrase,category:"project"}})).status,201);
    assert.equal(ctx.service.memoryContext({get:()=>"",headers:{cookie:ctx.getSession().cookie}}),"");
    const toggle=await ctx.request("/api/account/memories/preferences",{method:"POST",body:{enabled:true}});
    assert.equal(toggle.json.enabled,true);
    const result=await ctx.request("/api/account/memories");
    assert.equal(result.json.memories[0].content,phrase);
    const disk=readFileSync(join(ctx.dir,"account-state.json"),"utf8");
    assert.ok(!disk.includes(phrase));
    assert.equal((await ctx.request("/api/account/memories/"+result.json.memories[0].id,{method:"DELETE"})).json.deleted,true);
    assert.equal((await ctx.request("/api/account/memories")).json.memories.length,0);
  }finally{await ctx.close();}
});
test("AES-256-GCM envelope needs correct key and authenticated data",()=>{
  const e=env(),c=sealJSON({foo:"private"},e,"ciro-sync:owner");
  assert.deepEqual(unsealJSON(c,e,"ciro-sync:owner"),{foo:"private"});
  assert.throws(()=>unsealJSON(c,e,"ciro-sync:other"));
  assert.throws(()=>sealJSON({foo:"private"},{...e,CIRO_ACCOUNT_DATA_KEY:""},"test"),/key/i);
});
test("sync is real versioned encrypted CAS: stale clients cannot overwrite newer state",async()=>{
  const ctx=await setup();
  try{
    await ctx.bootstrap();
    const remote=await ctx.request("/api/account/sync");
    assert.equal(remote.json.version,0);
    const snapshot={conversations:[{id:"one",title:"secret-project",createdAt:5,updatedAt:7,
      messages:[{id:"msg",role:"user",content:"TOP SECRET DESIGN",createdAt:5}]}],
      activeId:"one",preferences:{theme:"light",language:"zh-CN"}};
    const saved=await ctx.request("/api/account/sync",{method:"PUT",body:{baseVersion:0,snapshot}});
    assert.equal(saved.status,200);assert.equal(saved.json.version,1);
    const conflict=await ctx.request("/api/account/sync",{method:"PUT",body:{baseVersion:0,snapshot}});
    assert.equal(conflict.status,409);assert.equal(conflict.json.currentVersion,1);
    const restored=await ctx.request("/api/account/sync");
    assert.deepEqual(restored.json.snapshot,snapshot);
    assert.ok(!readFileSync(join(ctx.dir,"account-state.json"),"utf8").includes("TOP SECRET DESIGN"));
  }finally{await ctx.close();}
});
test("notifications persist and support individual and batch read receipts",async()=>{
  const ctx=await setup();
  try{
    await ctx.bootstrap();
    ctx.service.notify({type:"warning",title:"Budget exceeded",body:"Stop further new jobs."});
    const listed=await ctx.request("/api/account/notifications");
    assert.equal(listed.json.unread,1);
    assert.equal(listed.json.notifications[0].title,"Budget exceeded");
    const id=listed.json.notifications[0].id;
    assert.equal((await ctx.request("/api/account/notifications/"+id+"/read",{method:"POST",body:{}})).status,200);
    assert.equal((await ctx.request("/api/account/notifications")).json.unread,0);
  }finally{await ctx.close();}
});
test("Stripe checkout uses actual secure external endpoint, never fakes paid status",async()=>{
  const calls=[];
  const config={...env(),CIRO_STRIPE_SECRET_KEY:"sk_test_long_testing_key_not_real","CIRO_STRIPE_PRICE_ID":"price_abc",
    CIRO_STRIPE_WEBHOOK_SECRET:"whsec_signing_important_long_value",
    CIRO_PUBLIC_ORIGIN:"https://ciro.example.com"};
  const mock=async(url,opts)=>{
    calls.push({url,opts});
    return new Response(JSON.stringify({id:"cs_test_abc",url:"https://checkout.stripe.com/c/pay/test_value"}),{status:200});
  };
  const ctx=await setup(config,mock);
  try{
    await ctx.bootstrap();
    const status=await ctx.request("/api/account/profile");
    assert.equal(status.json.subscription.status,"not_connected");
    assert.equal(status.json.subscription.configured,true);
    const reply=await ctx.request("/api/account/subscription/checkout",{method:"POST",body:{}});
    assert.equal(reply.status,200);
    assert.match(reply.json.url,/^https:\/\/checkout\.stripe\.com/);
    assert.equal(calls[0].url,"https://api.stripe.com/v1/checkout/sessions");
    assert.match(calls[0].opts.body,/line_items%5B0%5D%5Bprice%5D=price_abc/);
    assert.equal((await ctx.request("/api/account/profile")).json.subscription.status,"not_connected");
  }finally{await ctx.close();}
});
test("Stripe spoofed webhook fails; signed checkout and subscription events update verified state",async()=>{
  const cfg={...env(),CIRO_STRIPE_SECRET_KEY:"sk_test_long_testing_key_not_real",CIRO_STRIPE_PRICE_ID:"price_abc",
    CIRO_STRIPE_WEBHOOK_SECRET:"whsec_demo_real_test_long_secret",CIRO_PUBLIC_ORIGIN:"https://ciro.example.com"};
  const ctx=await setup(cfg);
  try{
    await ctx.bootstrap();
    const ownerId=ctx.service.store.get().owner.id;
    const a={id:"evt_checkout_1",type:"checkout.session.completed",data:{object:{
      client_reference_id:ownerId,customer:"cus_abc",subscription:"sub_abc"}}};
    async function webhook(body,sign=true){
      const raw=JSON.stringify(body),timestamp=Math.floor(Date.now()/1000);
      const sig=createHmac("sha256",cfg.CIRO_STRIPE_WEBHOOK_SECRET).update(timestamp+"."+raw).digest("hex");
      return ctx.request("/api/account/subscription/webhook",{method:"POST",raw,auth:false,
        headers:sign?{"stripe-signature":"t="+timestamp+",v1="+sig}:{}});
    }
    assert.equal((await webhook(a,false)).status,401);
    assert.equal((await webhook(a,true)).json.applied,true);
    const b={id:"evt_sub_1",type:"customer.subscription.updated",data:{object:{
      customer:"cus_abc",id:"sub_abc",status:"active",current_period_end:1799011200,cancel_at_period_end:false}}};
    assert.equal((await webhook(b)).json.applied,true);
    assert.equal((await webhook(b)).json.duplicate,true);
    const status=(await ctx.request("/api/account/profile")).json.subscription;
    assert.equal(status.status,"active");
    assert.equal(status.provider,"stripe");
  }finally{await ctx.close();}
});
test("spending reservation denies unmetered and limits per call, per day, monthly",()=>{
  const ctx=createWorkbenchStore(mkdtempSync(join(tmpdir(),"spend-")));
  const s=ctx.get();
  s.commercial.spending={dailyLimitMicros:5000000,monthlyLimitMicros:8000000,
    singleRequestLimitMicros:3500000,reservations:[]};
  const e=env();
  const a=authorizeSpend(s,e,{reservationId:"reserve-unit-001",estimatedCostUsd:"3"});
  assert.equal(a.reservation.amountMicros,3000000);
  assert.equal(a.duplicate,false);
  s.commercial.spending.reservations.push(a.reservation);
  assert.equal(authorizeSpend(s,e,{reservationId:"reserve-unit-001",estimatedCostUsd:"3"}).duplicate,true);
  assert.throws(()=>authorizeSpend(s,e,{reservationId:"reserve-unit-002",estimatedCostUsd:"4"}),/single request/);
  assert.throws(()=>authorizeSpend(s,e,{reservationId:"reserve-unit-003",estimatedCostUsd:"3"}),/daily/);
  assert.equal(publicSpending(s).reservedCount,1);
  assert.throws(()=>authorizeSpend(s,{...e,CIRO_BILLING_CWU_USD_PER_MILLION:""},{
    reservationId:"reserve-unit-004",estimatedCostUsd:"1"
  }),/without signed metering/);
});

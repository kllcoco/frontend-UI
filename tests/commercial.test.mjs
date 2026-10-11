import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkbenchStore } from "../server/workbench-store.mjs";
import { createCommercialRouter } from "../server/commercial.mjs";
import { catalogSnapshot,selectedSkills } from "../server/commercial-catalog.mjs";
import {
  parseUsdToMicros,pricedEvent,validateUsageEvent,
  usageSummary,assertBudgetAdmission,receiptCsv
} from "../server/commercial-billing.mjs";

const secret="local-meter-secret-longer-than-24-characters";
const baseEnv={
  CIRO_BILLING_EVENT_SECRET:secret,
  CIRO_BILLING_CWU_USD_PER_MILLION:"3",
  CIRO_BILLING_GWU_USD_PER_MILLION:"3"
};
function scratch(){return mkdtempSync(join(tmpdir(),"ciro-commercial-"));}
async function setup(env={...baseEnv}){
  const dir=scratch();
  const store=createWorkbenchStore(dir);
  const {router}=createCommercialRouter({env,store});
  const app=express();
  app.use(express.json({verify:(req,_res,buf)=>{req.rawBody=Buffer.from(buf);}}));
  app.use("/api/workbench/commercial",router);
  const server=await new Promise(resolve=>{
    const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));
  });
  const root="http://127.0.0.1:"+server.address().port+"/api/workbench/commercial";
  async function api(path,body,opts={}){
    const raw=typeof body==="string"?body:JSON.stringify(body??{});
    const headers={"Content-Type":"application/json",...(opts.headers||{})};
    if(opts.signed){
      const stamp=opts.stamp||String(Date.now());
      headers["x-ciro-timestamp"]=stamp;
      headers["x-ciro-signature"]=createHmac("sha256",env.CIRO_BILLING_EVENT_SECRET||secret).update(stamp).update(".").update(raw).digest("hex");
    }
    const response=await fetch(root+path,{
      method:body===undefined?"GET":"POST",headers,
      ...(body===undefined?{}:{body:raw})
    });
    const text=await response.text();
    let result;try{result=JSON.parse(text);}catch{result=text;}
    return {code:response.status,data:result};
  }
  return {api,store,dir,env,close:async()=>{
    await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});
  }};
}
function event(overrides={}){
  return {
    eventId:"evt-"+Date.now()+"-001",unit:"CWU",category:"chat",
    units:1000000,model:"ciro",receiptSha256:"a".repeat(64),
    observedAt:new Date().toISOString(),...overrides
  };
}
test("empty billing never presents fictional costs, invoice data or payment provider",async()=>{
  const ctx=await setup();
  try{
    const r=await ctx.api("/state");
    assert.equal(r.code,200);
    assert.equal(r.data.billing.eventsCount,0);
    assert.equal(r.data.billing.totalEstimatedMicros,null);
    assert.equal(r.data.billing.isActualInvoice,false);
    assert.equal(r.data.billing.invoiceProviderConnected,false);
    assert.deepEqual(r.data.billing.invoices,[]);
    assert.equal(r.data.apps.length,8);
    assert.equal(r.data.skills.length,7);
  }finally{await ctx.close();}
});
test("billing prices use exact micros and snapshot the event rate",()=>{
  assert.equal(parseUsdToMicros("3.000001"),3000001);
  assert.equal(parseUsdToMicros("0"),0);
  assert.equal(pricedEvent(1000000,3000000),3000000);
  assert.equal(pricedEvent(333,3000000),999);
  assert.equal(pricedEvent(1000,null),null);
  assert.throws(()=>parseUsdToMicros("-5"),/Invalid/);
  assert.throws(()=>parseUsdToMicros("1.1234567"),/Invalid/);
  const r=validateUsageEvent(event(),baseEnv);
  assert.equal(r.estimatedCostMicros,3000000);
  assert.equal(r.rateMicroUsdPerMillion,3000000);
});
test("unsigned, tampered and stale receipts are rejected before writing",async()=>{
  const ctx=await setup();
  try{
    const payload=event();
    assert.equal((await ctx.api("/billing/ingest",payload)).code,401);
    const signed=await ctx.api("/billing/ingest",payload,{signed:true});
    assert.equal(signed.code,201);
    assert.equal(signed.data.accepted,true);
    assert.equal((await ctx.api("/billing/ingest",payload,{signed:true,stamp:String(Date.now()-3600000)})).code,401);
    const bad=await ctx.api("/billing/ingest",payload,{
      headers:{"x-ciro-signature":"b".repeat(64),"x-ciro-timestamp":String(Date.now())}
    });
    assert.equal(bad.code,401);
    const state=await ctx.api("/state");
    assert.equal(state.data.billing.eventsCount,1);
    assert.equal(state.data.billing.totalEstimatedMicros,3000000);
    assert.ok(!JSON.stringify(state.data).includes(secret));
  }finally{await ctx.close();}
});
test("metering is idempotent and conflicting event IDs fail without overwriting",async()=>{
  const ctx=await setup();
  try{
    const payload=event();
    assert.equal((await ctx.api("/billing/ingest",payload,{signed:true})).code,201);
    const duplicate=await ctx.api("/billing/ingest",payload,{signed:true});
    assert.equal(duplicate.code,200);
    assert.equal(duplicate.data.duplicate,true);
    const conflict=await ctx.api("/billing/ingest",{...payload,units:2000000},{signed:true});
    assert.equal(conflict.code,409);
    const summary=(await ctx.api("/state")).data.billing;
    assert.equal(summary.eventsCount,1);
  }finally{await ctx.close();}
});
test("unpriced records do not silently count as zero-cost billed usage",async()=>{
  const ctx=await setup({...baseEnv,CIRO_BILLING_GWU_USD_PER_MILLION:""});
  try{
    const payload=event({unit:"GWU",category:"agent"});
    assert.equal((await ctx.api("/billing/ingest",payload,{signed:true})).code,201);
    const s=(await ctx.api("/state")).data.billing;
    assert.equal(s.units.GWU,1000000);
    assert.equal(s.unknownPriceEvents,1);
    assert.equal(s.totalEstimatedMicros,null);
    assert.equal(s.knownEstimatedMicros,0);
  }finally{await ctx.close();}
});
test("budget saves, warns and blocks new runs once monthly threshold is reached",async()=>{
  const ctx=await setup();
  try{
    const cap=await ctx.api("/billing/budget",{monthlyBudgetUsd:"2.50",alertThresholdPct:80});
    assert.equal(cap.code,200);
    assert.equal(cap.data.billing.monthlyBudgetMicros,2500000);
    assert.equal((await ctx.api("/billing/ingest",event(),{signed:true})).code,201);
    const b=(await ctx.api("/state")).data.billing;
    assert.equal(b.budgetWarning,true);
    assert.equal(b.budgetReached,true);
    assert.throws(()=>assertBudgetAdmission(ctx.env,ctx.store.get()),/budget threshold reached/i);
    assert.equal((await ctx.api("/billing/budget",{monthlyBudgetUsd:"nope",alertThresholdPct:80})).code,400);
    assert.equal((await ctx.api("/billing/budget",{monthlyBudgetUsd:"25",alertThresholdPct:1})).code,400);
    const updated=await ctx.api("/billing/budget",{monthlyBudgetUsd:null,alertThresholdPct:80});
    assert.equal(updated.data.billing.monthlyBudgetMicros,null);
    assert.doesNotThrow(()=>assertBudgetAdmission(ctx.env,ctx.store.get()));
  }finally{await ctx.close();}
});
test("a configured budget fails closed if reliable pricing is unavailable",async()=>{
  const ctx=await setup({...baseEnv,CIRO_BILLING_EVENT_SECRET:"",CIRO_BILLING_CWU_USD_PER_MILLION:""});
  try{
    await ctx.api("/billing/budget",{monthlyBudgetUsd:"10",alertThresholdPct:80});
    assert.throws(()=>assertBudgetAdmission(ctx.env,ctx.store.get()),/Cannot guarantee the budget/);
  }finally{await ctx.close();}
});
test("CSV export is escaped, has no fabricated records, and handles spreadsheet formulas",async()=>{
  const ctx=await setup();
  try{
    const exportResult=await ctx.api("/billing/export.csv");
    assert.equal(exportResult.code,200);
    assert.match(exportResult.data,/eventId,observedAt/);
    assert.ok(!exportResult.data.includes("evt-"));
    const rows=[{...validateUsageEvent(event(),baseEnv),model:"=IMPORTDATA(unsafe)"}];
    assert.match(receiptCsv(rows),/"'=IMPORTDATA\(unsafe\)"/);
  }finally{await ctx.close();}
});
test("official apps can be pinned, but unknown remote apps cannot be installed",async()=>{
  const ctx=await setup();
  try{
    const pin=await ctx.api("/apps/github/pin",{pinned:true});
    assert.equal(pin.code,200);
    const catalog=(await ctx.api("/state")).data;
    assert.equal(catalog.apps.find(x=>x.id==="github").pinned,true);
    assert.equal((await ctx.api("/apps/evil-remote/pin",{pinned:true})).code,400);
    assert.equal((await ctx.api("/apps/chat/pin",{pinned:"yes"})).code,400);
    const restored=createWorkbenchStore(ctx.dir);
    assert.ok(restored.get().commercial.pinnedApps.includes("github"));
  }finally{await ctx.close();}
});
test("official skills are curated and must never become executable without the runtime",async()=>{
  const ctx=await setup();
  try{
    const enabled=await ctx.api("/skills/red-team/toggle",{enabled:true});
    assert.equal(enabled.code,200);
    assert.equal(enabled.data.executable,false);
    const s=(await ctx.api("/state")).data;
    assert.equal(s.skills.find(x=>x.id==="red-team").enabled,true);
    assert.equal(s.skills.find(x=>x.id==="red-team").ready,false);
    assert.equal((await ctx.api("/skills/remote-code/toggle",{enabled:true})).code,400);
    const restored=createWorkbenchStore(ctx.dir);
    assert.equal(restored.get().commercial.skills["red-team"],true);
    assert.equal(selectedSkills(ctx.env,restored.get()).length,0);
  }finally{await ctx.close();}
});
test("only reviewed enabled and configured skills are included in runner tool context",()=>{
  const initial={plugins:{runner:true},commercial:{skills:{"architecture":true,"red-team":true,"research":true}}};
  const x=selectedSkills({
    CIRO_AGENT_RUNNER_URL:"https://runner.example",CIRO_AGENT_RUNNER_TOKEN:"a",
    CIRO_VERIFIER_URL:"https://verify.example",CIRO_VERIFIER_TOKEN:"b"
  },initial);
  assert.deepEqual(x.map(item=>item.id),["red-team","architecture"]);
  assert.equal(catalogSnapshot({},initial).skills.find(x=>x.id==="architecture").ready,false);
  assert.deepEqual(selectedSkills({},initial),[]);
});

import express from "express";
import {
  officialAppIds,officialSkillIds,catalogSnapshot,selectedSkills
} from "./commercial-catalog.mjs";
import {
  validateUsageEvent,verifySignedReceipt,usageSummary,parseUsdToMicros,receiptCsv
} from "./commercial-billing.mjs";
import {mountSpendingEndpoints,settleReservationOnUsage} from "./spending.mjs";

const INITIAL_PINS=["chat","workbench"];
function commercial(state){
  const saved=state.commercial||{};
  return {
    ...saved,
    events:Array.isArray(saved.events)?saved.events:[],
    pinnedApps:Array.isArray(saved.pinnedApps)?saved.pinnedApps:INITIAL_PINS,
    skills:saved.skills||{},
    billing:{monthlyBudgetMicros:null,alertThresholdPct:80,...(saved.billing||{})}
  };
}
function publicState(env,state){
  const saved=commercial(state);
  return {billing:usageSummary(env,saved),...catalogSnapshot(env,{commercial:saved})};
}
function publicError(error,res){
  const status=error.statusCode||400;
  res.status(status).json({error:error.message||"Invalid commercial request"});
}
export function createCommercialRouter({env=process.env,store,notify=()=>{}}={}){
  if(!store)throw new Error("Commercial store is required");
  const router=express.Router();
  router.use((_req,res,next)=>{res.set("Cache-Control","no-store");next();});
  const wrap=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>publicError(e,res));
  mountSpendingEndpoints(router,{env,store,wrap});

  router.get("/state",(_req,res)=>res.json(publicState(env,store.get())));
  router.get("/billing/export.csv",(_req,res)=>{
    const state=commercial(store.get());
    const month=new Date().toISOString().slice(0,7);
    const rows=state.events.filter(e=>e.observedAt.startsWith(month));
    res.set({
      "Content-Type":"text/csv; charset=utf-8",
      "Content-Disposition":'attachment; filename="ciro-metering-'+month+'.csv"',
      "X-Content-Type-Options":"nosniff"
    }).send("\uFEFF"+receiptCsv(rows));
  });

  router.post("/billing/budget",wrap((req,res)=>{
    const value=req.body||{};
    const cap=parseUsdToMicros(value.monthlyBudgetUsd,{nullable:true,maxUsd:1_000_000});
    // A zero cap is a valid freeze; consumers must compare it with 0 spend.
    if(!Number.isInteger(value.alertThresholdPct)||value.alertThresholdPct<50||value.alertThresholdPct>100)
      throw new Error("Alert threshold must be 50–100 percent");
    store.change("billing.budget.updated",{configured:cap!==null,alertThresholdPct:value.alertThresholdPct},s=>{
      s.commercial=commercial(s);
      s.commercial.billing={monthlyBudgetMicros:cap,alertThresholdPct:value.alertThresholdPct};
    });
    res.json({billing:usageSummary(env,commercial(store.get()))});
  }));

  router.post("/billing/ingest",wrap((req,res)=>{
    // A trusted CIRO runtime must sign the exact incoming JSON bytes.
    // Client-originated usage events cannot fabricate bills or receipts.
    verifySignedReceipt(req,env);
    const entry=validateUsageEvent(req.body,env);
    const saved=commercial(store.get());
    const existing=saved.events.find(e=>e.eventId===entry.eventId);
    if(existing){
      if(existing.receiptSha256!==entry.receiptSha256 ||
         existing.units!==entry.units || existing.unit!==entry.unit ||
         existing.model!==entry.model || existing.category!==entry.category ||
         existing.observedAt!==entry.observedAt){
        return res.status(409).json({error:"Receipt ID conflicts with a previously recorded event"});
      }
      return res.json({accepted:true,duplicate:true,eventId:entry.eventId});
    }
    if(saved.events.length>=20000)
      throw Object.assign(new Error("Local metering capacity reached; configure durable billing storage"),{statusCode:507});
    if(req.body?.reservationId)settleReservationOnUsage(store,req.body.reservationId,entry);
    store.change("billing.usage.recorded",{
      eventId:entry.eventId,unit:entry.unit,units:entry.units,receiptSha256:entry.receiptSha256
    },s=>{
      s.commercial=commercial(s);
      s.commercial.events.push(entry);
    });
    const metrics=usageSummary(env,commercial(store.get()));
    if(metrics.budgetReached)notify({type:"warning",title:"Ciro budget reached",body:"Monthly spend threshold reached; new agent tasks are paused."});
    else if(metrics.budgetWarning)notify({type:"warning",title:"Ciro budget alert",body:"Monthly budget warning threshold has been reached."});
    res.status(201).json({accepted:true,duplicate:false,eventId:entry.eventId});
  }));

  router.post("/apps/:id/pin",wrap((req,res)=>{
    const id=req.params.id;
    if(!officialAppIds.has(id))throw new Error("Unknown official application");
    if(typeof req.body?.pinned!=="boolean")throw new Error("Explicit pinned boolean required");
    const wanted=req.body.pinned;
    store.change("catalog.app.pin",{id,pinned:wanted},s=>{
      s.commercial=commercial(s);
      const pins=new Set(s.commercial.pinnedApps.filter(x=>officialAppIds.has(x)));
      if(wanted)pins.add(id);else pins.delete(id);
      s.commercial.pinnedApps=[...pins];
    });
    res.json({id,pinned:wanted});
  }));

  router.post("/skills/:id/toggle",wrap((req,res)=>{
    const id=req.params.id;
    if(!officialSkillIds.has(id))throw new Error("Unknown or unsigned skill");
    if(typeof req.body?.enabled!=="boolean")throw new Error("Explicit enabled boolean required");
    const enabled=req.body.enabled;
    store.change("catalog.skill.toggle",{id,enabled},s=>{
      s.commercial=commercial(s);
      s.commercial.skills[id]=enabled;
    });
    // Enabled only marks a reviewed built-in skill as selected. It does not
    // execute code or implicitly grant tool authority.
    res.json({id,enabled,executable:selectedSkills(env,store.get()).some(x=>x.id===id)});
  }));
  return {router,snapshot:()=>publicState(env,store.get())};
}

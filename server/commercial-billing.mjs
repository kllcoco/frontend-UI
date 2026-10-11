import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_EVENTS=20000;
const ALLOWED_KINDS=new Set(["chat","agent","tool","training"]);
const UNITS=new Set(["CWU","GWU"]);
const EVENT_ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{5,119}$/;
const HEX64=/^[a-f0-9]{64}$/;

export function parseUsdToMicros(value, {nullable=false,maxUsd=1_000_000}={}) {
  if(nullable && (value===null || value===undefined || value===""))return null;
  const text=typeof value==="number" && Number.isFinite(value)?String(value):value;
  if(typeof text!=="string" || !/^(0|[1-9]\d{0,8})(?:\.\d{1,6})?$/.test(text))throw new Error("Invalid USD amount");
  const [whole,fract=""]=text.split(".");
  const micros=BigInt(whole)*1000000n+BigInt(fract.padEnd(6,"0"));
  if(micros>BigInt(maxUsd)*1000000n)throw new Error("USD amount exceeds supported limit");
  return Number(micros);
}
export function pricedUnitRate(env,unit){
  const key=unit==="CWU"?"CIRO_BILLING_CWU_USD_PER_MILLION":"CIRO_BILLING_GWU_USD_PER_MILLION";
  if(!UNITS.has(unit))throw new Error("Unsupported unit");
  return parseUsdToMicros(env[key],{nullable:true,maxUsd:10000});
}
export function pricedEvent(units,rateMicroUsdPerMillion){
  if(rateMicroUsdPerMillion===null)return null;
  if(!Number.isSafeInteger(units)||units<1||units>1_000_000_000)throw new Error("Invalid metered units");
  const micros=(BigInt(units)*BigInt(rateMicroUsdPerMillion)+500000n)/1000000n;
  return Number(micros);
}
export function validateUsageEvent(payload,env){
  if(!payload || typeof payload!=="object" || Array.isArray(payload))throw new Error("Invalid receipt");
  const eventId=payload.eventId,unit=payload.unit,category=payload.category;
  if(typeof eventId!=="string"||!EVENT_ID.test(eventId))throw new Error("Invalid event id");
  if(!UNITS.has(unit))throw new Error("Invalid usage unit");
  if(!ALLOWED_KINDS.has(category))throw new Error("Invalid usage category");
  if(!Number.isSafeInteger(payload.units)||payload.units<1||payload.units>1_000_000_000)throw new Error("Invalid usage count");
  if(typeof payload.model!=="string"||!/^[a-zA-Z0-9_.:/-]{1,100}$/.test(payload.model))throw new Error("Invalid model");
  if(typeof payload.receiptSha256!=="string"||!HEX64.test(payload.receiptSha256))throw new Error("Invalid evidence digest");
  if(typeof payload.observedAt!=="string"||!/^\d{4}-\d{2}-\d{2}T/.test(payload.observedAt)||
     !Number.isFinite(Date.parse(payload.observedAt)))throw new Error("Invalid observedAt");
  const when=Date.parse(payload.observedAt);
  if(when>Date.now()+300000 || when<Date.now()-90*86400000)throw new Error("Receipt is outside the supported 90-day window");
  const rate=pricedUnitRate(env,unit);
  return {
    eventId,unit,category,units:payload.units,model:payload.model,
    receiptSha256:payload.receiptSha256,observedAt:new Date(when).toISOString(),
    estimatedCostMicros:pricedEvent(payload.units,rate),
    rateMicroUsdPerMillion:rate,
    recordedAt:new Date().toISOString()
  };
}
export function verifySignedReceipt(req,env,now=Date.now()){
  const secret=env.CIRO_BILLING_EVENT_SECRET;
  if(typeof secret!=="string"||Buffer.byteLength(secret,"utf8")<24){
    throw Object.assign(new Error("Billing metering is not configured"),{statusCode:503});
  }
  const ts=req.get("x-ciro-timestamp"),sig=req.get("x-ciro-signature");
  if(typeof ts!=="string"||!/^\d{10,13}$/.test(ts)||typeof sig!=="string"||!/^[a-f0-9]{64}$/.test(sig))
    throw Object.assign(new Error("Signed metering receipt required"),{statusCode:401});
  const stamp=Number(ts.length===10?Number(ts)*1000:ts);
  if(!Number.isSafeInteger(stamp)||Math.abs(now-stamp)>300000)
    throw Object.assign(new Error("Stale metering receipt"),{statusCode:401});
  if(!Buffer.isBuffer(req.rawBody))throw Object.assign(new Error("Unverifiable request body"),{statusCode:401});
  const mac=createHmac("sha256",secret).update(ts).update(".").update(req.rawBody).digest();
  const presented=Buffer.from(sig,"hex");
  if(!timingSafeEqual(mac,presented))
    throw Object.assign(new Error("Invalid metering signature"),{statusCode:401});
}
export function usageSummary(env,commerce,at=new Date()){
  const period=at.toISOString().slice(0,7);
  const events=Array.isArray(commerce?.events)?commerce.events:[];
  const within=events.filter(e=>e.observedAt.startsWith(period));
  const units={CWU:0,GWU:0};
  let knownMicros=0,pricedCount=0,unknownCount=0;
  const byCategory={chat:0,agent:0,tool:0,training:0};
  for(const e of within){
    units[e.unit]=(units[e.unit]||0)+e.units;
    byCategory[e.category]=(byCategory[e.category]||0)+e.units;
    if(e.estimatedCostMicros===null)unknownCount++;
    else{knownMicros+=e.estimatedCostMicros;pricedCount++;}
  }
  const config=commerce?.billing || {};
  const monthlyBudgetMicros=config.monthlyBudgetMicros??null;
  const alertThresholdPct=config.alertThresholdPct??80;
  const signatureConfigured=typeof env.CIRO_BILLING_EVENT_SECRET==="string"&&Buffer.byteLength(env.CIRO_BILLING_EVENT_SECRET,"utf8")>=24;
  const rateCWU=pricedUnitRate(env,"CWU"),rateGWU=pricedUnitRate(env,"GWU");
  return {
    period,eventsCount:within.length,allTimeEvents:events.length,units,
    byCategory,knownEstimatedMicros:knownMicros,unknownPriceEvents:unknownCount,
    totalEstimatedMicros:within.length&&unknownCount===0?knownMicros:null,
    hasUsage:within.length>0,source:"signed_runtime_receipts",
    isActualInvoice:false,invoiceProviderConnected:false,invoices:[],
    rateMicroUsdPerMillion:{CWU:rateCWU,GWU:rateGWU},
    meteringConfigured:signatureConfigured,
    billingReady:signatureConfigured&&(rateCWU!==null||rateGWU!==null),
    monthlyBudgetMicros,alertThresholdPct,
    budgetReached:monthlyBudgetMicros!==null&&knownMicros>=monthlyBudgetMicros,
    budgetWarning:monthlyBudgetMicros!==null&&knownMicros*100>=monthlyBudgetMicros*alertThresholdPct,
    events:within.slice().sort((a,b)=>b.observedAt.localeCompare(a.observedAt)).slice(0,100)
  };
}
export function assertBudgetAdmission(env,state) {
  const summary=usageSummary(env,state.commercial);
  if(summary.monthlyBudgetMicros===null)return;
  if(!summary.billingReady||summary.unknownPriceEvents){
    throw Object.assign(new Error("Cannot guarantee the budget: metering or prices are unavailable."),{statusCode:409});
  }
  if(summary.budgetReached)
    throw Object.assign(new Error("Monthly budget threshold reached; new agent runs are paused."),{statusCode:409});
}
export function receiptCsv(rows){
  const headers=["eventId","observedAt","category","model","unit","units","estimatedUsd","receiptSha256"];
  const esc=value=>{
    let text=String(value??"");
    if(/^[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  };
  return [headers.join(","),...rows.map(row=>headers.map(k=>{
    const v=k==="estimatedUsd"?(row.estimatedCostMicros===null?"":(row.estimatedCostMicros/1e6).toFixed(6)):row[k];
    return esc(v);
  }).join(","))].join("\r\n")+"\r\n";
}

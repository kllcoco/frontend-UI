export type CommerceTab="billing"|"apps"|"skills";
export type MeterUnit="CWU"|"GWU";
export type UsageEvent={
  eventId:string;unit:MeterUnit;category:"chat"|"agent"|"tool"|"training";
  units:number;model:string;receiptSha256:string;observedAt:string;
  recordedAt:string;estimatedCostMicros:number|null;rateMicroUsdPerMillion:number|null;
};
export type BillingOverview={
  period:string;eventsCount:number;allTimeEvents:number;
  units:Record<MeterUnit,number>;byCategory:Record<string,number>;
  knownEstimatedMicros:number;unknownPriceEvents:number;totalEstimatedMicros:number|null;
  hasUsage:boolean;source:"signed_runtime_receipts";isActualInvoice:false;
  invoiceProviderConnected:boolean;invoices:never[];rateMicroUsdPerMillion:Record<MeterUnit,number|null>;
  meteringConfigured:boolean;billingReady:boolean;monthlyBudgetMicros:number|null;
  alertThresholdPct:number;budgetReached:boolean;budgetWarning:boolean;events:UsageEvent[];
};
export type OfficialApp={
  id:string;name:string;zh:string;category:string;icon:string;description:string;
  descriptionEn:string;route:string|null;requires:string;
  pinned:boolean;ready:boolean;status:"available"|"not_configured";
};
export type OfficialSkill={
  id:string;name:string;zh:string;version:string;category:string;description:string;
  descriptionEn:string;scope:string[];requires:string;enabled:boolean;ready:boolean;
  status:"available"|"not_configured";
};
export type CommerceState={billing:BillingOverview;apps:OfficialApp[];skills:OfficialSkill[]};
export async function commercialApi<T>(path:string,body?:unknown):Promise<T>{
  const result=await fetch("/api/workbench/commercial"+path,{
    method:body===undefined?"GET":"POST",
    cache:"no-store",
    headers:body===undefined?undefined:{"Content-Type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const data:unknown=await result.json().catch(()=>({}));
  if(!result.ok){
    const message=(data&&typeof data==="object"&&"error" in data)?String(data.error):"HTTP "+result.status;
    throw new Error(message);
  }
  return data as T;
}
export function formatUsdMicros(micros:number|null,locale="zh-CN"){
  if(micros===null)return "—";
  return new Intl.NumberFormat(locale,{style:"currency",currency:"USD",minimumFractionDigits:2,
    maximumFractionDigits:micros<10000?6:2}).format(micros/1000000);
}

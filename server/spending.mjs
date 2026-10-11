import {parseUsdToMicros,usageSummary,verifySignedReceipt} from "./commercial-billing.mjs";
const allowed=(v)=>parseUsdToMicros(v,{nullable:true,maxUsd:1000000});
const frozenLimit=(x)=>x===null?null:Math.max(0,x);
const empty=()=>({dailyLimitMicros:null,monthlyLimitMicros:null,singleRequestLimitMicros:null,
  reservations:[]});
function limitsFrom(state){
  return {...empty(),...(state.commercial?.spending||{})};
}
function used(state,day,month){
  const events=state.commercial?.events||[];
  const add=(prefix)=>events.filter(e=>e.observedAt.startsWith(prefix)).reduce((sum,e)=>sum+(e.estimatedCostMicros||0),0);
  const reserved=limitsFrom(state).reservations.filter(r=>r.expiresAt>Date.now()&&!r.releasedAt&&!r.settledAt);
  const addReserved=(prefix)=>reserved.filter(x=>x.createdAt.startsWith(prefix)).reduce((s,x)=>s+x.amountMicros,0);
  return {daily:add(day)+addReserved(day),monthly:add(month)+addReserved(month)};
}
export function publicSpending(state,now=new Date()){
  const cfg=limitsFrom(state),day=now.toISOString().slice(0,10),month=day.slice(0,7);
  const totals=used(state,day,month);
  return {dailyLimitMicros:cfg.dailyLimitMicros,monthlyLimitMicros:cfg.monthlyLimitMicros,
    singleRequestLimitMicros:cfg.singleRequestLimitMicros,
    reservedCount:cfg.reservations.filter(x=>x.expiresAt>Date.now()&&!x.settledAt&&!x.releasedAt).length,
    dailyCommittedPlusReservedMicros:totals.daily,monthlyCommittedPlusReservedMicros:totals.monthly,
    admissionRequiresSignedRuntime:true,hardCutoffRequiresNativeRunnerEnforcement:true};
}
export function newLimits(body){
  if(!body||typeof body!=="object")throw new Error("Invalid spending limits");
  return {
    dailyLimitMicros:frozenLimit(allowed(body.dailyUsd)),
    monthlyLimitMicros:frozenLimit(allowed(body.monthlyUsd)),
    singleRequestLimitMicros:frozenLimit(allowed(body.singleRequestUsd))
  };
}
export function authorizeSpend(state,env,input,at=new Date()){
  if(!input||typeof input.reservationId!=="string"||
    !/^[a-zA-Z0-9_:-]{8,120}$/.test(input.reservationId))throw new Error("Invalid reservation ID");
  const amount=parseUsdToMicros(input.estimatedCostUsd,{maxUsd:1000000});
  if(amount<=0)throw new Error("Reservation must have positive cost");
  const cfg=limitsFrom(state),active=cfg.reservations.find(r=>r.id===input.reservationId);
  if(active){
    if(active.amountMicros!==amount)throw new Error("Reservation ID cost conflict");
    return {duplicate:true,reservation:active};
  }
  // Verified metering plus known prices is required before limits can be enforced.
  const snapshot=usageSummary(env,state.commercial||{});
  if(!snapshot.billingReady||snapshot.unknownPriceEvents)throw new Error("Cannot admit spending without signed metering and both prices");
  const day=at.toISOString().slice(0,10),month=day.slice(0,7);
  const totals=used(state,day,month);
  const constraints=[
    [cfg.singleRequestLimitMicros,amount,"single request"],
    [cfg.dailyLimitMicros,totals.daily+amount,"daily"],
    [cfg.monthlyLimitMicros,totals.monthly+amount,"monthly"],
    [state.commercial?.billing?.monthlyBudgetMicros??null,totals.monthly+amount,"monthly budget"]
  ];
  for(const [limit,value,name] of constraints)
    if(limit!==null&&value>limit)throw new Error(name+" spending ceiling exceeded");
  if((cfg.reservations||[]).filter(r=>r.expiresAt>Date.now()&&!r.settledAt&&!r.releasedAt).length>=100)
    throw new Error("Too many outstanding reservations");
  return {duplicate:false,reservation:{id:input.reservationId,amountMicros:amount,createdAt:at.toISOString(),
    expiresAt:at.getTime()+1200000,releasedAt:null,settledAt:null}};
}
export function mountSpendingEndpoints(router,{env,store,wrap}){
  router.get("/billing/spending",(_req,res)=>res.json(publicSpending(store.get())));
  router.post("/billing/spending",wrap((req,res)=>{
    const limits=newLimits(req.body);
    store.change("spending.limits.updated",s=>{
      s.commercial.spending={...limits,reservations:limitsFrom(s).reservations};
    });
    res.json(publicSpending(store.get()));
  }));
  router.post("/billing/reservations",wrap((req,res)=>{
    verifySignedReceipt(req,env);
    const result=authorizeSpend(store.get(),env,req.body);
    if(!result.duplicate)store.change("spending.reservation.created",s=>{
      s.commercial.spending=limitsFrom(s);
      s.commercial.spending.reservations.push(result.reservation);
      s.commercial.spending.reservations=s.commercial.spending.reservations.filter(r=>
        !r.releasedAt&&!r.settledAt&&r.expiresAt>Date.now()).slice(-150);
    });
    res.status(result.duplicate?200:201).json(result);
  }));
  router.post("/billing/reservations/:id/release",wrap((req,res)=>{
    verifySignedReceipt(req,env);
    const r=limitsFrom(store.get()).reservations.find(x=>x.id===req.params.id);
    if(!r)return res.status(404).json({error:"Reservation not found"});
    if(r.settledAt)return res.status(409).json({error:"Reservation already settled"});
    store.change("spending.reservation.released",()=>{
      r.releasedAt=r.releasedAt||new Date().toISOString();
    });
    res.json({released:true});
  }));
}
export function settleReservationOnUsage(store,reservationId,event){
  if(!reservationId)return;
  const r=limitsFrom(store.get()).reservations.find(x=>x.id===reservationId);
  if(!r||r.releasedAt||r.settledAt)throw new Error("Valid outstanding reservation required");
  if(r.expiresAt<Date.now())throw new Error("Reservation expired");
  // Any overruns must remain visible in receipts; native runtime must enforce
  // actual compute caps before overspending, not just this server-side tally.
  if(event.estimatedCostMicros===null)throw new Error("Cannot settle a receipt without price");
  store.change("spending.reservation.settled",()=>{
    r.settledAt=new Date().toISOString();r.actualCostMicros=event.estimatedCostMicros;
    r.receiptId=event.eventId;
  });
}

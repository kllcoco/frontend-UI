import {createHash,randomUUID} from "node:crypto";
import {join} from "node:path";
import {sealJSON,unsealJSON} from "./account.mjs";
import {createTransactionalPluginDocument} from "./plugin-transactional-store.mjs";

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const empty=()=>({version:1,jobs:[]});
const statuses=new Set(["queued","leased","cancel_requested","succeeded","failed","cancelled","uncertain"]);
const valid=s=>s?.version===1&&Array.isArray(s.jobs)&&s.jobs.every(x=>statuses.has(x.status));
const safeKey=x=>typeof x==="string"&&/^[A-Za-z0-9:_-][A-Za-z0-9:_.-]{11,159}$/.test(x);
const safeOwner=x=>typeof x==="string"&&/^[A-Za-z0-9:_-]{1,128}$/.test(x);
const SHA256=x=>createHash("sha256").update(x).digest("hex");

// This is a bounded, single-host SQLite-backed durable control-plane ledger.
// External side effects are never automatically replayed when a worker vanishes.
export function createPluginJobQueue({dir,env=process.env,clock=Date.now}={}){
 const folder=dir||env.CIRO_WORKSPACE_DATA_DIR||join(process.cwd(),".ciro-runtime");
 const db=createTransactionalPluginDocument({
  dir:folder,kind:"plugin_jobs",legacyName:"plugin-jobs.json",initial:empty,validate:valid
 });
 const now=()=>clock();
 const aad=(ownerId,id)=>"plugin:job:"+ownerId+":"+id;
 const publicRecord=(record,withResult=false)=>{
  const out={id:record.id,provider:record.provider,tool:record.tool,source:record.source,
   effect:record.effect,approvalId:record.approvalId||null,status:record.status,
   attempts:record.attempts,createdAt:record.createdAt,updatedAt:record.updatedAt,
   cancellationRequested:record.status==="cancel_requested",
   resultTruncated:record.resultTruncated===true,code:record.code||null};
  if(withResult&&record.resultSealed&&record.status==="succeeded")
   out.result=unsealJSON(record.resultSealed,env,aad(record.ownerId,record.id));
  return out;
 };
 function reclaim(s){
  const stamp=now();
  for(const job of s.jobs){
   if(!["leased","cancel_requested"].includes(job.status)||job.leaseExpiresAt>stamp)continue;
   if(job.effect){
    job.status="uncertain";job.code="worker_lost_during_external_effect";
   }else if(job.status==="cancel_requested"){
    job.status="cancelled";job.code="cancelled_during_worker_restart";
   }else if(job.attempts>=3){
    job.status="failed";job.code="safe_read_retries_exhausted";
   }else{job.status="queued";job.nextAt=stamp+1000;job.code="safe_read_recovered";}
   job.leaseOwner=null;job.leaseExpiresAt=null;job.updatedAt=stamp;
  }
 }
 function enqueue({ownerId,provider,tool,args,source="manual",idempotencyKey,effect=false,
  installationId,generation,policySignature,approvalId=null}){
  if(!safeKey(idempotencyKey)||!safeOwner(ownerId)||!["github","supabase"].includes(provider)||
     typeof tool!=="string"||tool.length>100||!["manual","agent","chat"].includes(source)||
     typeof installationId!=="string"||!installationId||
     typeof generation!=="string"||!generation||
     typeof policySignature!=="string"||!policySignature)
   throw fail("Invalid scoped plugin job request");
  if(!args||typeof args!=="object"||Array.isArray(args))
   throw fail("Plugin job arguments must be an object");
  const serialized=JSON.stringify({provider,tool,args,source,effect,installationId,
   generation,policySignature,approvalId});
  if(Buffer.byteLength(serialized)>210000)throw fail("Plugin job request too large",413);
  if(effect&&(!safeKey(approvalId)||idempotencyKey!=="approval:"+approvalId))
   throw fail("Side-effect job must be bound to a consumed human approval",403);
  const digest=SHA256(serialized),createdAt=now();
  return db.mutate(s=>{
   reclaim(s);
   const prior=s.jobs.find(x=>x.ownerId===ownerId&&x.idempotencyKey===idempotencyKey);
   if(prior){
    if(prior.requestHash!==digest)throw fail("Idempotency key reused with different arguments",409);
    return {...publicRecord(prior),duplicate:true};
   }
   if(s.jobs.filter(x=>x.ownerId===ownerId&&["queued","leased","cancel_requested","uncertain"].includes(x.status)).length>=100)
    throw fail("Too many unfinished plugin jobs",429);
   if(s.jobs.length>=1200)throw fail("Plugin job ledger capacity reached; archival required",503);
   const id=randomUUID();
   const sealed=sealJSON({args,installationId,generation,policySignature},env,aad(ownerId,id));
   const item={id,ownerId,provider,tool,source,idempotencyKey,requestHash:digest,
    effect,approvalId,status:"queued",attempts:0,nextAt:createdAt,
    leaseOwner:null,leaseExpiresAt:null,requestSealed:sealed,resultSealed:null,
    resultTruncated:false,createdAt,updatedAt:createdAt,code:null};
   s.jobs.push(item);
   return {...publicRecord(item),duplicate:false};
  });
 }
 function claim({workerId,id=null,readsOnly=true,leaseMs=90000}={}){
  if(!safeKey(workerId)||leaseMs<30000||leaseMs>180000)
   throw fail("Invalid worker lease");
  return db.mutate(s=>{
   reclaim(s);
   const stamp=now();
   const job=s.jobs.find(x=>x.status==="queued"&&x.nextAt<=stamp&&
    (id===null||x.id===id)&&(!readsOnly||!x.effect));
   if(!job)return null;
   job.status="leased";job.leaseOwner=workerId;
   job.leaseExpiresAt=stamp+leaseMs;job.attempts++;job.updatedAt=stamp;
   return {...publicRecord(job),ownerId:job.ownerId,
    request:unsealJSON(job.requestSealed,env,aad(job.ownerId,job.id))};
  });
 }
 function finalize({id,workerId,result,errorCode=null,mayHaveSideEffect=false,retryable=false}={}){
  return db.mutate(s=>{
   const job=s.jobs.find(x=>x.id===id&&x.leaseOwner===workerId&&
    ["leased","cancel_requested"].includes(x.status)&&x.leaseExpiresAt>now());
   if(!job)throw fail("Plugin job lease expired or claimed by another worker",409);
   const cancelled=job.status==="cancel_requested";
   job.updatedAt=now();job.leaseOwner=null;job.leaseExpiresAt=null;
   if(errorCode!==null){
    if(job.effect&&mayHaveSideEffect){
     job.status="uncertain";job.code="external_effect_outcome_unknown";
    }else if(!job.effect&&retryable&&!cancelled&&job.attempts<3){
     job.status="queued";job.nextAt=now()+Math.min(15000,1000*(2**job.attempts));
     job.code="temporary_read_error";
    }else{
     job.status=cancelled?"cancelled":"failed";
     job.code=typeof errorCode==="string"&&/^[a-z_]{1,60}$/.test(errorCode)
       ?errorCode:"plugin_job_failed";
    }
   }else{
    const data=JSON.stringify(result??null);
    const truncated=Buffer.byteLength(data)>150000;
    const stored=truncated?{truncated:true,sha256:SHA256(data)}:result??null;
    job.resultSealed=sealJSON(stored,env,aad(job.ownerId,job.id));
    job.resultTruncated=truncated;
    job.status="succeeded";job.code=cancelled?"completed_during_cancellation":null;
   }
   return publicRecord(job);
  });
 }
 function cancel(ownerId,id){
  return db.mutate(s=>{
   const job=s.jobs.find(x=>x.ownerId===ownerId&&x.id===id);
   if(!job)throw fail("Plugin job not found",404);
   if(job.status==="queued"){
    job.status="cancelled";job.code="cancelled_before_execution";job.updatedAt=now();
   }else if(job.status==="leased"){
    job.status="cancel_requested";job.updatedAt=now();
   }
   return publicRecord(job);
  });
 }
 function list(ownerId){
  return db.read().jobs.filter(x=>x.ownerId===ownerId)
   .slice(-80).reverse().map(x=>publicRecord(x));
 }
 function get(ownerId,id){
  const item=db.read().jobs.find(x=>x.ownerId===ownerId&&x.id===id);
  if(!item)throw fail("Plugin job not found",404);
  return publicRecord(item,true);
 }
 function reconcile(){
  return db.mutate(s=>{reclaim(s);return {uncertain:s.jobs.filter(x=>x.status==="uncertain").length};});
 }
 return {enqueue,claim,finalize,cancel,list,get,reconcile,close:()=>db.close()};
}

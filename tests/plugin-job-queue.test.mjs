import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createPluginJobQueue} from "../server/plugin-job-queue.mjs";

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"ciro-queued-tests-"));
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64")};
 let timestamp=100000;
 const make=()=>createPluginJobQueue({dir,env,clock:()=>timestamp});
 return {dir,make,setNow:v=>{timestamp=v;},advance:v=>{timestamp+=v;},
  remove:()=>rmSync(dir,{recursive:true,force:true})};
}
const read=key=>({
 ownerId:"alice",provider:"github",tool:"github.read_file",args:{repo:"demo/repo",path:"README.md"},
 source:"manual",idempotencyKey:key,effect:false,
 installationId:"install-abc",generation:"grant-abc",policySignature:"policy-abc"
});
test("concurrent workers claim one read only, idempotent replay and encrypted result",()=>{
 const f=fixture(),a=f.make(),b=f.make();
 try{
  const request=read("read-request-0001");
  const first=a.enqueue(request);
  assert.equal(first.status,"queued");
  assert.equal(b.enqueue(request).duplicate,true);
  assert.throws(()=>a.enqueue({...request,args:{repo:"demo/repo",path:"OTHER.md"}}),/Idempotency key/);
  const workerId=randomUUID();
  const claimed=a.claim({workerId});
  assert.equal(claimed.request.args.path,"README.md");
  assert.equal(b.claim({workerId:randomUUID()}),null);
  const result=a.finalize({id:claimed.id,workerId ,result:{content:"super-private-note"}});
  assert.equal(result.status,"succeeded");
  assert.equal(b.get("alice",first.id).result.content,"super-private-note");
  assert.throws(()=>b.get("bob",first.id),/not found/);
  const data=readFileSync(join(f.dir,"plugin-control.sqlite")).toString("utf8");
  assert.ok(!data.includes("super-private-note"));
  assert.ok(!data.includes("README.md"));
 }finally{a.close();b.close();f.remove();}
});
test("worker restart retries only safe reads and marks uncertain writes without replay",()=>{
 const f=fixture(),a=f.make(),b=f.make();
 try{
  const readJob=a.enqueue(read("read-retry-000001"));
  const readWorker=randomUUID();
  a.claim({workerId:readWorker,id:readJob.id,leaseMs:30000});
  const approval=randomUUID();
  const writeJob=a.enqueue({...read("approval:"+approval),tool:"github.write_file",
   args:{repo:"demo/repo",path:"README.md",branch:"feature/work",content:"payload",message:"test"},
   effect:true,approvalId:approval});
  a.claim({workerId:randomUUID(),id:writeJob.id,readsOnly:false,leaseMs:30000});
  f.advance(31000);
  const recovered=b.reconcile();
  assert.equal(recovered.uncertain,1);
  assert.equal(a.get("alice",writeJob.id).status,"uncertain");
  assert.equal(b.claim({workerId:randomUUID(),readsOnly:true}),null); // read backoff
  f.advance(1500);
  const retried=b.claim({workerId:randomUUID()});
  assert.equal(retried.id,readJob.id);
  assert.equal(retried.attempts,2);
  assert.equal(a.get("alice",writeJob.id).status,"uncertain");
 }finally{a.close();b.close();f.remove();}
});
test("user scoped cancel rejects other owners; leased work reports cancellation race honestly",()=>{
 const f=fixture(),a=f.make();
 try{
  const queued=a.enqueue(read("cancel-queued-0001"));
  assert.throws(()=>a.cancel("bob",queued.id),/not found/);
  assert.equal(a.cancel("alice",queued.id).status,"cancelled");
  assert.equal(a.claim({workerId:randomUUID()}),null);
  const active=a.enqueue(read("cancel-active-0001"));
  const workerId=randomUUID(),claimed=a.claim({workerId,id:active.id});
  assert.equal(a.cancel("alice",active.id).status,"cancel_requested");
  const result=a.finalize({id:claimed.id,workerId,result:{content:"already returned"}});
  assert.equal(result.status,"succeeded");
  assert.equal(result.code,"completed_during_cancellation");
 }finally{a.close();f.remove();}
});
test("expired write cannot be completed by stale worker and must be reconciled manually",()=>{
 const f=fixture(),a=f.make(),b=f.make();
 try{
  const approval=randomUUID();
  const job=a.enqueue({...read("approval:"+approval),effect:true,approvalId:approval,tool:"github.create_branch",
   args:{repo:"demo/repo",branch:"feature/manual"}});
  const workerId=randomUUID();
  a.claim({workerId,id:job.id,readsOnly:false,leaseMs:30000});
  f.advance(31000);
  b.reconcile();
  assert.equal(b.get("alice",job.id).status,"uncertain");
  assert.throws(()=>a.finalize({id:job.id,workerId,result:{ok:true}}),/expired/);
  assert.equal(a.claim({workerId:randomUUID(),id:job.id,readsOnly:false}),null);
 }finally{a.close();b.close();f.remove();}
});

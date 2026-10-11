import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHmac,createHash,generateKeyPairSync,sign} from "node:crypto";
import {createStudioStore,safeStudioPath} from "../server/studio-store.mjs";
import {createStudioRouter,studioCapabilities,invokeStudio,verifyMarketplaceManifest} from "../server/studio.mjs";
import {validateChat,ValidationError} from "../server/validate.mjs";

function scratch(){return mkdtempSync(join(tmpdir(),"ciro-studio-"));}
function receipt(body,secret){
  const raw=JSON.stringify(body),stamp=String(Date.now());
  const sig=createHmac("sha256",secret).update(stamp+".").update(raw).digest("hex");
  return {raw,headers:{"x-ciro-timestamp":stamp,"x-ciro-signature":sig}};
}
async function fixture(env={},fetchFn=fetch){
  const dir=scratch(),{router,store}=createStudioRouter({dir,env,fetchFn});
  const app=express();
  app.use(express.json({limit:"1mb",verify:(req,_res,buf)=>{req.rawBody=Buffer.from(buf);}}));
  app.use("/api/studio",router);
  const server=await new Promise(resolve=>{const listener=app.listen(0,"127.0.0.1",()=>resolve(listener));});
  const url="http://127.0.0.1:"+server.address().port+"/api/studio";
  async function request(path,method="GET",body,customHeaders={}){
    const raw=typeof body==="string"?body:body===undefined?undefined:JSON.stringify(body);
    const response=await fetch(url+path,{
      method,headers:raw===undefined?customHeaders:{"Content-Type":"application/json",...customHeaders},
      ...(raw===undefined?{}:{body:raw})
    });
    const text=await response.text();let json;
    try{json=JSON.parse(text);}catch{json=text;}
    return {status:response.status,json};
  }
  return {request,store,dir,close:async()=>{await new Promise(resolve=>server.close(resolve));
    rmSync(dir,{recursive:true,force:true});}};
}
test("capability manifest reports no native execution unless configured, not fake PASS",async()=>{
  const f=await fixture();
  try{
    const r=await f.request("/capabilities");
    assert.equal(r.status,200);
    assert.equal(r.json.mode,"chat+workbench");
    assert.equal(r.json.ide.draftEditor,true);
    assert.equal(r.json.ide.sandboxExecution.configured,false);
    assert.equal(r.json.research.verified,false);
    assert.deepEqual(r.json.thinking.modes,["fast"]);
    assert.equal(r.json.devices.nativeApps,"not_packaged");
  }finally{await f.close();}
});
test("IDE file editing, revision-CAS, checkpoint digest and real restore persist on disk",async()=>{
  const f=await fixture();
  try{
    const p=await f.request("/projects","POST",{name:"Native Adapter"});
    assert.equal(p.status,201);const id=p.json.project.id;
    const edited=await f.request("/projects/"+id+"/file","PUT",{
      path:"src/worker.ts",content:"export const answer = 42;",baseRevision:0
    });
    assert.equal(edited.status,200);assert.equal(edited.json.project.revision,1);
    assert.equal((await f.request("/projects/"+id+"/file","PUT",{
      path:"src/worker.ts",content:"stale overwrite",baseRevision:0
    })).status,409);
    const checkpoint=await f.request("/projects/"+id+"/checkpoints","POST",{label:"clean"});
    assert.equal(checkpoint.status,201);
    assert.match(checkpoint.json.checkpoint.digest,/^[a-f0-9]{64}$/);
    const second=await f.request("/projects/"+id+"/file","PUT",{
      path:"src/worker.ts",content:"changed",baseRevision:1
    });
    assert.equal(second.status,200);
    const restored=await f.request("/projects/"+id+"/restore","POST",{
      checkpointId:checkpoint.json.checkpoint.id,baseRevision:2
    });
    assert.equal(restored.json.project.revision,3);
    assert.equal(restored.json.project.files[0].content,"export const answer = 42;");
    assert.ok(readFileSync(join(f.dir,"studio-state.json"),"utf8").includes("src/worker.ts"));
  }finally{await f.close();}
});
test("IDE traversal, hidden files and unapproved host actions are refused",async()=>{
  const f=await fixture();
  try{
    for(const path of ["../etc/passwd","/etc/passwd",".env","src/../private","src/.git/config","node_modules/a.js","foo\\bar"])
      assert.throws(()=>safeStudioPath(path),/Invalid/);
    const p=(await f.request("/projects","POST",{name:"Code"})).json.project;
    assert.equal((await f.request("/projects/"+p.id+"/file","PUT",{
      path:"../secret",content:"x",baseRevision:0
    })).status,400);
    assert.equal((await f.request("/projects/"+p.id+"/run","POST",{task:"rm -rf"})).status,400);
    assert.equal((await f.request("/projects/"+p.id+"/run","POST",{task:"test"})).status,403);
    const listed=await f.request("/projects");
    assert.equal(listed.json.projects[0].files.length,0);
  }finally{await f.close();}
});
test("knowledge imports genuine text, searchable grounded citations, rejects duplicate and deletes",async()=>{
  const f=await fixture();
  try{
    const first=await f.request("/knowledge/import","POST",{
      title:"architecture.md",text:"Source Atom\nH64 state transition verified\nProof required",
      source:"local-upload"
    });
    assert.equal(first.status,201);
    const id=first.json.document.id;
    const duplicate=await f.request("/knowledge/import","POST",{
      title:"copy.md",text:"Source Atom\nH64 state transition verified\nProof required"
    });
    assert.equal(duplicate.json.document.duplicate,true);
    const result=await f.request("/knowledge/search?q=H64");
    assert.equal(result.status,200);assert.equal(result.json.results.length,1);
    assert.equal(result.json.results[0].id,id);
    assert.match(result.json.results[0].citation,/^knowledge:.+:L2$/);
    assert.equal((await f.request("/knowledge/"+id)).json.document.text.includes("H64"),true);
    assert.equal((await f.request("/knowledge/"+id,"DELETE")).json.deleted,true);
    assert.equal((await f.request("/knowledge/search?q=H64")).json.results.length,0);
    assert.equal((await f.request("/knowledge/import","POST",{title:"bad",text:"x".repeat(60001)})).status,400);
  }finally{await f.close();}
});
test("research, thinking, media and marketplace fail closed without configured adapters",async()=>{
  const f=await fixture();
  try{
    assert.equal((await f.request("/research","POST",{query:"CIRO scaling",depth:"deep"})).status,503);
    assert.equal((await f.request("/think/jobs","POST",{
      objective:"Prove a new theorem",maxSeconds:120,priority:2
    })).status,503);
    assert.equal((await f.request("/media/jobs","POST",{
      filename:"photo.png",mime:"image/png",bytes:100,kind:"image"
    })).status,503);
    const market=await f.request("/marketplace");
    assert.equal(market.json.connected,false);
    assert.deepEqual(market.json.items,[]);
    assert.equal((await f.request("/marketplace/select","POST",{id:"evil",enabled:true})).status,404);
  }finally{await f.close();}
});
test("reasoning modes are explicit model contracts and unsupported modes fail before inference",()=>{
  const input={model:"ciro",messages:[{role:"user",content:"Explain"}]};
  assert.deepEqual(validateChat(input,["ciro"]).messages,input.messages);
  assert.throws(()=>validateChat({...input,reasoning:{mode:"deep",maxSeconds:120,priority:2}},["ciro"]),ValidationError);
  const ok=validateChat({...input,reasoning:{mode:"deep",maxSeconds:120,priority:2}},["ciro"],["fast","deep"]);
  assert.deepEqual(ok.ciro_reasoning,{mode:"deep",maxSeconds:120,priority:2});
  assert.throws(()=>validateChat({...input,reasoning:{mode:"continuous",maxSeconds:120,priority:5}},["ciro"],["fast","deep"]));
  assert.throws(()=>validateChat({...input,reasoning:{mode:"deep",maxSeconds:99999,priority:2}},["ciro"],["fast","deep"]));
});
test("signed native compute measurements are immutable and unsigned/fake metrics rejected",async()=>{
  const secret="studio-telemetry-signer-very-long-secret";
  const f=await fixture({CIRO_BILLING_EVENT_SECRET:secret});
  try{
    const body={eventId:"measure-epoch-001",observedAt:new Date().toISOString(),source:"training",
      metrics:{gpuPct:73.2,gpuMemoryMb:12420,latencyMs:250}};
    assert.equal((await f.request("/compute/ingest","POST",body)).status,401);
    const signed=receipt(body,secret);
    assert.equal((await f.request("/compute/ingest","POST",signed.raw,signed.headers)).status,201);
    assert.equal((await f.request("/compute/ingest","POST",signed.raw,signed.headers)).json.duplicate,true);
    const other=receipt({...body,metrics:{gpuPct:99}},secret);
    assert.equal((await f.request("/compute/ingest","POST",other.raw,other.headers)).status,409);
    const state=await f.request("/compute");
    assert.equal(state.json.verifiedMeasurements,true);
    assert.equal(state.json.latest.metrics.gpuPct,73.2);
    assert.equal((await f.request("/compute/ingest","POST",{
      ...body,eventId:"measure-epoch-002",metrics:{gpuPct:130}
    },signed.headers)).status,401);
  }finally{await f.close();}
});
test("external research connector makes a true scoped call and retains grounded source links",async()=>{
  const calls=[];
  const config={CIRO_RESEARCH_SERVICE_URL:"https://research.example.org",CIRO_RESEARCH_SERVICE_TOKEN:"secret"};
  const mock=async(url,opts)=>{
    calls.push({url,headers:opts.headers});
    if(opts.method==="GET")return new Response(JSON.stringify({
      status:"completed",summary:"Grounded research",
      sources:[{title:"Verified source",url:"https://example.org/paper",excerpt:"Evidence"},
        {title:"Bad source",url:"javascript:alert(1)",excerpt:"Untrusted"}]
    }),{status:200});
    return new Response(JSON.stringify({jobId:"research-good-123"}),{status:200});
  };
  const f=await fixture(config,mock);
  try{
    assert.equal((await f.request("/research","POST",{query:"H64"})).status,202);
    const result=await f.request("/research/research-good-123");
    assert.equal(result.json.verified,true);
    assert.equal(result.json.sources.length,1);
    assert.equal(calls[0].url,"https://research.example.org/v1/research/jobs");
    assert.equal(calls[0].headers.Authorization,"Bearer secret");
    assert.equal(studioCapabilities(config).research.status,"configured_unverified");
  }finally{await f.close();}
});
test("untrusted provider URLs and media uploads outside allowlist are rejected",async()=>{
  await assert.rejects(()=>invokeStudio({
    CIRO_RESEARCH_SERVICE_URL:"http://example.com",CIRO_RESEARCH_SERVICE_TOKEN:"key"
  },"research","/v1/research/jobs",{}),/HTTPS|loopback/);
  const f=await fixture({
    CIRO_MEDIA_SERVICE_URL:"https://media.ciro.example",CIRO_MEDIA_SERVICE_TOKEN:"secret",
    CIRO_MEDIA_UPLOAD_ORIGINS:"https://uploads.ciro.example"
  },async()=>new Response(JSON.stringify({
    jobId:"media-job-123",uploadUrl:"https://attacker.example/steal",uploadHeaders:{authorization:"leak"}
  }),{status:200}));
  try{
    assert.equal((await f.request("/media/jobs","POST",{
      filename:"image.png",mime:"image/png",bytes:1200,kind:"image"
    })).status,502);
  }finally{await f.close();}
});
test("Ed25519 marketplace manifests require trusted detached signatures, never auto-execute",async()=>{
  const {privateKey,publicKey}=generateKeyPairSync("ed25519");
  const payload={id:"ciro-research-skill",kind:"skill",version:"1.2.3",
    sha256:createHash("sha256").update("sample-package").digest("hex"),
    permissions:["external.network","task.run"]};
  const signature=sign(null,Buffer.from(JSON.stringify(payload)),privateKey).toString("base64");
  const item={...payload,title:"Research skill",signature};
  assert.equal(verifyMarketplaceManifest(item,publicKey),true);
  assert.equal(verifyMarketplaceManifest({...item,sha256:"f".repeat(64)},publicKey),false);
  const config={CIRO_MARKETPLACE_URL:"https://registry.ciro.example",CIRO_MARKETPLACE_TOKEN:"token",
    CIRO_MARKETPLACE_PUBLIC_KEY:publicKey.export({type:"spki",format:"pem"})};
  const f=await fixture(config,async()=>new Response(JSON.stringify({items:[item,{...item,sha256:"f".repeat(64)}]}),{status:200}));
  try{
    const registry=await f.request("/marketplace");
    assert.equal(registry.status,200);
    assert.equal(registry.json.items.length,1);
    assert.equal(registry.json.items[0].status,"signature_verified_not_executed");
    const selection=await f.request("/marketplace/select","POST",{id:item.id,enabled:true});
    assert.equal(selection.status,200);assert.equal(selection.json.executable,false);
    assert.equal((await f.request("/marketplace")).json.selected[0].id,item.id);
  }finally{await f.close();}
});

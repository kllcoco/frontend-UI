import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

test("packaged backend contract: loopback-only, authenticated local API, normal preview status",{
 timeout:30000
},async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-desktop-server-"));
 const token="dev-local-api-token-".padEnd(48,"x");
 const proc=spawn(process.execPath,["server/index.mjs"],{
  cwd:process.cwd(),stdio:["ignore","pipe","pipe"],env:{
   ...process.env,PORT:"0",HOST:"127.0.0.1",
   CIRO_DESKTOP_TOKEN:token,CIRO_WORKSPACE_DATA_DIR:dir,
   CIRO_ACCOUNTS_ENABLED:"false",CIRO_API_BASE_URL:"",
   CIRO_DEPLOYMENT_MODE:"development",CIRO_PUBLIC_MULTI_TENANT:"false"
  }
 });
 let stderr="";
 proc.stderr.on("data",chunk=>{stderr+=chunk.toString();});
 try{
  const port=await new Promise((resolve,reject)=>{
   let output="";
   const timer=setTimeout(()=>reject(new Error("desktop server did not bind: "+stderr.slice(-350))),18000);
   proc.on("error",error=>{clearTimeout(timer);reject(error);});
   proc.on("exit",code=>{clearTimeout(timer);reject(new Error("server exited "+code+": "+stderr.slice(-350)));});
   proc.stdout.on("data",part=>{
    output+=part.toString();
    const m=/Ciro client listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
    if(m){clearTimeout(timer);resolve(Number(m[1]));}
   });
  });
  assert.ok(Number.isInteger(port)&&port>0);
  const base="http://127.0.0.1:"+port;
  let res=await fetch(base+"/api/status");
  assert.equal(res.status,403);
  res=await fetch(base+"/api/status",{headers:{"x-ciro-desktop-token":"wrong"}});
  assert.equal(res.status,403);
  res=await fetch(base+"/api/status",{headers:{"x-ciro-desktop-token":token}});
  assert.equal(res.status,200);
  assert.equal((await res.json()).mode,"preview");
  assert.match(res.headers.get("content-security-policy")||"",/default-src 'self'/);
  res=await fetch(base+"/api/chat",{
   method:"POST",headers:{"x-ciro-desktop-token":token,"content-type":"application/json"},
   body:JSON.stringify({messages:[{role:"user",content:"hello"}],model:"ciro"})
  });
  assert.equal(res.status,503);
 }finally{
  proc.kill();
  await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else{
   proc.once("exit",resolve);setTimeout(resolve,2000);
  }});
  rmSync(dir,{recursive:true,force:true});
 }
});

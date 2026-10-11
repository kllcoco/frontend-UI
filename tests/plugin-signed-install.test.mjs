import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {generateKeyPairSync,sign,randomBytes} from "node:crypto";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginGateway} from "../server/plugin-gateway.mjs";
import {canonicalPluginJSON} from "../server/plugin-package-verifier.mjs";

test("production marketplace downloads a signed package and pins digest at user install",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-signed-http-"));
 const keys=generateKeyPairSync("ed25519");
 const issuer="ciro-official",keyId="release1";
 const manifest={schema:"ciro.plugin-manifest.v1",id:"github",version:"0.8.0",
  title:"GitHub",description:"Scoped repository tool connector",
  publisher:issuer,runtime:{kind:"builtin",adapter:"github"},
  permissions:["github.read","github.write"],
  tools:["github.read_file","github.create_branch","github.write_file"],
  issuedAt:new Date(Date.now()-60_000).toISOString(),
  expiresAt:new Date(Date.now()+86_400_000).toISOString()};
 const envelope={schema:"ciro.signed-plugin.v1",issuer,keyId,manifest,signature:""};
 const resign=()=>{
  const payload={schema:envelope.schema,issuer,keyId,manifest};
  envelope.signature=sign(null,Buffer.from(canonicalPluginJSON(payload)),keys.privateKey).toString("base64url");
 };
 resign();
 let requests=0;
 const env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_DEPLOYMENT_MODE:"production",CIRO_PLUGIN_REGISTRY_ORIGIN:"https://plugins.test.example",
  CIRO_PLUGIN_REGISTRY_HOST_ALLOWLIST:"plugins.test.example",
  CIRO_PLUGIN_TRUSTED_KEYS_JSON:JSON.stringify({
   [issuer+"."+keyId]:keys.publicKey.export({type:"spki",format:"pem"}).toString()
  })};
 const runtime=createPluginGateway({dir,env,fetchFn:async(url)=>{
  requests++;
  assert.equal(url,"https://plugins.test.example/v1/plugins/github/manifest.json");
  return new Response(JSON.stringify(envelope),{status:200});
 }});
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{req.principal={id:"alice",sessionId:"browser-a",mode:"session"};next();});
 app.use("/api/plugins",runtime.router);
 const server=await new Promise(resolve=>{
  const s=app.listen(0,"127.0.0.1",()=>resolve(s));
 });
 const base="http://127.0.0.1:"+server.address().port+"/api/plugins";
 const post=async(path,body={})=>{
  const response=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  return {status:response.status,payload:await response.json()};
 };
 try{
  const pre=await post("/marketplace/github/prepare");
  assert.equal(pre.status,200);
  assert.equal(pre.payload.signedPackage.issuer,issuer);
  assert.match(pre.payload.signedPackage.digest,/^[0-9a-f]{64}$/);
  assert.equal(requests,1);
  const install=await post("/marketplace/github/install",{
   confirm:true,nonce:pre.payload.nonce,fingerprint:pre.payload.fingerprint});
  assert.equal(install.status,201);
  assert.equal(install.payload.plugin.packageDigest,pre.payload.signedPackage.digest);
  const view=await (await fetch(base+"/catalog")).json();
  assert.equal(view.installed[0].packageIssuer,issuer);
  await post("/installed/github/uninstall");
  const tampered={...envelope,manifest:{...manifest,title:"Changed without signing"}};
  Object.assign(envelope,tampered);
  const denied=await post("/marketplace/github/prepare");
  assert.equal(denied.status,403);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  runtime.store.close();runtime.installs.close();
  rmSync(dir,{recursive:true,force:true});
 }
});

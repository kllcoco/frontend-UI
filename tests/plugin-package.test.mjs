import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {canonicalPluginJSON,verifySignedPluginPackage,fetchSignedPluginPackage}
 from "../server/plugin-package-verifier.mjs";

function fixture(){
 const {publicKey,privateKey}=generateKeyPairSync("ed25519");
 const keys={"ciro-official.release-1":publicKey.export({format:"pem",type:"spki"}).toString()};
 const manifest={schema:"ciro.plugin-manifest.v1",id:"github",version:"0.8.0",
  title:"GitHub",description:"Repository read and isolated branch writes",
  publisher:"ciro-official",runtime:{kind:"builtin",adapter:"github"},
  permissions:["github.read","github.write"],
  tools:["github.read_file","github.create_branch","github.write_file"],
  issuedAt:new Date(Date.now()-3600000).toISOString(),
  expiresAt:new Date(Date.now()+86400000).toISOString()};
 const envelope={schema:"ciro.signed-plugin.v1",issuer:"ciro-official",keyId:"release-1",manifest,signature:""};
 const signCurrent=()=>{
  const payload={schema:envelope.schema,issuer:envelope.issuer,keyId:envelope.keyId,manifest:envelope.manifest};
  envelope.signature=sign(null,Buffer.from(canonicalPluginJSON(payload)),privateKey).toString("base64url");
 };
 signCurrent();
 return {envelope,keys,signCurrent};
}
test("signed manifest verifies exact Ed25519 publisher, runtime and content digest",()=>{
 const {envelope,keys}=fixture();
 const result=verifySignedPluginPackage(envelope,{keys});
 assert.equal(result.manifest.id,"github");
 assert.equal(result.runtimeAdapter,"github");
 assert.match(result.digest,/^[a-f0-9]{64}$/);
 envelope.manifest.permissions.push("admin");
 assert.throws(()=>verifySignedPluginPackage(envelope,{keys}),/signature/i);
});
test("untrusted code, arbitrary endpoint, wrong signer and stale package are refused",()=>{
 const f=fixture();
 f.envelope.manifest.runtime={kind:"javascript",adapter:"github"};
 f.signCurrent();
 assert.throws(()=>verifySignedPluginPackage(f.envelope,{keys:f.keys}),/unsupported adapter|runtime/i);
 f.envelope.manifest.runtime={kind:"builtin",adapter:"github",shell:"sh"};
 f.signCurrent();
 assert.throws(()=>verifySignedPluginPackage(f.envelope,{keys:f.keys}),/field/i);
 delete f.envelope.manifest.runtime.shell;
 f.signCurrent();
 assert.throws(()=>verifySignedPluginPackage(f.envelope,{keys:{}}),/Unknown or revoked/i);
 f.envelope.manifest.expiresAt=new Date(Date.now()-1000).toISOString();
 f.signCurrent();
 assert.throws(()=>verifySignedPluginPackage(f.envelope,{keys:f.keys}),/expired/i);
});
test("pinned HTTPS registry download binds requested ID to signed manifest",async()=>{
 const f=fixture();
 const good=await fetchSignedPluginPackage({id:"github",
  registryOrigin:"https://plugins.ciro.example",allowedRegistryHosts:["plugins.ciro.example"],
  keys:f.keys,fetchFn:async(url,options)=>{
   assert.equal(new URL(url).pathname,"/v1/plugins/github/manifest.json");
   assert.equal(options.redirect,"error");
   return new Response(JSON.stringify(f.envelope),{status:200});
  }});
 assert.equal(good.manifest.id,"github");
 await assert.rejects(()=>fetchSignedPluginPackage({id:"github",registryOrigin:"https://evil.example",
  allowedRegistryHosts:["plugins.ciro.example"],keys:f.keys,fetchFn:async()=>{throw Error("should not fetch");}}),
  /Untrusted/);
 await assert.rejects(()=>fetchSignedPluginPackage({id:"supabase",registryOrigin:"https://plugins.ciro.example",
  allowedRegistryHosts:["plugins.ciro.example"],keys:f.keys,fetchFn:async()=>new Response(JSON.stringify(f.envelope),{status:200})}),
  /does not match/);
});

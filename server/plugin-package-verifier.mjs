import {createHash,createPublicKey,verify as verifySignature} from "node:crypto";

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const fields=(obj,required,optional=[])=>{
 if(!obj||typeof obj!=="object"||Array.isArray(obj))throw fail("Invalid signed plugin object");
 const keys=Object.keys(obj);
 if(keys.some(k=>!required.includes(k)&&!optional.includes(k))||
   required.some(k=>!Object.hasOwn(obj,k)))throw fail("Unknown or missing manifest field");
};
export function canonicalPluginJSON(value){
 if(value===null||typeof value==="boolean"||typeof value==="string"||
   (typeof value==="number"&&Number.isFinite(value)))return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonicalPluginJSON).join(",")+"]";
 if(!value||typeof value!=="object"||Object.getPrototypeOf(value)!==Object.prototype)
  throw fail("Invalid package canonical JSON");
 const keys=Object.keys(value).sort();
 if(keys.some(k=>["__proto__","constructor","prototype"].includes(k)))throw fail("Unsafe manifest key");
 return "{"+keys.map(k=>JSON.stringify(k)+":"+canonicalPluginJSON(value[k])).join(",")+"}";
}
const safeLabel=(text,min,max)=>
 typeof text==="string"&&text.length>=min&&text.length<=max&&
 !/[\x00-\x1f\x7f]/.test(text);
const safeArray=(values,max,pattern)=>Array.isArray(values)&&values.length<=max&&
 new Set(values).size===values.length&&values.every(v=>typeof v==="string"&&pattern.test(v));
const manifestId=/^[a-z0-9][a-z0-9._-]{2,79}$/;
const toolName=/^[a-zA-Z0-9_.:-]{1,100}$/;
const perm=/^[a-z][a-z0-9._:-]{1,89}$/;
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]{1,40})?$/;
export function verifySignedPluginPackage(envelope,{keys,allowedAdapters=["github","supabase"],now=Date.now()}={}){
 if(JSON.stringify(envelope).length>64000)throw fail("Signed plugin package is too large");
 fields(envelope,["schema","issuer","keyId","manifest","signature"]);
 if(envelope.schema!=="ciro.signed-plugin.v1"||!manifestId.test(envelope.issuer)||
   !/^[a-zA-Z0-9_-]{1,60}$/.test(envelope.keyId))throw fail("Unsupported signed plugin envelope");
 const manifest=envelope.manifest;
 fields(manifest,["schema","id","version","title","description","publisher","runtime",
  "permissions","tools","issuedAt","expiresAt"]);
 if(manifest.schema!=="ciro.plugin-manifest.v1"||
   !manifestId.test(manifest.id)||!semver.test(manifest.version)||
   !safeLabel(manifest.title,1,90)||!safeLabel(manifest.description,1,300)||
   manifest.publisher!==envelope.issuer||
   !safeArray(manifest.permissions,32,perm)||!safeArray(manifest.tools,40,toolName))
  throw fail("Unsafe or incompatible plugin manifest");
 fields(manifest.runtime,["kind","adapter"]);
 if(manifest.runtime.kind!=="builtin"||
   !allowedAdapters.includes(manifest.runtime.adapter)||
   manifest.id!==manifest.runtime.adapter)throw fail("Unsigned executable runtime or unsupported adapter",403);
 const from=Date.parse(manifest.issuedAt),until=Date.parse(manifest.expiresAt);
 if(!Number.isFinite(from)||!Number.isFinite(until)||
   from>now+300000||until<=now||until-from>366*24*60*60*1000)
  throw fail("Package manifest timestamp is invalid or expired");
 const pub=keys?.[envelope.issuer+"."+envelope.keyId];
 if(typeof pub!=="string")throw fail("Unknown or revoked plugin publisher key",403);
 const key=createPublicKey(pub);
 if(key.asymmetricKeyType!=="ed25519")throw fail("Plugin signature key must be Ed25519",403);
 if(typeof envelope.signature!=="string"||!/^[A-Za-z0-9_-]{80,100}$/.test(envelope.signature))
  throw fail("Invalid plugin signature encoding",403);
 const message=canonicalPluginJSON({
  schema:envelope.schema,issuer:envelope.issuer,keyId:envelope.keyId,manifest
 });
 const signature=Buffer.from(envelope.signature,"base64url");
 if(signature.length!==64||!verifySignature(null,Buffer.from(message),key,signature))
  throw fail("Plugin signature verification failed",403);
 const digest=createHash("sha256").update(message).digest("hex");
 return {manifest:Object.freeze({...manifest}),digest,signer:envelope.issuer,
  runtimeAdapter:manifest.runtime.adapter};
}
export async function fetchSignedPluginPackage({id,registryOrigin,allowedRegistryHosts,keys,fetchFn=fetch}){
 if(typeof id!=="string"||!manifestId.test(id))throw fail("Invalid plugin package ID");
 let base;try{base=new URL(registryOrigin);}catch{throw fail("Plugin registry is not configured",503);}
 if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash||
   !Array.isArray(allowedRegistryHosts)||!allowedRegistryHosts.includes(base.hostname))
  throw fail("Untrusted plugin registry hostname",403);
 const url=new URL("/v1/plugins/"+encodeURIComponent(id)+"/manifest.json",base);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
 try{
  const response=await fetchFn(url.href,{signal:controller.signal,redirect:"error",
   headers:{"Accept":"application/json"}});
  if(!response.ok)throw fail("Plugin package download failed",502);
  const raw=await response.text();
  if(Buffer.byteLength(raw)>64000)throw fail("Plugin package too large",413);
  let envelope;try{envelope=JSON.parse(raw);}catch{throw fail("Invalid package JSON");}
  const verified=verifySignedPluginPackage(envelope,{keys});
  if(verified.manifest.id!==id)throw fail("Plugin ID does not match signed package",403);
  return {...verified,envelope};
 }finally{clearTimeout(timer);}
}

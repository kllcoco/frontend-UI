import {createHash,createPublicKey,verify as verifyEd25519} from "node:crypto";

const DOMAIN="ciro.plugin.manifest.v1\n";
const VALID_TOOLS={
 github:new Set(["github.read_file","github.create_branch","github.write_file"]),
 supabase:new Set(["supabase.list_tools","supabase.call_tool"])
};
const VALID_PERMISSIONS={
 github:new Set(["github.read","github.write"]),
 supabase:new Set(["external.network","database.read","database.write"])
};
const reject=(reason)=>{const e=new Error("Signed plugin package rejected: "+reason);e.statusCode=403;throw e;};
function canonical(value){
 if(value===null||typeof value==="boolean"||typeof value==="string")return JSON.stringify(value);
 if(typeof value==="number"&&Number.isSafeInteger(value))return JSON.stringify(value);
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(value&&typeof value==="object"&&Object.getPrototypeOf(value)===Object.prototype){
  const keys=Object.keys(value).sort();
  return "{"+keys.map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
 }
 return reject("unsupported JSON type");
}
function exactKeys(object,permitted){
 if(!object||typeof object!=="object"||Array.isArray(object))reject("manifest must be a JSON object");
 if(Object.keys(object).some(x=>!permitted.includes(x)))reject("unknown or executable fields prohibited");
}
export function inspectSignedPluginPackage(envelope,{publicKeys,expectedId}={}){
 exactKeys(envelope,["manifest","kid","signature"]);
 const m=envelope.manifest;
 exactKeys(m,["schema","id","version","publisher","provider","title","description","tools","permissions"]);
 if(m.schema!=="ciro.plugin.manifest.v1"||m.provider!==m.id||!(m.id in VALID_TOOLS))
  reject("unsupported connector or schema");
 if(m.id!==expectedId)reject("manifest identity differs from requested plugin");
 if(typeof m.version!=="string"||!/^\d+\.\d+\.\d+$/.test(m.version))
  reject("unversioned plugin");
 for(const name of ["publisher","title","description"]){
  const max=name==="description"?300:90;
  if(typeof m[name]!=="string"||!m[name].trim()||m[name].length>max)
   reject("invalid "+name);
 }
 if(!Array.isArray(m.tools)||m.tools.length<1||m.tools.length>12||
    new Set(m.tools).size!==m.tools.length||
    m.tools.some(x=>typeof x!=="string"||!VALID_TOOLS[m.provider].has(x)))
  reject("tool permission escalation");
 if(!Array.isArray(m.permissions)||m.permissions.length<1||
    new Set(m.permissions).size!==m.permissions.length||
    m.permissions.some(x=>typeof x!=="string"||!VALID_PERMISSIONS[m.provider].has(x)))
  reject("permission escalation");
 if(typeof envelope.kid!=="string"||!/^[a-zA-Z0-9._-]{1,50}$/.test(envelope.kid))
  reject("missing signing key identity");
 const publicKey=publicKeys?.[envelope.kid];
 if(typeof publicKey!=="string"||!publicKey)reject("publisher signing key not pinned");
 if(typeof envelope.signature!=="string"||!/^[a-zA-Z0-9_-]{85,90}$/.test(envelope.signature))
  reject("invalid detached Ed25519 signature");
 let pub;
 try{pub=createPublicKey(publicKey);}catch{reject("invalid publisher public key");}
 if(pub.asymmetricKeyType!=="ed25519")reject("only Ed25519 signing keys accepted");
 const bytes=Buffer.from(DOMAIN+canonical(m),"utf8");
 if(bytes.byteLength>20000)reject("manifest too large");
 if(!verifyEd25519(null,bytes,pub,Buffer.from(envelope.signature,"base64url")))
  reject("signature mismatch");
 const manifestHash=createHash("sha256").update(bytes).digest("hex");
 return {manifest:m,manifestHash,kid:envelope.kid};
}
export async function downloadSignedPluginPackage({id,registryOrigin,publicKeys,fetchFn=fetch}={}){
 if(typeof id!=="string"||!/^[a-z][a-z0-9-]{1,48}$/.test(id))
  reject("invalid requested plugin ID");
 let root;
 try{root=new URL(registryOrigin);}catch{reject("invalid configured registry URL");}
 if(root.protocol!=="https:"||root.username||root.password||root.search||root.hash||
    root.hostname==="localhost"||root.hostname.endsWith(".localhost")||
    root.hostname.endsWith(".local")||/^\d+\.\d+\.\d+\.\d+$/.test(root.hostname))
  reject("registry must use an operator-pinned public HTTPS origin");
 const target=new URL("/v1/plugins/"+encodeURIComponent(id)+"/manifest",root.origin);
 const response=await fetchFn(target.href,{
  method:"GET",redirect:"error",signal:AbortSignal.timeout(12000),
  headers:{"Accept":"application/json"}});
 if(!response.ok)reject("registry fetch failed");
 if(Number(response.headers.get("content-length")||0)>65536)
  reject("registry package exceeds limit");
 const text=await response.text();
 if(text.length>65536)reject("registry package exceeds limit");
 let parsed;
 try{parsed=JSON.parse(text);}catch{reject("package is not JSON");}
 return inspectSignedPluginPackage(parsed,{publicKeys,expectedId:id});
}
export function canonicalManifestForSigning(manifest){return DOMAIN+canonical(manifest);}

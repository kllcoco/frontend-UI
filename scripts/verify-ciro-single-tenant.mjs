import {existsSync,lstatSync,realpathSync,statSync,readFileSync} from "node:fs";
import {isAbsolute,resolve,join} from "node:path";
import {fileURLToPath} from "node:url";
import {assertPluginDeploymentSafe} from "../server/plugin-release-gate.mjs";
import {validateRepo} from "../server/agent-policy.mjs";

// Configuration-only qualification for a dedicated Linux single-owner installation.
// Does NOT claim a live OAuth/MCP/provider test or an external TLS audit.
export function verifySingleTenantReadiness(env=process.env,{platform=process.platform,uid=process.getuid?.()}={}){
 const failures=[],warnings=[];
 function requireCondition(ok,code){if(!ok)failures.push(code);}
 try{assertPluginDeploymentSafe(env);}
 catch{failures.push("release_mode_or_public_tenancy_denied");}
 requireCondition(env.CIRO_DEPLOYMENT_MODE==="single-owner","dedicated_single_owner_mode_required");
 requireCondition(env.CIRO_ACCOUNTS_ENABLED==="true","authenticated_owner_required");
 requireCondition(["127.0.0.1","::1","localhost"].includes(env.HOST||"127.0.0.1"),"loopback_only_listener_required");
 requireCondition(platform==="linux","dedicated_pilot_requires_linux_security_review");
 if(env.CIRO_PUBLIC_MULTI_TENANT==="true")failures.push("public_multi_tenant_not_qualified");
 const key=env.CIRO_ACCOUNT_DATA_KEY;
 let decoded;
 try{decoded=Buffer.from(key||"","base64");}
 catch{decoded=null;}
 requireCondition(typeof key==="string"&&/^[A-Za-z0-9+/]+={0,2}$/.test(key)&&
  decoded?.length===32,"stable_32_byte_account_encryption_key_required");
 const absolute=env.CIRO_WORKSPACE_DATA_DIR;
 requireCondition(typeof absolute==="string"&&isAbsolute(absolute),"absolute_private_state_directory_required");
 if(typeof absolute==="string"&&isAbsolute(absolute)){
  // Never route a brand-new account over the public TLS proxy before the
  // trusted operator completes a local, token-guarded initial bootstrap.
  const accountPath=join(absolute,"account-state.json");
  try{
   const account=JSON.parse(readFileSync(accountPath,"utf8"));
   const owner=account?.owner;
   requireCondition(account?.version===1&&Array.isArray(account.sessions)&&
    Array.isArray(account.apiKeys)&&typeof owner?.id==="string"&&owner.id.length>10&&
    typeof owner?.email==="string"&&owner.email.includes("@")&&
    typeof owner?.passwordHash==="string"&&/^[a-f0-9]{128}$/.test(owner.passwordHash)&&
    typeof owner?.salt==="string"&&owner.salt.length>=20,
    "trusted_owner_bootstrap_required_before_public_pilot");
  }catch{failures.push("trusted_owner_bootstrap_required_before_public_pilot");}
  if(typeof env.CIRO_BOOTSTRAP_TOKEN==="string"&&env.CIRO_BOOTSTRAP_TOKEN)
   failures.push("remove_one_time_bootstrap_token_before_public_pilot");

  try{
   const meta=lstatSync(absolute);
   requireCondition(meta.isDirectory()&&!meta.isSymbolicLink(),"unsafe_state_directory_type");
   requireCondition(realpathSync(absolute)===absolute,"state_directory_symlink_not_allowed");
   if(platform!=="win32"){
    requireCondition((meta.mode&0o077)===0,"state_directory_permissions_must_be_0700");
    if(Number.isInteger(uid))requireCondition(meta.uid===uid,"state_directory_owner_mismatch");
   }
   for(const name of ["plugin-control.sqlite","plugin-control.sqlite-wal","plugin-control.sqlite-shm",
    "account-state.json","state.json","studio-state.json"]){
    const file=join(absolute,name);
    if(!existsSync(file))continue;
    const fsmeta=lstatSync(file);
    requireCondition(fsmeta.isFile()&&!fsmeta.isSymbolicLink(),"unsafe_state_file_"+name.replaceAll(".","_"));
    if(platform!=="win32")requireCondition((fsmeta.mode&0o077)===0,
      "state_file_permissions_must_be_0600_"+name.replaceAll(".","_"));
   }
  }catch{failures.push("state_directory_not_accessible");}
 }
 try{
  const origin=new URL(env.CIRO_PUBLIC_ORIGIN||"");
  requireCondition(origin.protocol==="https:"&&!origin.username&&!origin.password&&!origin.search&&!origin.hash&&
   !["localhost","127.0.0.1","::1"].includes(origin.hostname),"verified_public_https_origin_required");
 }catch{failures.push("verified_public_https_origin_required");}
 try{
  const model=new URL(env.CIRO_API_BASE_URL||"");
  requireCondition(!model.username&&!model.password&&(
   model.protocol==="https:"||
   (model.protocol==="http:"&&["127.0.0.1","localhost","::1"].includes(model.hostname))
  ),"configured_safe_model_backend_required");
 }catch{failures.push("configured_safe_model_backend_required");}
 const client=env.CIRO_GITHUB_OAUTH_CLIENT_ID,secret=env.CIRO_GITHUB_OAUTH_CLIENT_SECRET;
 requireCondition(typeof client==="string"&&client.length>=4&&
  typeof secret==="string"&&secret.length>=12,"github_oauth_app_not_configured");
 const repos=(env.CIRO_GITHUB_REPOS||"").split(",").filter(Boolean).map(x=>x.trim());
 try{requireCondition(repos.length>0&&repos.every(x=>validateRepo(x)),"scoped_github_repository_allowlist_required");}
 catch{failures.push("scoped_github_repository_allowlist_required");}
 if(env.CIRO_GITHUB_WRITES==="true")
  warnings.push("External GitHub writes require separate on-screen approval and disposable-repository live qualification.");
 if(!env.CIRO_PLUGIN_REGISTRY_ORIGIN)
  warnings.push("Only bundled adapters qualify for this pilot. Public downloadable packages require pinned signer and registry.");
 if(env.CIRO_SUPABASE_MCP_RLS_VERIFIED==="true")
  warnings.push("Supabase RLS setting is NOT evidence; independent two-user live test still required.");
 if(!env.CIRO_AGENT_TOOL_CAPABILITY_SECRET)
  warnings.push("Agent runner may not be issued delegated plugin tool capabilities.");
 const results={schema:"ciro.single-tenant-preflight.v1",passed:failures.length===0,
  scope:"dedicated_one_owner_one_host_only",checks:{configuration:failures.length===0,
   liveGithubOAuth:"NOT_RUN",liveSupabaseRLS:"NOT_RUN",tlsProxyAudit:"NOT_RUN",
   independentPenTest:"NOT_RUN",publicMultiTenant:"NOT_QUALIFIED"},failures,warnings};
 return results;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const report=verifySingleTenantReadiness();
 process.stdout.write(JSON.stringify(report,null,2)+"\n");
 if(!report.passed)process.exitCode=1;
}

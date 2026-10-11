// CIRO v0.8 launch contract. The account service on this branch has exactly
// one owner and is not a public multi-tenant identity provider. Never allow
// a deployment flag or successful unit tests to silently relabel it as one.
export function assertPluginDeploymentSafe(env=process.env){
 const mode=env.CIRO_DEPLOYMENT_MODE||"development";
 if(!["development","single-owner","production"].includes(mode))
  throw new Error("Unknown CIRO deployment mode");
 if(mode==="production"||env.CIRO_PUBLIC_MULTI_TENANT==="true")
  throw new Error("CIRO public multi-tenant launch refused: the V0.8 account store is single-owner and the public identity/queue/tenant boundary has not passed qualification.");
 if(mode==="single-owner"){
  if(env.CIRO_ACCOUNTS_ENABLED!=="true")
   throw new Error("Single-owner deployment requires authenticated CIRO accounts");
  if(!["127.0.0.1","::1","localhost"].includes(env.HOST||"127.0.0.1"))
   throw new Error("Single-owner deployment requires loopback binding behind a trusted TLS proxy");
  if(env.CIRO_PLUGIN_REGISTRY_ORIGIN && !env.CIRO_PLUGIN_TRUSTED_KEYS_JSON)
   throw new Error("Signed plugin registry requires pinned publisher keys");
 }
 return {mode,publicMultiTenantQualified:false};
}

// CIRO launch contract. "multi-user" is a hosted server where people register their own accounts:
// chats, keys, memories and sync are per user, while the shared workbench / studio / plugins stay
// owner-only. Plugins running for many tenants ("production" / CIRO_PUBLIC_MULTI_TENANT) have not
// passed qualification; never allow a flag or green unit tests to relabel the server as that.
export function assertPluginDeploymentSafe(env=process.env){
 const mode=env.CIRO_DEPLOYMENT_MODE||"development";
 if(!["development","single-owner","multi-user","production"].includes(mode))
  throw new Error("Unknown CIRO deployment mode");
 if(mode==="production"||env.CIRO_PUBLIC_MULTI_TENANT==="true")
  throw new Error("CIRO public multi-tenant launch refused: plugins, workbench and studio are shared server state and their tenant boundary has not passed qualification; use CIRO_DEPLOYMENT_MODE=multi-user.");
 if(mode==="single-owner"||mode==="multi-user"){
  if(env.CIRO_ACCOUNTS_ENABLED!=="true")
   throw new Error((mode==="multi-user"?"Multi-user":"Single-owner")+" deployment requires authenticated CIRO accounts");
  if(!["127.0.0.1","::1","localhost"].includes(env.HOST||"127.0.0.1"))
   throw new Error("Authenticated deployment requires loopback binding behind a trusted TLS proxy");
  if(mode==="multi-user"&&!/^https:\/\//.test(env.CIRO_PUBLIC_ORIGIN||""))
   throw new Error("Multi-user deployment requires CIRO_PUBLIC_ORIGIN=https://...");
  if(env.CIRO_PLUGIN_REGISTRY_ORIGIN && !env.CIRO_PLUGIN_TRUSTED_KEYS_JSON)
   throw new Error("Signed plugin registry requires pinned publisher keys");
 }
 return {mode,publicMultiTenantQualified:false};
}

import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {verifySingleTenantReadiness} from "../scripts/verify-ciro-single-tenant.mjs";

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),"ciro-tenant-preflight-"));
 const env={CIRO_DEPLOYMENT_MODE:"single-owner",CIRO_ACCOUNTS_ENABLED:"true",
  HOST:"127.0.0.1",CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
  CIRO_WORKSPACE_DATA_DIR:dir,CIRO_PUBLIC_ORIGIN:"https://ciro.example.org",
  CIRO_API_BASE_URL:"http://127.0.0.1:8500",
  CIRO_GITHUB_OAUTH_CLIENT_ID:"test-client",
  CIRO_GITHUB_OAUTH_CLIENT_SECRET:"test-private-client-secret",
  CIRO_GITHUB_REPOS:"demo/project"};
 return {dir,env,close:()=>rmSync(dir,{recursive:true,force:true})};
}
test("single-tenant pilot preflight requires private data, scoped OAuth and safe loopback",()=>{
 const f=fixture();
 try{
  const result=verifySingleTenantReadiness(f.env,{platform:"linux",uid:process.getuid()});
  assert.equal(result.passed,true,JSON.stringify(result));
  assert.equal(result.checks.liveGithubOAuth,"NOT_RUN");
  assert.equal(result.checks.publicMultiTenant,"NOT_QUALIFIED");
  assert.ok(!JSON.stringify(result).includes(f.env.CIRO_ACCOUNT_DATA_KEY));
  assert.ok(!JSON.stringify(result).includes(f.env.CIRO_GITHUB_OAUTH_CLIENT_SECRET));
 }finally{f.close();}
});
test("public tenant deployment cannot be relabelled as a single-tenant pilot",()=>{
 const f=fixture();
 try{
  const result=verifySingleTenantReadiness({...f.env,CIRO_PUBLIC_MULTI_TENANT:"true"});
  assert.equal(result.passed,false);
  assert.ok(result.failures.includes("public_multi_tenant_not_qualified"));
 }finally{f.close();}
});
test("insecure state files, missing credentials and untrusted backend abort admission",()=>{
 const f=fixture();
 try{
  writeFileSync(join(f.dir,"plugin-control.sqlite"),"staging", {mode:0o644});
  const bad=verifySingleTenantReadiness({...f.env,
   CIRO_PUBLIC_ORIGIN:"http://127.0.0.1:8080",
   CIRO_API_BASE_URL:"http://untrusted.example",
   CIRO_GITHUB_OAUTH_CLIENT_SECRET:"",
   CIRO_ACCOUNT_DATA_KEY:"oops"}, {platform:"linux",uid:process.getuid()});
  assert.equal(bad.passed,false);
  assert.ok(bad.failures.some(x=>x.startsWith("state_file_permissions_must_be")));
  assert.ok(bad.failures.includes("verified_public_https_origin_required"));
  assert.ok(bad.failures.includes("configured_safe_model_backend_required"));
  assert.ok(bad.failures.includes("stable_32_byte_account_encryption_key_required"));
  assert.ok(bad.failures.includes("github_oauth_app_not_configured"));
 }finally{f.close();}
});

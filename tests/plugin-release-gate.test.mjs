import test from "node:test";
import assert from "node:assert/strict";
import {assertPluginDeploymentSafe} from "../server/plugin-release-gate.mjs";

test("v0.8 refuses public multitenancy rather than pretending single-owner account storage is safe",()=>{
 const unsafe=[
  {CIRO_DEPLOYMENT_MODE:"production",CIRO_ACCOUNTS_ENABLED:"true"},
  {CIRO_PUBLIC_MULTI_TENANT:"true"},
  {CIRO_DEPLOYMENT_MODE:"production",CIRO_PUBLIC_MULTI_TENANT:"true"},
 ];
 for(const env of unsafe)assert.throws(()=>assertPluginDeploymentSafe(env),/public multi-tenant launch refused/);
});
test("single-owner and development configurations remain available under explicit constraints",()=>{
 assert.equal(assertPluginDeploymentSafe({}).mode,"development");
 assert.equal(assertPluginDeploymentSafe({CIRO_DEPLOYMENT_MODE:"single-owner",
  CIRO_ACCOUNTS_ENABLED:"true",HOST:"127.0.0.1"}).mode,"single-owner");
 assert.throws(()=>assertPluginDeploymentSafe({CIRO_DEPLOYMENT_MODE:"single-owner"}),
  /requires authenticated/);
 assert.throws(()=>assertPluginDeploymentSafe({CIRO_DEPLOYMENT_MODE:"single-owner",
  CIRO_ACCOUNTS_ENABLED:"true",HOST:"0.0.0.0"}),/loopback/);
});

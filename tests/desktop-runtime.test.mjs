import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync,readFileSync,rmSync,statSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const require=createRequire(import.meta.url);
const {trustedLocalUrl,loadOrCreateSecrets,childEnvironment}=
 require("../desktop/runtime.cjs");

test("desktop only trusts the active loopback origin and exact port",()=>{
 assert.equal(trustedLocalUrl("http://127.0.0.1:13378/",13378),true);
 assert.equal(trustedLocalUrl("http://localhost:13378/api/status",13378),true);
 for(const candidate of [
  "https://127.0.0.1:13378","http://127.0.0.1:13379",
  "http://127.0.0.1.evil.test:13378",
  "http://evil.test:13378",
  "http://user@127.0.0.1:13378",
  "file:///C:/Windows/system.ini",
  "javascript:alert(1)"
 ])assert.equal(trustedLocalUrl(candidate,13378),false,candidate);
});
test("desktop generates stable per-user local secrets and enforces single owner",()=>{
 const root=mkdtempSync(join(tmpdir(),"ciro-electron-"));
 try{
  const first=loadOrCreateSecrets(root);
  assert.equal(first.firstRun,true);
  assert.equal(first.record.schema,1);
  assert.equal(Buffer.from(first.record.accountDataKey,"base64").length,32);
  assert.ok(first.record.bootstrapToken.length>=24);
  const again=loadOrCreateSecrets(root);
  assert.equal(again.firstRun,false);
  assert.deepEqual(first.record,again.record);
  if(process.platform!=="win32")assert.equal(statSync(first.path).mode&0o077,0);
  const env=childEnvironment({HOST:"0.0.0.0",PORT:"8080",
   CIRO_ACCOUNTS_ENABLED:"false",CIRO_PUBLIC_MULTI_TENANT:"true"},root,first.record);
  assert.equal(env.HOST,"127.0.0.1");
  assert.equal(env.PORT,"0");
  assert.equal(env.CIRO_ACCOUNTS_ENABLED,"true");
  assert.equal(env.CIRO_PUBLIC_MULTI_TENANT,"false");
  assert.equal(env.CIRO_DEPLOYMENT_MODE,"single-owner");
  assert.equal(env.CIRO_WORKSPACE_DATA_DIR,root);
  assert.equal(env.CIRO_GITHUB_FINE_GRAINED_PAT_ENABLED,"true");
  assert.ok(!readFileSync(first.envPath,"utf8").includes(first.record.accountDataKey));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test("desktop child ignores inherited secrets, repository grants and Node startup hooks",()=>{
 const {childEnvironment}=require("../desktop/runtime.cjs");
 const root="C:/user/ciro-data";
 const record={accountDataKey:Buffer.alloc(32,7).toString("base64"),
  apiPepper:"p".repeat(30),bootstrapToken:"t".repeat(30)};
 const env=childEnvironment({PATH:"C:/bin",SystemRoot:"C:/Windows",
  CIRO_GITHUB_REPOS:"attacker/repo",CIRO_GITHUB_WRITES:"true",
  CIRO_GITHUB_TOKEN:"ambient-secret",CIRO_API_BASE_URL:"https://untrusted.example",
  CIRO_ACCOUNT_DATA_KEY:"wrong-key",CIRO_PLUGIN_TRUSTED_KEYS_JSON:"untrusted",
  NODE_OPTIONS:"--require ./evil.js",NODE_PATH:"./evil-modules",
  DOTENV_CONFIG_PATH:"C:/temp/evil.env",HOST:"0.0.0.0",PORT:"8080"},root,record);
 assert.equal(env.PATH,"C:/bin");
 assert.equal(env.SystemRoot,"C:/Windows");
 for(const k of ["CIRO_GITHUB_REPOS","CIRO_GITHUB_WRITES","CIRO_GITHUB_TOKEN",
  "CIRO_API_BASE_URL","CIRO_PLUGIN_TRUSTED_KEYS_JSON","NODE_OPTIONS",
  "NODE_PATH","DOTENV_CONFIG_PATH"])assert.equal(env[k],undefined,k);
 assert.equal(env.CIRO_ACCOUNT_DATA_KEY,record.accountDataKey);
 assert.equal(env.HOST,"127.0.0.1");
 assert.equal(env.PORT,"0");
 assert.equal(env.ELECTRON_RUN_AS_NODE,"1");
});

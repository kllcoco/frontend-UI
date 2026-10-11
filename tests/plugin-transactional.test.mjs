import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {randomBytes} from "node:crypto";
import {createPluginInstallStore} from "../server/plugin-install-store.mjs";
import {createPluginConnectionStore} from "../server/plugin-connection-store.mjs";

function folder(){return mkdtempSync(join(tmpdir(),"ciro-tx-store-"));}
function cleanup(dir,stores=[]){
 for(const instance of stores)instance.close();
 rmSync(dir,{recursive:true,force:true});
}
test("two live marketplace workers observe atomic install, enable, and uninstall without restart",()=>{
 const dir=folder(),a=createPluginInstallStore({dir}),b=createPluginInstallStore({dir});
 try{
  const intent=a.prepare({ownerId:"alice",sessionId:"session-a",id:"github"});
  const args={ownerId:"alice",sessionId:"session-a",id:"github",
   nonce:intent.nonce,fingerprint:intent.fingerprint,confirm:true};
  assert.equal(b.install(args).id,"github");
  assert.equal(a.installed("alice","github").enabled,true);
  assert.equal(a.installed("bob","github"),null);
  assert.throws(()=>a.install(args),/expired or mismatched/);
  b.setEnabled("alice","github",false);
  assert.equal(a.installed("alice","github").enabled,false);
  a.uninstall("alice","github");
  assert.equal(b.installed("alice","github"),null);
 }finally{cleanup(dir,[a,b]);}
});
test("OAuth nonce and approval claim are cross-worker, single-use transactions",()=>{
 const dir=folder(),env={CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64")};
 const a=createPluginConnectionStore({dir,env}),b=createPluginConnectionStore({dir,env});
 try{
  a.addOAuth({ownerId:"alice",sessionId:"web1",stateHash:"sha-state",verifier:"random-state"});
  assert.equal(b.takeOAuth({ownerId:"alice",sessionId:"web1",stateHash:"sha-state"}).verifier,"random-state");
  assert.equal(a.takeOAuth({ownerId:"alice",sessionId:"web1",stateHash:"sha-state"}),null);
  const generation=a.putConnection({ownerId:"alice",provider:"github",
   account:{id:1},secret:{accessToken:"secret-a"},scopes:["repo"]});
  const pending=a.queueApproval({ownerId:"alice",provider:"github",tool:"github.write_file",
   args:{repo:"alice/work"},source:"chat",policySignature:"policy1",generation,
   summary:"write"});
  const item=b.takeApproval("alice",pending.id,"approve");
  assert.equal(item.request.tool,"github.write_file");
  assert.throws(()=>a.takeApproval("alice",pending.id,"approve"),/claimed/);
  b.finishApproval("alice",pending.id,"approved");
  assert.equal(a.getApproval("alice",pending.id),null);
  assert.throws(()=>a.finishApproval("alice",pending.id,"approved"),/not in processing/);
  assert.equal(b.connection("alice","github").secret.accessToken,"secret-a");
  a.removeConnection("alice","github");
  assert.equal(b.connection("alice","github"),null);
  assert.throws(()=>b.rotateConnectionSecret("alice","github",generation,{accessToken:"secret-b"}),/revoked or replaced/);
 }finally{cleanup(dir,[a,b]);}
});
test("legacy JSON state is imported exactly once into locked transactional storage",()=>{
 const dir=folder(),file=join(dir,"plugin-installs.json");
 const old={version:1,installed:[{ownerId:"alice",id:"github",version:"0.8.0",enabled:true,
   manifestHash:"known",installedAt:"2026-10-10T01:00:00Z"}],intents:[],audit:[]};
 writeFileSync(file,JSON.stringify(old),{mode:0o600});
 const a=createPluginInstallStore({dir});
 try{
  assert.equal(a.installed("alice","github").manifestHash,"known");
  a.setEnabled("alice","github",false);
  const b=createPluginInstallStore({dir});
  try{assert.equal(b.installed("alice","github").enabled,false);}
  finally{b.close();}
  assert.deepEqual(JSON.parse(readFileSync(file,"utf8")),old);
 }finally{cleanup(dir,[a]);}
});
test("corrupt legacy state fails closed instead of resetting plugin grants",()=>{
 const dir=folder(),path=join(dir,"plugin-installs.json");
 writeFileSync(path,JSON.stringify({version:99,installed:[]}),{mode:0o600});
 try{assert.throws(()=>createPluginInstallStore({dir}),/incompatible/);}
 finally{rmSync(dir,{recursive:true,force:true});}
});

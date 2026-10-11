import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPluginInstallStore} from "../server/plugin-install-store.mjs";

function fixture(fn){
 const dir=mkdtempSync(join(tmpdir(),"ciro-marketplace-"));
 try{return fn(createPluginInstallStore({dir}),dir);}finally{rmSync(dir,{recursive:true,force:true});}
}
test("marketplace installation requires matching, browser-session-bound, single-use consent",()=>{
 fixture(store=>{
  assert.equal(store.installed("alice","github"),null);
  const request=store.prepare({ownerId:"alice",sessionId:"browser-1",id:"github"});
  assert.throws(()=>store.install({ownerId:"alice",sessionId:"browser-2",id:"github",nonce:request.nonce,
   fingerprint:request.fingerprint,confirm:true}),/expired or mismatched/);
  assert.throws(()=>store.install({ownerId:"alice",sessionId:"browser-1",id:"github",nonce:request.nonce,
   fingerprint:request.fingerprint,confirm:false}),/Explicit marketplace confirmation/);
  assert.throws(()=>store.install({ownerId:"alice",sessionId:"browser-1",id:"github",nonce:request.nonce,
   fingerprint:"f".repeat(64),confirm:true}),/expired or mismatched/);
  const out=store.install({ownerId:"alice",sessionId:"browser-1",id:"github",
   nonce:request.nonce,fingerprint:request.fingerprint,confirm:true});
  assert.equal(out.id,"github");
  assert.equal(store.installed("alice","github")?.enabled,true);
  assert.equal(store.installed("bob","github"),null);
  assert.throws(()=>store.install({ownerId:"alice",sessionId:"browser-1",id:"github",
   nonce:request.nonce,fingerprint:request.fingerprint,confirm:true}),/expired or mismatched/);
 });
});
test("uninstall and disable refuse use, preview integrations cannot be installed",()=>{
 fixture(store=>{
  assert.throws(()=>store.prepare({ownerId:"a",sessionId:"s",id:"supabase"}),/not ready/);
  const r=store.prepare({ownerId:"a",sessionId:"s",id:"github"});
  store.install({ownerId:"a",sessionId:"s",id:"github",nonce:r.nonce,fingerprint:r.fingerprint,confirm:true});
  store.setEnabled("a","github",false);
  assert.equal(store.installed("a","github").enabled,false);
  assert.throws(()=>store.setEnabled("bob","github",true),/not installed/);
  store.uninstall("a","github");
  assert.equal(store.installed("a","github"),null);
  assert.throws(()=>store.uninstall("a","github"),/not installed/);
 });
});
test("installation remains persisted per owner across process restart",()=>{
 fixture((store,dir)=>{
  const r=store.prepare({ownerId:"a",sessionId:"s",id:"github"});
  store.install({ownerId:"a",sessionId:"s",id:"github",nonce:r.nonce,fingerprint:r.fingerprint,confirm:true});
  const loaded=createPluginInstallStore({dir});
  assert.equal(loaded.list("a").length,1);
  assert.equal(loaded.list("b").length,0);
 });
});

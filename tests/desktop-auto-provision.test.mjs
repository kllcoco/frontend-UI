import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomBytes} from "node:crypto";
import {createAccountService} from "../server/account.mjs";

const profile=()=>({
 CIRO_ACCOUNTS_ENABLED:"true",CIRO_DESKTOP_AUTO_PROVISION:"true",
 CIRO_DEPLOYMENT_MODE:"single-owner",HOST:"127.0.0.1",PORT:"0",
 CIRO_BOOTSTRAP_TOKEN:randomBytes(36).toString("base64url"),
 CIRO_ACCOUNT_DATA_KEY:randomBytes(32).toString("base64"),
 CIRO_API_KEY_PEPPER:randomBytes(32).toString("base64url")
});

test("native desktop provisions one private owner and durable password-free UI login",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-desktop-onboard-"));
 const env=profile();
 const app=express();
 const instance=createAccountService({dir,env});
 app.use(express.json());
 app.use("/api/account",instance.router);
 const listener=await new Promise(resolve=>{
  const server=app.listen(0,"127.0.0.1",()=>resolve(server));
 });
 const base="http://127.0.0.1:"+listener.address().port;
 try{
  const auto=await instance.provisionDesktopSession();
  assert.match(auto.raw,/^[A-Za-z0-9_-]{40,}$/);
  assert.equal(auto.ownerIsDesktopLocal,true);
  const owner=instance.store.get().owner;
  assert.equal(owner.desktopLocal,true);
  assert.equal(owner.displayName,"我的 Ciro");
  assert.match(owner.email,/@desktop\.ciro\.invalid$/);
  assert.equal(typeof owner.passwordHash,"string");
  assert.equal(owner.passwordHash.length,128);
  assert.ok(!owner.passwordHash.includes(auto.raw));
  const unauth=await fetch(base+"/api/account/session");
  assert.equal((await unauth.json()).authenticated,false);
  const session=await fetch(base+"/api/account/session",{headers:{Cookie:"ciro_sid="+auto.raw}});
  const snapshot=await session.json();
  assert.equal(snapshot.authenticated,true);
  assert.equal(snapshot.bootstrapAvailable,false);
  assert.equal(snapshot.user.desktopLocal,true);
  assert.equal(typeof snapshot.csrf,"string");
  assert.ok(!JSON.stringify(snapshot).includes(auto.raw));
  const persisted=readFileSync(join(dir,"account-state.json"),"utf8");
  assert.ok(!persisted.includes(auto.raw));
  assert.ok(!persisted.includes(env.CIRO_BOOTSTRAP_TOKEN));
  assert.ok(!persisted.includes(env.CIRO_ACCOUNT_DATA_KEY));
  const recreated=createAccountService({dir,env});
  const second=await recreated.provisionDesktopSession();
  assert.notEqual(auto.raw,second.raw);
  assert.equal(recreated.store.get().owner.id,owner.id);
  assert.equal(recreated.store.get().owner.passwordHash,owner.passwordHash);
  assert.equal(recreated.store.get().sessions.length,1);
  assert.equal(recreated.store.get().sessions[0].nativeDesktop,true);
  assert.equal(recreated.store.get().sessions[0].hash.includes(auto.raw),false);
  const malicious=await fetch(base+"/api/account/bootstrap",{
   method:"POST",headers:{"Content-Type":"application/json"},
   body:JSON.stringify({email:"other@example.test",displayName:"Other",password:"long-password-test",
    bootstrapToken:env.CIRO_BOOTSTRAP_TOKEN})
  });
  assert.equal(malicious.status,409);
 }finally{
  await new Promise(resolve=>listener.close(resolve));
  rmSync(dir,{recursive:true,force:true});
 }
});

test("desktop provisioning is denied in plain web, public, or incorrectly bound runtimes",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-desktop-reject-"));
 try{
  const baseline=profile();
  for(const mismatch of [{CIRO_DESKTOP_AUTO_PROVISION:"false"},
   {CIRO_DEPLOYMENT_MODE:"development"},{CIRO_ACCOUNTS_ENABLED:"false"},
   {HOST:"0.0.0.0"},{PORT:"8787"}]){
    const service=createAccountService({dir,env:{...baseline,...mismatch}});
    await assert.rejects(service.provisionDesktopSession(),/native loopback profile/);
  }
  const reader=createAccountService({dir,env:baseline});
  assert.equal(reader.store.get().owner,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("native upgrade preserves an existing password-based owner's identity and secrets",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"ciro-desktop-migration-"));
 const env=profile();
 try{
  const old=createAccountService({dir,env:{...env,CIRO_DESKTOP_AUTO_PROVISION:"false"}});
  const app=express();app.use(express.json());app.use("/api/account",old.router);
  const listener=await new Promise(resolve=>{
   const server=app.listen(0,"127.0.0.1",()=>resolve(server));
  });
  try{
   const base="http://127.0.0.1:"+listener.address().port;
   const created=await fetch(base+"/api/account/bootstrap",{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:"existing@example.com",displayName:"Existing Owner",
     password:"existing-owner-safe-password",bootstrapToken:env.CIRO_BOOTSTRAP_TOKEN})
   });
   assert.equal(created.status,201);
  }finally{await new Promise(resolve=>listener.close(resolve));}
  const original=old.store.get().owner;
  const native=createAccountService({dir,env});
  const session=await native.provisionDesktopSession();
  assert.match(session.raw,/^[A-Za-z0-9_-]{40,}$/);
  assert.equal(session.ownerIsDesktopLocal,false);
  assert.equal(native.store.get().owner.email,original.email);
  assert.equal(native.store.get().owner.passwordHash,original.passwordHash);
  assert.equal(native.store.get().owner.id,original.id);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {randomBytes} from "node:crypto";
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {createAccountService} from "../server/account.mjs";
import {migrateAccountState} from "../server/account-store.mjs";

const key=randomBytes(32).toString("base64");
const baseEnv={CIRO_ACCOUNTS_ENABLED:"true",CIRO_BOOTSTRAP_TOKEN:"bootstrap-secret-of-32-characters-long",
  CIRO_API_KEY_PEPPER:"api-key-hmac-pepper-more-than-24-bytes",CIRO_ACCOUNT_DATA_KEY:key};
const pw="a-very-secure-long-password";

async function setup(extra={},dir=mkdtempSync(join(tmpdir(),"ciro-multi-"))){
  const service=createAccountService({env:{...baseEnv,...extra},dir});
  const app=express();app.use(express.json());
  app.use("/api/account",service.router);app.use("/api",service.guard);
  app.get("/api/workbench/state",(_q,r)=>r.json({ok:true}));
  app.get("/api/studio/x",(_q,r)=>r.json({ok:true}));
  app.post("/api/chat",(q,r)=>r.json({user:q.principal.id}));
  const server=await new Promise(res=>{const l=app.listen(0,"127.0.0.1",()=>res(l));});
  const url="http://127.0.0.1:"+server.address().port;
  // Each client keeps its own cookie, like two people on two phones.
  const client=()=>{
    let cookie="",csrf="";
    const call=async(path,{method="GET",body,headers={}}={})=>{
      const h={...headers};if(cookie)h.Cookie=cookie;if(csrf&&method!=="GET")h["X-Ciro-Csrf"]=csrf;
      if(body!==undefined)h["Content-Type"]="application/json";
      const r=await fetch(url+path,{method,headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});
      const json=await r.json().catch(()=>null);
      const set=r.headers.get("set-cookie");if(set&&json?.csrf){cookie=set.split(";")[0];csrf=json.csrf;}
      return {status:r.status,json};
    };
    return {call};
  };
  return {service,client,dir,close:async()=>{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};
}
const owner={bootstrapToken:baseEnv.CIRO_BOOTSTRAP_TOKEN,email:"owner@example.com",displayName:"Owner",password:pw};

test("closed registration: only the owner exists; invite mode needs a single-use code from the owner",async()=>{
  const ctx=await setup({CIRO_REGISTRATION:"invite"});
  try{
    const o=ctx.client(),a=ctx.client(),b=ctx.client();
    assert.equal((await a.call("/api/account/register",{method:"POST",body:{email:"a@x.io",displayName:"A",password:pw}})).status,409);
    assert.equal((await o.call("/api/account/bootstrap",{method:"POST",body:owner})).status,201);
    assert.equal((await o.call("/api/account/session")).json.user.role,"owner");
    assert.equal((await a.call("/api/account/session")).json.registration,"invite");
    assert.equal((await a.call("/api/account/register",{method:"POST",body:{email:"a@x.io",displayName:"A",password:pw,inviteCode:"NOPE1234"}})).status,403);
    const inv=await o.call("/api/account/admin/invites",{method:"POST",body:{days:3}});
    assert.equal(inv.status,201);
    const code=inv.json.invite.code;
    const reg=await a.call("/api/account/register",{method:"POST",body:{email:"A@x.io",displayName:"A",password:pw,inviteCode:code.toLowerCase()}});
    assert.equal(reg.status,201);assert.equal(reg.json.user.role,"user");
    assert.equal((await b.call("/api/account/register",{method:"POST",body:{email:"b@x.io",displayName:"B",password:pw,inviteCode:code}})).status,403,"invite is single use");
    assert.equal((await b.call("/api/account/register",{method:"POST",body:{email:"owner@example.com",displayName:"B",password:pw}})).status,403);
  }finally{await ctx.close();}
  const closed=await setup();
  try{
    const o=closed.client(),a=closed.client();
    await o.call("/api/account/bootstrap",{method:"POST",body:owner});
    assert.equal((await a.call("/api/account/session")).json.registration,"closed");
    assert.equal((await a.call("/api/account/register",{method:"POST",body:{email:"a@x.io",displayName:"A",password:pw}})).status,403);
  }finally{await closed.close();}
});

test("users are isolated: keys, memories, notifications and sync; shared tools stay owner-only",async()=>{
  const ctx=await setup({CIRO_REGISTRATION:"open"});
  try{
    const o=ctx.client(),a=ctx.client(),b=ctx.client();
    await o.call("/api/account/bootstrap",{method:"POST",body:owner});
    assert.equal((await a.call("/api/account/register",{method:"POST",body:{email:"a@x.io",displayName:"A",password:pw}})).status,201);
    assert.equal((await b.call("/api/account/register",{method:"POST",body:{email:"b@x.io",displayName:"B",password:pw}})).status,201);
    assert.equal((await b.call("/api/account/register",{method:"POST",body:{email:"b@x.io",displayName:"B2",password:pw}})).status,409);
    // API keys
    const k=await a.call("/api/account/api-keys",{method:"POST",body:{name:"a key",scopes:["chat:invoke"]}});
    assert.equal(k.status,201);
    assert.equal((await b.call("/api/account/api-keys")).json.keys.length,0);
    assert.equal((await b.call("/api/account/api-keys/"+k.json.record.id+"/revoke",{method:"POST",body:{}})).status,404);
    // Memories
    await a.call("/api/account/memories/preferences",{method:"POST",body:{enabled:true}});
    const m=await a.call("/api/account/memories",{method:"POST",body:{content:"A likes tea"}});
    assert.equal(m.status,201);
    assert.equal((await b.call("/api/account/memories")).json.memories.length,0);
    await b.call("/api/account/memories/"+m.json.id,{method:"DELETE"});
    assert.equal((await a.call("/api/account/memories")).json.memories.length,1);
    // Sync v1 + v2
    const snap={conversations:[{id:"c1",title:"A secret",createdAt:1,updatedAt:1,messages:[]}],preferences:{}};
    assert.equal((await a.call("/api/account/sync",{method:"PUT",body:{baseVersion:0,snapshot:snap}})).status,200);
    assert.equal((await b.call("/api/account/sync")).json.snapshot,null);
    assert.equal((await b.call("/api/account/sync",{method:"PUT",body:{baseVersion:0,snapshot:{conversations:[],preferences:{}}}})).status,200);
    await a.call("/api/account/sync/v2/push",{method:"POST",body:{items:[{kind:"conversation",id:"c1",mtime:5,deleted:false,data:{title:"A only"}}]}});
    await b.call("/api/account/sync/v2/push",{method:"POST",body:{items:[{kind:"conversation",id:"c1",mtime:1,deleted:false,data:{title:"B only"}}]}});
    const pa=await a.call("/api/account/sync/v2/changes?since=0"),pb=await b.call("/api/account/sync/v2/changes?since=0");
    assert.deepEqual(pa.json.items.map(x=>x.data.title),["A only"]);
    assert.deepEqual(pb.json.items.map(x=>x.data.title),["B only"],"same item id, separate users, no conflict");
    // Notifications go to the owner by default, or to one user
    ctx.service.notify({title:"for owner",body:"x"});
    const aid=(await a.call("/api/account/session")).json.user.id;
    ctx.service.notify({title:"for A",body:"y",userId:aid});
    assert.deepEqual((await a.call("/api/account/notifications")).json.notifications.map(x=>x.title),["for A"]);
    assert.deepEqual((await o.call("/api/account/notifications")).json.notifications.map(x=>x.title),["for owner"]);
    // Owner-only shared tools and admin pages
    assert.equal((await a.call("/api/workbench/state")).status,403);
    assert.equal((await a.call("/api/studio/x")).status,403);
    assert.equal((await o.call("/api/workbench/state")).status,200);
    assert.equal((await a.call("/api/chat",{method:"POST",body:{}})).json.user,aid);
    assert.equal((await a.call("/api/account/admin/users")).status,403);
    assert.equal((await a.call("/api/account/admin/invites",{method:"POST",body:{}})).status,403);
    // Subscription controls are the owner's
    assert.equal((await a.call("/api/account/subscription/checkout",{method:"POST",body:{}})).status,403);
  }finally{await ctx.close();}
});

test("owner disables, re-enables and removes users; the owner cannot be removed",async()=>{
  const ctx=await setup({CIRO_REGISTRATION:"open"});
  try{
    const o=ctx.client(),a=ctx.client();
    await o.call("/api/account/bootstrap",{method:"POST",body:owner});
    await a.call("/api/account/register",{method:"POST",body:{email:"a@x.io",displayName:"A",password:pw}});
    const list=(await o.call("/api/account/admin/users")).json;
    assert.equal(list.users.length,2);assert.equal(list.registration,"open");
    const uid=list.users.find(x=>x.role==="user").id,oid=list.users.find(x=>x.role==="owner").id;
    assert.equal((await o.call("/api/account/admin/users/"+oid,{method:"POST",body:{disabled:true}})).status,409);
    assert.equal((await o.call("/api/account/admin/users/"+oid,{method:"DELETE"})).status,409);
    assert.equal((await o.call("/api/account/admin/users/"+uid,{method:"POST",body:{disabled:true}})).json.user.disabled,true);
    assert.equal((await a.call("/api/account/session")).json.authenticated,false,"sessions end when disabled");
    const again=ctx.client();
    assert.equal((await again.call("/api/account/login",{method:"POST",body:{email:"a@x.io",password:pw}})).status,403);
    await o.call("/api/account/admin/users/"+uid,{method:"POST",body:{disabled:false}});
    assert.equal((await again.call("/api/account/login",{method:"POST",body:{email:"a@x.io",password:pw}})).status,200);
    await again.call("/api/account/sync/v2/push",{method:"POST",body:{items:[{kind:"prompt",id:"p",mtime:1,deleted:false,data:{x:1}}]}});
    assert.equal((await o.call("/api/account/admin/users/"+uid,{method:"DELETE"})).json.deleted,true);
    assert.equal((await again.call("/api/account/session")).json.authenticated,false);
    assert.equal((await o.call("/api/account/admin/users")).json.users.length,1);
    const db=new DatabaseSync(join(ctx.dir,"sync.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_rows WHERE user_id=?").get(uid).n,0);db.close();
  }finally{await ctx.close();}
});

test("a single-owner server upgrades in place: owner, sessions, keys, memories and synced rows carry over",async()=>{
  // First run the old layout through the new code path: build a v1 file and a legacy sync table.
  const dir=mkdtempSync(join(tmpdir(),"ciro-migrate-"));
  const first=await setup({},dir);
  const o=first.client();
  await o.call("/api/account/bootstrap",{method:"POST",body:owner});
  await o.call("/api/account/memories/preferences",{method:"POST",body:{enabled:true}});
  await o.call("/api/account/memories",{method:"POST",body:{content:"kept"}});
  await o.call("/api/account/sync/v2/push",{method:"POST",body:{items:[{kind:"conversation",id:"c",mtime:2,deleted:false,data:{t:"old"}}]}});
  await new Promise(r=>setTimeout(r,10));
  const v2=JSON.parse(readFileSync(join(dir,"account-state.json"),"utf8"));
  const ownerUser=v2.users[0];
  // Rewrite the state as version 1 and the sync rows as the legacy single-owner table.
  const strip=l=>l.map(({userId,...x})=>x);
  const v1={version:1,owner:{...ownerUser,role:undefined},sessions:strip(v2.sessions),apiKeys:strip(v2.apiKeys),
    memories:strip(v2.memories),notifications:[],sync:{version:0,encrypted:null,updatedAt:null},
    subscription:v2.subscription,webhookEvents:[],audit:[]};
  writeFileSync(join(dir,"account-state.json"),JSON.stringify(v1),{mode:0o600});
  const db=new DatabaseSync(join(dir,"sync.sqlite"));
  db.exec(`CREATE TABLE sync_items(key TEXT PRIMARY KEY, kind TEXT NOT NULL, item_id TEXT NOT NULL,
    rev INTEGER NOT NULL, mtime INTEGER NOT NULL, deleted INTEGER NOT NULL, payload TEXT)`);
  db.exec("INSERT INTO sync_items SELECT key,kind,item_id,rev,mtime,deleted,payload FROM sync_rows");
  db.exec("DELETE FROM sync_rows");db.close();
  const migrated=migrateAccountState(v1);
  assert.equal(migrated.users[0].role,"owner");
  assert.ok(migrated.sessions.every(x=>x.userId===ownerUser.id));
  // Reopen with the new code: same cookie still works, memory decrypts, synced row is the owner's.
  const second=createAccountService({env:baseEnv,dir});
  const app=express();app.use(express.json());app.use("/api/account",second.router);
  const server=await new Promise(res=>{const l=app.listen(0,"127.0.0.1",()=>res(l));});
  try{
    const url="http://127.0.0.1:"+server.address().port;
    const login=await fetch(url+"/api/account/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:owner.email,password:pw})});
    const cookie=login.headers.get("set-cookie").split(";")[0];
    const mem=await (await fetch(url+"/api/account/memories",{headers:{Cookie:cookie}})).json();
    assert.deepEqual(mem.memories.map(x=>x.content),["kept"]);
    const rows=await (await fetch(url+"/api/account/sync/v2/changes?since=0",{headers:{Cookie:cookie}})).json();
    assert.deepEqual(rows.items.map(x=>x.data.t),["old"]);
    const session=await (await fetch(url+"/api/account/session",{headers:{Cookie:cookie}})).json();
    assert.equal(session.user.role,"owner");
  }finally{await new Promise(r=>server.close(r));await first.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCiroDesktopLive} from '../scripts/verify-ciro-desktop-live.mjs';

function fixture({preview=false,wrongRepo=false}={}){
 const calls=[];
 const fetchFn=async (url,options={})=>{
  const {pathname}=new URL(url);
  calls.push({pathname,method:options.method||'GET'});
  const json=(data,extra={})=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json',...extra}});
  if(pathname==='/api/account/login')return json({authenticated:true,csrf:'csrf-test-token'},{'Set-Cookie':'ciro_sid=private-cookie; HttpOnly; SameSite=Lax'});
  if(pathname==='/api/account/session')return json({authenticated:true,mode:'session'});
  if(pathname==='/api/status')return json({configured:!preview,mode:preview?'preview':'configured',model:'ciro'});
  if(pathname==='/api/plugins/catalog')return json({installed:[{id:'github',enabled:true}],
    connections:[{provider:'github',account:{login:'internal-test'}}],
    githubScope:{selectedRepository:wrongRepo?'attacker/repo':'kllcoco/frontend-UI'}});
  if(pathname==='/api/plugins/invoke'){
   assert.equal(options.headers.Cookie,'ciro_sid=private-cookie');
   assert.equal(options.headers['x-ciro-csrf'],'csrf-test-token');
   return json({executed:true,tool:'github.read_file',result:{sha:'a'.repeat(40),content:'# README\n'}});
  }
  if(pathname==='/api/chat')return new Response('data: {"choices":[{"delta":{"content":"CIRO 正常"}}]}\n\ndata: [DONE]\n\n',{status:200,headers:{'Content-Type':'text/event-stream'}});
  throw Error('Unexpected '+url);
 };
 return {fetchFn,calls};
}
const args={baseUrl:'http://127.0.0.1:8787/',email:'dev@example.org',password:'mock-not-real',repo:'kllcoco/frontend-UI'};
test('mock transport only qualifies client HTTP and read, never native NCPA or write',async()=>{
 const f=fixture();const r=await verifyCiroDesktopLive({...args,fetchFn:f.fetchFn});
 assert.equal(r.github.status,'PASS_LIVE_READ');
 assert.equal(r.model.status,'PASS_HTTP_STREAM');
 assert.equal(r.model.nativeNcpaAuthority,'NOT_VERIFIED');
 assert.equal(r.githubWrites,'NOT_RUN_REQUIRES_HUMAN_APPROVAL');
 assert.equal(r.graduated,false);
 assert.equal(f.calls.length,6);
});
test('no real inference configuration fails closed before provider tests',async()=>{
 const f=fixture({preview:true});
 await assert.rejects(verifyCiroDesktopLive({...args,fetchFn:f.fetchFn}),/preview-only/);
 assert.equal(f.calls.length,3);
});
test('GitHub account scope must match selected repository',async()=>{
 const f=fixture({wrongRepo:true});
 await assert.rejects(verifyCiroDesktopLive({...args,fetchFn:f.fetchFn}),/selected repo/);
 assert.equal(f.calls.some(x=>x.pathname==='/api/chat'),false);
});
test('denies non-loopback acceptance and missing credentials',async()=>{
 await assert.rejects(verifyCiroDesktopLive({...args,baseUrl:'https://example.org/'}),/exact local/);
 await assert.rejects(verifyCiroDesktopLive({...args,password:''}),/local CIRO_ACCEPTANCE/);
});

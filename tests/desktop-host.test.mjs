import test from "node:test";
import assert from "node:assert/strict";
import {desktopTokenAccepted,createDesktopGuard} from "../server/desktop-guard.mjs";
import {isDesktopOriginUrl,isTrustedExternalUrl,visibleWindowBounds,sanitizeWindowState} from "../desktop/security.mjs";
import {buildIcon} from "../desktop/generate-icon.mjs";

test("ephemeral desktop gateway secret must match in full and never enable cross-host binds",()=>{
 const env={HOST:"127.0.0.1",CIRO_DESKTOP_TOKEN:"a".repeat(43)};
 assert.equal(desktopTokenAccepted(env.CIRO_DESKTOP_TOKEN,env.CIRO_DESKTOP_TOKEN),true);
 assert.equal(desktopTokenAccepted(env.CIRO_DESKTOP_TOKEN,"a".repeat(42)),false);
 assert.equal(desktopTokenAccepted(env.CIRO_DESKTOP_TOKEN,"b".repeat(43)),false);
 assert.throws(()=>createDesktopGuard({...env,HOST:"0.0.0.0"}),/loopback/);
 assert.throws(()=>createDesktopGuard({...env,CIRO_DESKTOP_TOKEN:"short"}),/strong/);
 const guard=createDesktopGuard(env),statuses=[];
 const makeRes=()=>({status(code){statuses.push(code);return this;},
   set(){return this;},json(){return this;}});
 let passed=false;
 guard({get:()=>undefined},makeRes(),()=>{passed=true;});
 assert.deepEqual(statuses,[403]);
 assert.equal(passed,false);
 guard({get:()=>env.CIRO_DESKTOP_TOKEN},makeRes(),()=>{passed=true;});
 assert.equal(passed,true);
});

test("desktop origin and external navigation reject lookalikes, credentials, unsafe schemes",()=>{
 const origin="http://127.0.0.1:21887";
 assert.equal(isDesktopOriginUrl(origin+"/api/status",origin),true);
 assert.equal(isDesktopOriginUrl("http://127.0.0.1:21888/",origin),false);
 assert.equal(isDesktopOriginUrl("http://localhost:21887/",origin),false);
 assert.equal(isDesktopOriginUrl("javascript:alert(1)",origin),false);
 assert.equal(isTrustedExternalUrl("https://github.com/login/oauth/authorize"),true);
 assert.equal(isTrustedExternalUrl("https://docs.github.com/en/"),true);
 assert.equal(isTrustedExternalUrl("https://github.com.bad.tld/"),false);
 assert.equal(isTrustedExternalUrl("file:///C:/Windows/System32/cmd.exe"),false);
 assert.equal(isTrustedExternalUrl("mailto:attacker@example.com"),false);
 assert.equal(isTrustedExternalUrl("https://joe:pw@github.com/"),false);
 assert.equal(isTrustedExternalUrl("http://github.com/"),false);
});

test("window restore protects offscreen states after display disconnection",()=>{
 const displays=[{workArea:{x:0,y:0,width:1920,height:1040}}];
 assert.deepEqual(visibleWindowBounds({x:200,y:120,width:1200,height:850},displays),
  {x:200,y:120,width:1200,height:850});
 assert.equal(visibleWindowBounds({x:9000,y:9000,width:1200,height:850},displays),null);
 assert.equal(sanitizeWindowState({bounds:{x:1,y:2,width:800,height:700},maximized:true}).maximized,true);
 assert.equal(sanitizeWindowState({bounds:{x:"1",y:2,width:800,height:700}}),null);
});

test("brand icon is a real multi-resolution Win32 ICO, not the Electron default",()=>{
 const icon=buildIcon();
 assert.equal(icon.readUInt16LE(0),0);
 assert.equal(icon.readUInt16LE(2),1);
 const count=icon.readUInt16LE(4);
 assert.equal(count,6);
 const sizes=[];
 for(let i=0;i<count;i++){
  const off=6+i*16;
  const size=icon[off]||256;sizes.push(size);
  const length=icon.readUInt32LE(off+8),pos=icon.readUInt32LE(off+12);
  assert.equal(icon.readUInt16LE(off+6),32);
  assert.equal(icon.readUInt32LE(pos),40);
  assert.equal(icon.readInt32LE(pos+4),size);
  assert.equal(icon.readInt32LE(pos+8),size*2);
  assert.ok(pos+length<=icon.length);
 }
 assert.deepEqual(sizes,[16,32,48,64,128,256]);
});

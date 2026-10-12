import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {readFileSync,mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {createRequire} from "node:module";
import vm from "node:vm";

const main=join(import.meta.dirname,"..","desktop","main.cjs");
const requireMain=createRequire(main);
const source=readFileSync(main,"utf8");
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));

async function fixture({healthy=true,singleInstance=true,hasNativeSession=true}={}){
 const root=mkdtempSync(join(tmpdir(),"ciro-main-mock-"));
 const app=new EventEmitter(),backend=new EventEmitter();
 let window=null,options=null,forkOptions=null,forkEntry=null;
 let quitCalls=0,killCalls=0,dialogErrors=[],nativeCookies=[];
 const handlers=new Map();
 app.setAppUserModelId=()=>{};
 app.requestSingleInstanceLock=()=>singleInstance;
 app.getPath=kind=>{assert.equal(kind,"userData");return root;};
 app.getAppPath=()=>"/app";
 app.getVersion=()=>"0.8.0-dev";
 app.whenReady=()=>Promise.resolve();
 app.quit=()=>{quitCalls++;app.emit("before-quit");};
 backend.stdout={resume:()=>{}};
 backend.stderr={resume:()=>{}};
 backend.kill=()=>{killCalls++;};
 const fork=(entry,_argv,opts)=>{
  forkEntry=entry;forkOptions=opts;
  queueMicrotask(()=>backend.emit("message",{type:"ciro-server-ready",port:19773,
   desktopSessionToken:hasNativeSession?"a".repeat(43):null}));
  return backend;
 };
 class FakeWindow extends EventEmitter{
  constructor(opts){super();options=opts;window=this;
   this.webContents=new EventEmitter();
   this.webContents.setWindowOpenHandler=fn=>{this.webContents.openHandler=fn;};
   this.webContents.session={setPermissionRequestHandler:fn=>{this.webContents.permissionHandler=fn;},
    cookies:{set:async options=>{nativeCookies.push(options);}}};
  }
  show(){this.shown=true;}
  focus(){this.focused=true;}
  async loadURL(url){this.loadedUrl=url;this.emit("ready-to-show");}
 }
 const dialog={showErrorBox:(title,detail)=>dialogErrors.push({title,detail}),
  showMessageBox:async()=>({response:1})};
 const electron={app,BrowserWindow:FakeWindow,dialog,
  ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},
  Notification:class{static isSupported(){return false;}},
  shell:{openPath:async()=>""}};
 const mockedRequire=path=>{
  if(path==="electron")return electron;
  if(path==="node:child_process")return {fork};
  if(path==="node:fs")return {existsSync:()=>true};
  return requireMain(path);
 };
 const env={HOST:"0.0.0.0",PORT:"8911",CIRO_ACCOUNTS_ENABLED:"false",CIRO_PUBLIC_MULTI_TENANT:"true"};
 const calls=[];
 const context={require:mockedRequire,__dirname:dirname(main),__filename:main,
  process:{env,platform:"win32",execPath:"C:/fake/electron.exe"},
  fetch:async(url)=>{calls.push(url);return {ok:healthy};},
  setTimeout,clearTimeout,AbortSignal,URL,console};
 vm.runInNewContext(source,context,{filename:main});
 for(let i=0;i<100&&!window?.loadedUrl&&!dialogErrors.length&&!quitCalls;i++)await tick();
 return {root,app,backend,handlers,get window(){return window;},
  get options(){return options;},get forkOptions(){return forkOptions;},
  get forkEntry(){return forkEntry;},get quitCalls(){return quitCalls;},
  get killCalls(){return killCalls;},dialogErrors,calls,nativeCookies,
  close(){rmSync(root,{recursive:true,force:true});}};
}

test("actual Electron main enforces local renderer window, IPC and quit boundary",async()=>{
 const run=await fixture();
 try{
  assert.deepEqual(run.dialogErrors,[]);
  assert.equal(run.forkEntry,join("/app","server","index.mjs"));
  assert.equal(run.forkOptions.execPath,"C:/fake/electron.exe");
  assert.equal(run.forkOptions.env.HOST,"127.0.0.1");
  assert.equal(run.forkOptions.env.PORT,"0");
  assert.equal(run.forkOptions.env.CIRO_ACCOUNTS_ENABLED,"true");
  assert.deepEqual(run.calls,["http://127.0.0.1:19773/api/status"]);
  assert.equal(run.window.loadedUrl,"http://127.0.0.1:19773");
  assert.equal(run.nativeCookies.length,1);
  const cookie=run.nativeCookies[0];
  assert.equal(cookie.url,"http://127.0.0.1:19773/");
  assert.equal(cookie.name,"ciro_sid");
  assert.equal(cookie.httpOnly,true);
  assert.equal(cookie.sameSite,"strict");
  assert.equal(cookie.value,"a".repeat(43));
  assert.equal(run.window.loadedUrl.includes(cookie.value),false);
  assert.equal(run.window.shown,true);
  assert.equal(run.options.webPreferences.sandbox,true);
  assert.equal(run.options.webPreferences.contextIsolation,true);
  assert.equal(run.options.webPreferences.nodeIntegration,false);
  assert.equal(run.options.webPreferences.webviewTag,false);
  assert.equal(run.window.webContents.openHandler().action,"deny");
  let blocked=false;
  run.window.webContents.emit("will-navigate",{preventDefault:()=>{blocked=true;}},"https://evil.example");
  assert.equal(blocked,true);
  blocked=false;
  run.window.webContents.emit("will-navigate",{preventDefault:()=>{blocked=true;}},"http://127.0.0.1:19773/inside");
  assert.equal(blocked,false);
  const h=run.handlers.get("ciro-native:handshake");
  const origin="http://127.0.0.1:19773",nonce="00000000-1111-2222-3333-444444444444";
  const evt={sender:run.window.webContents,senderFrame:{url:origin+"/"}};
  assert.equal(h(evt,{contract:"ciro-native-shell.v1",origin,nonce}).platform,"windows");
  assert.throws(()=>h({...evt,senderFrame:{url:"https://attacker.example"}},
   {contract:"ciro-native-shell.v1",origin,nonce}),/Native origin denied/);
  let allow=null;
  run.window.webContents.permissionHandler(null,"clipboard-read",value=>{allow=value;});
  assert.equal(allow,false);
  run.app.emit("before-quit");
  assert.equal(run.killCalls,1);
 }finally{run.close();}
});

test("actual Electron main fails closed when local backend healthcheck fails",async()=>{
 const run=await fixture({healthy:false});
 try{
  assert.equal(run.window,null);
  assert.equal(run.dialogErrors.length,1);
  assert.match(run.dialogErrors[0].detail,/Local API healthcheck failed/);
  assert.equal(run.quitCalls,1);
  assert.equal(run.killCalls,1);
 }finally{run.close();}
});

test("second launch exits before booting another backend",async()=>{
 const run=await fixture({singleInstance:false});
 try{
  assert.equal(run.quitCalls,1);
  assert.equal(run.window,null);
  assert.equal(run.forkEntry,null);
 }finally{run.close();}
});

test("native UI refuses to load if the private desktop login handshake is missing",async()=>{
 const run=await fixture({hasNativeSession:false});
 try{
  assert.equal(run.window,null);
  assert.equal(run.dialogErrors.length,1);
  assert.match(run.dialogErrors[0].detail,/Desktop login session missing/);
  assert.equal(run.quitCalls,1);
 }finally{run.close();}
});

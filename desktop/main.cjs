"use strict";
const {app,BrowserWindow,dialog,ipcMain,Notification}=require("electron");
const {fork}=require("node:child_process");
const {join}=require("node:path");
const {existsSync}=require("node:fs");
const {loadOrCreateSecrets,childEnvironment,trustedLocalUrl}=require("./runtime.cjs");

app.setAppUserModelId("ai.ciro.desktop");
if(!app.requestSingleInstanceLock())app.quit();
else{
 let win=null,backend=null,origin="",stopping=false;
 app.on("second-instance",()=>{if(win){win.show();win.focus();}});
 app.on("before-quit",()=>{stopping=true;backend?.kill();});
 app.on("window-all-closed",()=>app.quit());
 function allowed(event){
  return win&&event.sender===win.webContents&&
   event.senderFrame?.url&&new URL(event.senderFrame.url).origin===origin;
 }
 ipcMain.handle("ciro-native:handshake",(event,payload)=>{
  if(!allowed(event)||payload?.contract!=="ciro-native-shell.v1"||
     payload.origin!==origin||typeof payload.nonce!=="string"||
     !/^[0-9a-f-]{36}$/i.test(payload.nonce))throw Error("Native origin denied");
  return {contract:"ciro-native-shell.v1",origin,nonce:payload.nonce,
   platform:process.platform==="win32"?"windows":"linux",
   version:app.getVersion(),grants:["notifications"]};
 });
 ipcMain.handle("ciro-native:notify",(event,payload)=>{
  if(!allowed(event)||typeof payload?.title!=="string"||
    typeof payload.body!=="string"||payload.title.length>120||
    payload.body.length>450||!payload.title.trim())throw Error("Invalid notification");
  if(!Notification.isSupported())return {accepted:false};
  new Notification({title:payload.title,body:payload.body}).show();
  return {accepted:true};
 });
 async function boot(){
  const root=app.getPath("userData");
  const setup=loadOrCreateSecrets(root);
  const entry=join(app.getAppPath(),"server","index.mjs");
  if(!existsSync(entry)||!existsSync(join(app.getAppPath(),"dist","index.html")))
   throw Error("Bundled CIRO server or frontend missing");
  const port=await new Promise((resolve,reject)=>{
   let done=false;
   const timer=setTimeout(()=>fail(Error("Local server start timeout")),20000);
   function fail(error){if(done)return;done=true;clearTimeout(timer);reject(error);}
   backend=fork(entry,[],{cwd:root,execPath:process.execPath,execArgv:[],
    env:childEnvironment(process.env,root,setup.record),
    windowsHide:true,stdio:["ignore","pipe","pipe","ipc"]});
   backend.stdout?.resume();backend.stderr?.resume();
   backend.once("error",fail);
   backend.once("exit",code=>{
    if(!done)fail(Error("Local server exit "+code));
    else if(!stopping){dialog.showErrorBox("CIRO 服务中断","本机服务异常退出。");app.quit();}
   });
   backend.on("message",message=>{
    if(done||message?.type!=="ciro-server-ready"||
      !Number.isInteger(message.port)||message.port<1||message.port>65535)return;
    done=true;clearTimeout(timer);resolve(message.port);
   });
  });
  origin="http://127.0.0.1:"+port;
  const health=await fetch(origin+"/api/status",{signal:AbortSignal.timeout(6000)});
  if(!health.ok)throw Error("Local API healthcheck failed");
  win=new BrowserWindow({title:"Ciro",width:1340,height:890,minWidth:940,minHeight:650,
   show:false,backgroundColor:"#101015",
   webPreferences:{preload:join(__dirname,"preload.cjs"),nodeIntegration:false,
    contextIsolation:true,sandbox:true,webSecurity:true,webviewTag:false}});
  win.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  win.webContents.on("will-navigate",(event,target)=>{
   if(!trustedLocalUrl(target,port))event.preventDefault();
  });
  win.webContents.session.setPermissionRequestHandler((_contents,permission,callback)=>{
   callback(permission==="notifications");
  });
  win.once("ready-to-show",()=>win.show());
  await win.loadURL(origin);
  if(setup.firstRun){
   await dialog.showMessageBox(win,{
    type:"info",title:"CIRO 首次初始化",message:"请先创建本机管理员账户。",
    detail:"一次性初始化口令保存在本机 Ciro 用户数据目录的 desktop-secrets.json 中。仅在 CIRO 账户中心填写，不要复制到聊天或代码仓库。",
    buttons:["知道了"],noLink:true
   });
  }
 }
 app.whenReady().then(boot).catch(e=>{
  dialog.showErrorBox("CIRO 桌面版无法启动",String(e.message||e).slice(0,500));
  app.quit();
 });
}

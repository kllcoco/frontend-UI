import {app,BrowserWindow,Menu,dialog,screen,session,shell,utilityProcess} from "electron";
import {randomBytes,createHash} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from "node:fs";
import {join,isAbsolute} from "node:path";
import {pathToFileURL} from "node:url";
import {once} from "node:events";
import {config as loadDotEnv} from "dotenv";
import {isDesktopOriginUrl,isTrustedExternalUrl,visibleWindowBounds,sanitizeWindowState} from "./security.mjs";

app.setName("Ciro");
app.setPath("userData",join(app.getPath("appData"),"Ciro"));
const smoke=process.env.CIRO_DESKTOP_SMOKE==="1"||process.argv.includes("--ciro-desktop-smoke");
if(smoke)app.disableHardwareAcceleration();
app.setAppUserModelId("ai.ciro.desktop");
const hasLock=app.requestSingleInstanceLock();
let window=null,backend=null,readWorker=null,origin="",closing=false;
let authToken="";
let stateFile="";


function nativeMenu(){
 return Menu.buildFromTemplate([
  {label:"文件",submenu:[
   {label:"关闭窗口",accelerator:"CmdOrCtrl+W",click:()=>window?.close()},
   {type:"separator"},{role:"quit",label:"退出 Ciro"}]},
  {label:"编辑",submenu:[{role:"undo",label:"撤销"},{role:"redo",label:"重做"},
   {type:"separator"},{role:"cut",label:"剪切"},{role:"copy",label:"复制"},
   {role:"paste",label:"粘贴"},{role:"selectAll",label:"全选"}]},
  {label:"查看",submenu:[{role:"reload",label:"重新加载"},
   {role:"resetZoom",label:"实际大小"},{role:"zoomIn",label:"放大"},
   {role:"zoomOut",label:"缩小"},{role:"togglefullscreen",label:"全屏"}]},
  {label:"窗口",submenu:[{role:"minimize",label:"最小化"},{role:"close",label:"关闭"}]},
  {label:"帮助",submenu:[{label:"项目代码",click:()=>void shell.openExternal("https://github.com/kllcoco/frontend-UI")}]}
 ]);
}

function saveWindow(win){
 if(!stateFile||win.isDestroyed())return;
 const state={
  bounds:win.isMaximized()?win.getNormalBounds():win.getBounds(),
  maximized:win.isMaximized()
 };
 const sanitized=sanitizeWindowState(state);
 if(!sanitized)return;
 const next=stateFile+".tmp";
 try{writeFileSync(next,JSON.stringify(sanitized),{encoding:"utf8",mode:0o600});
  renameSync(next,stateFile);
 }catch(error){console.error("Ciro could not save window position:",error.message);}
}

function openWindow({hidden=false}={}){
 const userData=app.getPath("userData");
 let remembered=null;
 try{if(existsSync(stateFile))remembered=JSON.parse(readFileSync(stateFile,"utf8"));}catch{}
 const valid=visibleWindowBounds(remembered?.bounds,screen.getAllDisplays());
 const win=new BrowserWindow({
  width:valid?.width||1280,height:valid?.height||840,
  ...(valid?{x:valid.x,y:valid.y}:{}),
  minWidth:900,minHeight:620,show:false,
  title:"Ciro",backgroundColor:"#ffffff",autoHideMenuBar:false,
  icon:join(app.getAppPath(),"desktop","assets","ciro.ico"),
  webPreferences:{
   contextIsolation:true,nodeIntegration:false,sandbox:true,
   webSecurity:true,allowRunningInsecureContent:false,
   devTools:!app.isPackaged,partition:"persist:ciro-desktop-v1",
   webviewTag:false
  }
 });
 window=win;
 win.webContents.setUserAgent(win.webContents.getUserAgent()+" CiroDesktop/"+app.getVersion());
 win.webContents.on("will-attach-webview",e=>e.preventDefault());
 win.webContents.setWindowOpenHandler(({url})=>{
  if(isTrustedExternalUrl(url))void shell.openExternal(url);
  return {action:"deny"};
 });
 win.webContents.on("will-navigate",(event,url)=>{
  if(isDesktopOriginUrl(url,origin))return;
  event.preventDefault();
  if(isTrustedExternalUrl(url))void shell.openExternal(url);
 });
 win.on("close",()=>saveWindow(win));
 win.on("closed",()=>{if(window===win)window=null;});
 if(remembered?.maximized&&valid)win.maximize();
 if(!hidden)win.once("ready-to-show",()=>{if(!win.isDestroyed())win.show();});
 return win;
}

async function startBackend(){
 const home=app.getPath("userData");
 mkdirSync(home,{recursive:true,mode:0o700});
 const configFile=join(home,"ciro.config.env");
 loadDotEnv({path:configFile,override:false,quiet:true});
 // Unsafe config values cannot override these privileged local-only settings.
 process.env.HOST="127.0.0.1";
 // A stable per-user port preserves Chromium localStorage and cookies across restarts.
 // Never silently move the origin and lose visible chat/settings history.
 const hash=createHash("sha256").update(home.toLowerCase()).digest();
 process.env.PORT=String(20000+(hash.readUInt16BE(0)%25000));
 process.env.CIRO_WORKSPACE_DATA_DIR=join(home,"state");
 process.env.CIRO_DESKTOP_TOKEN=randomBytes(32).toString("base64url");
 process.env.CIRO_DEPLOYMENT_MODE="development";
 process.env.CIRO_PUBLIC_MULTI_TENANT="false";
 process.env.DOTENV_CONFIG_PATH=configFile;
 authToken=process.env.CIRO_DESKTOP_TOKEN;
 mkdirSync(process.env.CIRO_WORKSPACE_DATA_DIR,{recursive:true,mode:0o700});
 if(!existsSync(join(home,"ciro.config.example.env"))){
  writeFileSync(join(home,"ciro.config.example.env"),[
   "# Optional private desktop configuration. Copy to ciro.config.env and restart Ciro.",
   "# Keep API keys here, NOT inside app code or browser localStorage.",
   "CIRO_API_BASE_URL=","CIRO_API_PATH=/chat/completions",
   "CIRO_MODEL=ciro","CIRO_MODELS=ciro","CIRO_API_KEY=",
   "# Native model/Agent/plugin connections require separate integration acceptance.",
   ""
  ].join("\n"),{flag:"wx",mode:0o600});
 }
 // Never use the packaged application directory for writable private data.
 process.chdir(home);
 const entry=pathToFileURL(join(app.getAppPath(),"server","index.mjs")).href;
 const module=await import(entry);
 backend=module.server;
 if(!backend.listening)await once(backend,"listening");
 const address=backend.address();
 if(!address||typeof address!=="object"||!Number.isInteger(address.port))throw new Error("Desktop backend has no bound port");
 origin="http://127.0.0.1:"+address.port;
 // A separate Electron Node utility owns durable read-only jobs; it never
 // exposes HTTP routes. Skip when the owner account feature isn't enabled.
 if(process.env.CIRO_ACCOUNTS_ENABLED==="true"){
  try{
   readWorker=utilityProcess.fork(join(app.getAppPath(),"server","plugin-worker.mjs"),[],{
    env:{...process.env},cwd:home,serviceName:"ciro-plugin-read-worker",stdio:"pipe"
   });
   readWorker.on("exit",code=>{readWorker=null;if(!closing)console.error("Ciro plugin worker stopped:",code);});
  }catch(error){console.error("Ciro worker unavailable:",error.message);}
 }
}

function configureSecureSession(){
 const ses=session.fromPartition("persist:ciro-desktop-v1");
 // No remote page can acquire or inject the per-process API credential.
 ses.webRequest.onBeforeSendHeaders({urls:[origin+"/*"]},(details,callback)=>{
  callback({requestHeaders:{...details.requestHeaders,"X-Ciro-Desktop-Token":authToken}});
 });
 ses.setPermissionRequestHandler((wc,permission,callback)=>{
  callback(permission==="clipboard-sanitized-write"&&
   isDesktopOriginUrl(wc.getURL(),origin));
 });
 ses.setPermissionCheckHandler((wc,permission)=>{
  return permission==="clipboard-sanitized-write"&&
   Boolean(wc)&&isDesktopOriginUrl(wc.getURL(),origin);
 });
 // A packaged desktop binary should always serve current bundled static files.
 void ses.clearStorageData({storages:["serviceworkers","cachestorage"]}).catch(()=>{});
}

async function checkBackend(){
 const authorized=await fetch(origin+"/api/status",{
  headers:{"X-Ciro-Desktop-Token":authToken},
  signal:AbortSignal.timeout(10000)
 });
 if(!authorized.ok)throw new Error("Local API health check: HTTP "+authorized.status);
 const status=await authorized.json();
 if(!Array.isArray(status.models)||!status.models.length)throw new Error("Local model selector API failed");
 const unauthorized=await fetch(origin+"/api/status",{
  signal:AbortSignal.timeout(10000)
 });
 if(unauthorized.status!==403)throw new Error("Local API must deny requests without desktop credential");
 const html=await fetch(origin+"/",{
  headers:{"X-Ciro-Desktop-Token":authToken},
  signal:AbortSignal.timeout(10000)
 });
 if(!html.ok||(html.headers.get("content-type")||"").includes("html")===false)
  throw new Error("Packaged UI not present; production dist is required");
 if(!(await html.text()).includes('id="root"'))throw new Error("Packaged root UI is invalid");
 return status;
}

async function boot(){
 try{
  stateFile=join(app.getPath("userData"),"window-state.json");
  Menu.setApplicationMenu(nativeMenu());
  await startBackend();
  configureSecureSession();
  await checkBackend();
  if(smoke){
   if(process.env.CIRO_DESKTOP_SMOKE_GUI==="1"){
    const hidden=openWindow({hidden:true});
    await hidden.loadURL(origin+"/");
    let loaded=false;
    for(let attempts=0;attempts<40&&!loaded;attempts++){
     loaded=await hidden.webContents.executeJavaScript(
      "document.querySelector('#root')?.textContent?.trim().length>40"
     );
     if(!loaded)await new Promise(resolve=>setTimeout(resolve,250));
    }
    if(!loaded)throw new Error("Packaged renderer did not mount CIRO UI");
    hidden.destroy();
   }
   const receipt=process.env.CIRO_DESKTOP_SMOKE_RECEIPT;
   if(receipt){
    if(!isAbsolute(receipt)||!receipt.toLowerCase().endsWith(".json"))
     throw new Error("Invalid desktop acceptance receipt path");
    writeFileSync(receipt,JSON.stringify({
     schema:"ciro.desktop.windows.acceptance.v1",
     status:"PASS",api:true,unauthorizedDenied:true,
     packagedHtml:true,renderer:process.env.CIRO_DESKTOP_SMOKE_GUI==="1",
     appVersion:app.getVersion(),testAt:new Date().toISOString()
    }),{encoding:"utf8",flag:"w",mode:0o600});
   }
   console.log("CIRO_DESKTOP_SMOKE_PASS packaged API, UI, auth boundary, appData");
   app.exit(0);return;
  }
  const win=openWindow();
  await win.loadURL(origin+"/");
 }catch(error){
  console.error("Ciro desktop launch failed:",error);
  if(!smoke)dialog.showErrorBox("CIRO 启动失败",String(error?.message||"Unknown error").slice(0,1000));
  app.exit(1);
 }
}

if(!hasLock){
 app.quit();
}else{
 app.on("second-instance",()=>{
  if(window&&!window.isDestroyed()){
   if(window.isMinimized())window.restore();
   window.show();window.focus();
  }
 });
 app.on("activate",()=>{if(!window&&!closing&&origin){
  const win=openWindow();void win.loadURL(origin+"/");
 }});
 app.on("window-all-closed",()=>app.quit());
 app.on("before-quit",event=>{
  if(closing||!backend)return;
  event.preventDefault();closing=true;
  if(readWorker){readWorker.kill();readWorker=null;}
  const safety=setTimeout(()=>{backend?.closeAllConnections?.();app.quit();},2500);
  backend.close(()=>{clearTimeout(safety);backend=null;app.quit();});
 });
 void app.whenReady().then(boot);
}

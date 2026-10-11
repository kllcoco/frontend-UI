import {existsSync,mkdirSync,readFileSync,renameSync,statSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";

const PRESET=[
 {id:"github",title:"GitHub",category:"开发",description:"读取仓库文件、创建分支和提交代码。",version:"0.8.0",publisher:"CIRO 官方适配器",tools:["github.read_file","github.create_branch","github.write_file"],permissions:["github.read","github.write"],ready:true},
 {id:"supabase",title:"Supabase",category:"开发",description:"连接数据库与项目工具（正在完成用户级 MCP 授权）。",version:"0.8.0",publisher:"CIRO 官方适配器",tools:["supabase.list_tools","supabase.call_tool"],permissions:["external.network","database.read","database.write"],ready:false},
 {id:"gmail",title:"Gmail",category:"效率",description:"邮件搜索、草稿及发送（尚未开放连接）。",version:"0.8.0",publisher:"CIRO 官方适配器",tools:[],permissions:["mail.read","mail.write"],ready:false},
 {id:"google-drive",title:"Google Drive",category:"效率",description:"云端文件连接（尚未开放连接）。",version:"0.8.0",publisher:"CIRO 官方适配器",tools:[],permissions:["files.read","files.write"],ready:false},
 {id:"calendar",title:"Google Calendar",category:"效率",description:"查看及管理日程（尚未开放连接）。",version:"0.8.0",publisher:"CIRO 官方适配器",tools:[],permissions:["calendar.read","calendar.write"],ready:false}
];
export const pluginCatalog=Object.freeze(PRESET.map(x=>Object.freeze({...x,tools:Object.freeze(x.tools),permissions:Object.freeze(x.permissions)})));
const digest=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function createPluginInstallStore({dir}={}){
 const folder=dir||join(process.cwd(),".ciro-runtime");
 mkdirSync(folder,{recursive:true,mode:0o700});
 const file=join(folder,"plugin-installs.json");
 let state={version:1,installed:[],intents:[],audit:[]};
 if(existsSync(file)){
  const stat=statSync(file);
  if(process.platform!=="win32"&&(stat.mode&0o077)!==0)throw new Error("Plugin install state requires 0600 permissions");
  const parsed=JSON.parse(readFileSync(file,"utf8"));
  if(parsed?.version!==1||!Array.isArray(parsed.installed)||!Array.isArray(parsed.intents)||!Array.isArray(parsed.audit))
   throw new Error("Incompatible plugin install state");
  state=parsed;
 }
 function save(event,ownerId,pluginId){
  state.audit.unshift({id:randomUUID(),event,ownerId,pluginId,at:new Date().toISOString()});
  state.audit=state.audit.slice(0,200);
  state.intents=state.intents.filter(x=>x.expiresAt>Date.now()).slice(-100);
  const temp=file+"."+process.pid+"."+randomUUID()+".tmp";
  writeFileSync(temp,JSON.stringify(state),{mode:0o600,flag:"wx"});
  renameSync(temp,file);
 }
 const getPlugin=id=>pluginCatalog.find(x=>x.id===id);
 function installed(ownerId,id){
  return state.installed.find(x=>x.ownerId===ownerId&&x.id===id)||null;
 }
 function list(ownerId){return state.installed.filter(x=>x.ownerId===ownerId).map(({ownerId:_,...rest})=>rest);}
 function prepare({ownerId,sessionId,id}){
  const plugin=getPlugin(id);
  if(!plugin)throw fail("Plugin not found",404);
  if(!plugin.ready)throw fail("Plugin is not ready for installation",409);
  if(installed(ownerId,id))throw fail("Plugin already installed",409);
  const nonce=randomUUID(),fingerprint=digest({id:plugin.id,version:plugin.version,permissions:plugin.permissions,tools:plugin.tools});
  state.intents=state.intents.filter(x=>x.ownerId!==ownerId||x.id!==id);
  state.intents.push({nonce,ownerId,sessionId,id,fingerprint,expiresAt:Date.now()+300000});
  save("install.prepared",ownerId,id);
  return {nonce,plugin:{...plugin},fingerprint,expiresInSeconds:300};
 }
 function install({ownerId,sessionId,id,nonce,fingerprint,confirm}){
  if(confirm!==true)throw fail("Explicit marketplace confirmation required",403);
  const intent=state.intents.find(x=>x.ownerId===ownerId&&x.sessionId===sessionId&&x.id===id&&x.nonce===nonce&&x.expiresAt>Date.now());
  if(!intent||intent.fingerprint!==fingerprint)throw fail("Installation request expired or mismatched",403);
  const plugin=getPlugin(id);
  if(!plugin||!plugin.ready||digest({id:plugin.id,version:plugin.version,permissions:plugin.permissions,tools:plugin.tools})!==fingerprint)
   throw fail("Plugin changed; review permissions again",409);
  if(installed(ownerId,id))throw fail("Already installed",409);
  state.intents=state.intents.filter(x=>x!==intent);
  const record={id,version:plugin.version,manifestHash:fingerprint,installedAt:new Date().toISOString(),enabled:true};
  state.installed.push({ownerId,...record});
  save("plugin.installed",ownerId,id);
  return record;
 }
 function uninstall(ownerId,id){
  if(!installed(ownerId,id))throw fail("Plugin not installed",404);
  state.installed=state.installed.filter(x=>!(x.ownerId===ownerId&&x.id===id));
  state.intents=state.intents.filter(x=>!(x.ownerId===ownerId&&x.id===id));
  save("plugin.uninstalled",ownerId,id);
  return {id,uninstalled:true};
 }
 function setEnabled(ownerId,id,enabled){
  const record=installed(ownerId,id);
  if(!record)throw fail("Plugin not installed",404);
  if(typeof enabled!=="boolean")throw fail("Enabled must be boolean");
  record.enabled=enabled;
  save(enabled?"plugin.enabled":"plugin.disabled",ownerId,id);
  return {id,enabled};
 }
 return {catalog:pluginCatalog,getPlugin,prepare,install,uninstall,setEnabled,installed,list,
  audit:ownerId=>state.audit.filter(x=>x.ownerId===ownerId).slice(0,40)};
}

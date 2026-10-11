import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {createTransactionalPluginDocument} from "./plugin-transactional-store.mjs";

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
const empty=()=>({version:1,installed:[],intents:[],audit:[]});
const valid=x=>x?.version===1&&Array.isArray(x.installed)&&Array.isArray(x.intents)&&Array.isArray(x.audit);

export function createPluginInstallStore({dir,readyProviders={}}={}){
 const folder=dir||join(process.cwd(),".ciro-runtime");
 const database=createTransactionalPluginDocument({
  dir:folder,kind:"plugin_installs",legacyName:"plugin-installs.json",initial:empty,validate:valid
 });
 const catalog=pluginCatalog.map(x=>({...x,ready:x.id==="supabase"?readyProviders.supabase===true:x.ready}));
 const getPlugin=id=>catalog.find(x=>x.id===id);
 const find=(state,ownerId,id)=>state.installed.find(x=>x.ownerId===ownerId&&x.id===id)||null;
 function mutate(event,ownerId,id,fn){
  return database.mutate(state=>{
    const result=fn(state);
    state.audit.unshift({id:randomUUID(),event,ownerId,pluginId:id,at:new Date().toISOString()});
    state.audit=state.audit.slice(0,200);
    state.intents=state.intents.filter(x=>x.expiresAt>Date.now()).slice(-100);
    return result;
  });
 }
 function installed(ownerId,id){return find(database.read(),ownerId,id);}
 function list(ownerId){
  return database.read().installed.filter(x=>x.ownerId===ownerId)
    .map(({ownerId:_,...record})=>record);
 }
 function prepare({ownerId,sessionId,id,verifiedPackage=null}){
  const plugin=getPlugin(id);
  if(!plugin)throw fail("Plugin not found",404);
  if(!plugin.ready)throw fail("Plugin is not ready for installation",409);
  let signedPackage=null;
  if(verifiedPackage){
    const incoming=verifiedPackage.manifest;
    if(incoming?.id!==id||incoming.version!==plugin.version||
       incoming.runtime?.adapter!==id||
       JSON.stringify(incoming.permissions)!==JSON.stringify(plugin.permissions)||
       JSON.stringify(incoming.tools)!==JSON.stringify(plugin.tools)||
       !/^[a-f0-9]{64}$/.test(verifiedPackage.digest)||
       !Number.isFinite(Date.parse(incoming.expiresAt))||
       Date.parse(incoming.expiresAt)<=Date.now())
      throw fail("Signed package does not match approved adapter capabilities",403);
    signedPackage={digest:verifiedPackage.digest,issuer:verifiedPackage.signer,
      expiresAt:incoming.expiresAt};
  }
  const nonce=randomUUID();
  const fingerprint=digest({id:plugin.id,version:plugin.version,permissions:plugin.permissions,tools:plugin.tools});
  return mutate("install.prepared",ownerId,id,state=>{
    if(find(state,ownerId,id))throw fail("Plugin already installed",409);
    state.intents=state.intents.filter(x=>x.ownerId!==ownerId||x.id!==id);
    state.intents.push({nonce,ownerId,sessionId,id,fingerprint,signedPackage,
      expiresAt:Date.now()+300000});
    return {nonce,plugin:{...plugin},fingerprint,expiresInSeconds:300,
      signedPackage};
  });
 }
 function install({ownerId,sessionId,id,nonce,fingerprint,confirm}){
  if(confirm!==true)throw fail("Explicit marketplace confirmation required",403);
  return mutate("plugin.installed",ownerId,id,state=>{
    const intent=state.intents.find(x=>x.ownerId===ownerId&&x.sessionId===sessionId&&
      x.id===id&&x.nonce===nonce&&x.expiresAt>Date.now());
    if(!intent||intent.fingerprint!==fingerprint)throw fail("Installation request expired or mismatched",403);
    const plugin=getPlugin(id);
    if(!plugin||!plugin.ready||digest({id:plugin.id,version:plugin.version,
      permissions:plugin.permissions,tools:plugin.tools})!==fingerprint)
      throw fail("Plugin changed; review permissions again",409);
    if(find(state,ownerId,id))throw fail("Already installed",409);
    if(intent.signedPackage&&Date.parse(intent.signedPackage.expiresAt)<=Date.now())
      throw fail("Signed plugin package expired before confirmation",403);
    state.intents=state.intents.filter(x=>x!==intent);
    const record={id,version:plugin.version,manifestHash:fingerprint,installedAt:new Date().toISOString(),enabled:true,
      ...(intent.signedPackage?{packageDigest:intent.signedPackage.digest,
        packageIssuer:intent.signedPackage.issuer}:{})};
    state.installed.push({ownerId,...record});
    return record;
  });
 }
 function uninstall(ownerId,id){
  return mutate("plugin.uninstalled",ownerId,id,state=>{
    if(!find(state,ownerId,id))throw fail("Plugin not installed",404);
    state.installed=state.installed.filter(x=>!(x.ownerId===ownerId&&x.id===id));
    state.intents=state.intents.filter(x=>!(x.ownerId===ownerId&&x.id===id));
    return {id,uninstalled:true};
  });
 }
 function setEnabled(ownerId,id,enabled){
  if(typeof enabled!=="boolean")throw fail("Enabled must be boolean");
  return mutate(enabled?"plugin.enabled":"plugin.disabled",ownerId,id,state=>{
    const record=find(state,ownerId,id);
    if(!record)throw fail("Plugin not installed",404);
    record.enabled=enabled;
    return {id,enabled};
  });
 }
 return {catalog,getPlugin,prepare,install,uninstall,setEnabled,installed,list,
  audit:ownerId=>database.read().audit.filter(x=>x.ownerId===ownerId).slice(0,40),
  close:database.close};
}

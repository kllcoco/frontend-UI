import {accountApi,getAccountSession} from "./account-api";
import type {Conversation} from "../types";
import type {Language} from "./i18n";
import type {CustomInstructions} from "./instructions";
import type {AppearanceSettings} from "./appearance";
import type {ChatPreferences} from "./preferences";
import {loadConversations,loadActiveId,saveConversations,saveActiveId,loadTheme,saveTheme} from "./storage";
import {loadLanguage,saveLanguage} from "./i18n";
import {loadCustomInstructions,saveCustomInstructions} from "./instructions";
import {loadAppearance,saveAppearance} from "./appearance";
import {loadChatPreferences,saveChatPreferences} from "./preferences";

const LOCAL_FLAG="ciro.cloud.auto-sync.v1";
export type SyncPayload={
  conversations:Conversation[];
  activeId:string|null;
  preferences:{theme:"light"|"dark";language:Language;instructions:CustomInstructions;
    appearance:AppearanceSettings;chat:ChatPreferences}
};
export type SyncSignal={status:"off"|"connecting"|"ready"|"conflict"|"error"|"unauthenticated";version:number;message:string};
export type CloudState={version:number;updatedAt:string|null;snapshot:SyncPayload|null};
const state:SyncSignal={status:"off",version:0,message:""};
let timer:ReturnType<typeof setTimeout>|null=null;
let interval:ReturnType<typeof setInterval>|null=null;
let queue:Promise<void>=Promise.resolve();
let lastAck="";
let applyRemote:((snapshot:SyncPayload)=>void)|null=null;
let snapshotNow:(()=>SyncPayload)|null=null;
let suppressUntil=0;
const notify=()=>window.dispatchEvent(new CustomEvent("ciro-cloud-sync",{detail:{...state}}));
const set=(status:SyncSignal["status"],message="",version=state.version)=>{
  state.status=status;state.version=version;state.message=message;notify();
};
export function autoSyncEnabled():boolean{
  try{return localStorage.getItem(LOCAL_FLAG)==="true";}catch{return false;}
}
export function configureAutoSync(enabled:boolean){
  localStorage.setItem(LOCAL_FLAG,enabled?"true":"false");
}
export function currentSyncState():SyncSignal{return {...state};}
export function readLocalSnapshot():SyncPayload{
  return {conversations:loadConversations(),activeId:loadActiveId(),preferences:{
    theme:loadTheme(),language:loadLanguage(),instructions:loadCustomInstructions(),
    appearance:loadAppearance(),chat:loadChatPreferences()
  }};
}
export function persistCloudSnapshot(input:SyncPayload){
  saveConversations(input.conversations);
  saveActiveId(input.activeId);
  const pref=input.preferences;
  if(["dark","light"].includes(pref?.theme))saveTheme(pref.theme);
  if(["en","zh-CN"].includes(pref?.language))saveLanguage(pref.language);
  if(pref?.instructions&&typeof pref.instructions.enabled==="boolean" &&
    typeof pref.instructions.about==="string"&&typeof pref.instructions.style==="string")
    saveCustomInstructions(pref.instructions);
  if(pref?.appearance&&typeof pref.appearance==="object"){
    const a=pref.appearance;
    if(["white","night","aurora","summit","city","minimal","custom"].includes(a.preset)&&
      ["all","welcome"].includes(a.scope)&&
      [a.brightness,a.blur,a.overlay].every(Number.isFinite))saveAppearance(a);
  }
  if(pref?.chat&&typeof pref.chat==="object" &&
    typeof pref.chat.sendWithEnter==="boolean")saveChatPreferences(pref.chat);
}
function eq(a:SyncPayload,b:SyncPayload):boolean{
  return JSON.stringify(a)===JSON.stringify(b);
}
export async function startAutoSync(handlers:{
  onRemote:(data:SyncPayload)=>void;
  capture:()=>SyncPayload
}):Promise<void>{
  stopAutoSync();
  if(!autoSyncEnabled()){set("off");return;}
  applyRemote=handlers.onRemote;snapshotNow=handlers.capture;
  set("connecting","Connecting to your signed-in server");
  try{
    const status=await getAccountSession();
    if(!status.enabled||!status.authenticated){set("unauthenticated","Sign in to enable cloud sync");return;}
    const response=await accountApi<CloudState>("/sync");
    const local=handlers.capture();
    if(!response.snapshot){
      // Initial empty server: first device contributes the first version.
      const saved=await accountApi<{version:number}>("/sync","PUT",{baseVersion:response.version,snapshot:local});
      lastAck=JSON.stringify(local);set("ready","",saved.version);
    }else if(local.conversations.length===0 && response.snapshot.conversations.length>0){
      // A newly logged-in device with no chats can safely hydrate from server.
      suppressUntil=Date.now()+1600;
      persistCloudSnapshot(response.snapshot);
      applyRemote(response.snapshot);
      lastAck=JSON.stringify(response.snapshot);set("ready","",response.version);
    }else if(eq(local,response.snapshot)){
      lastAck=JSON.stringify(local);set("ready","",response.version);
    }else{
      // Avoid accidental overwrites/undeletes when local and cloud differ.
      set("conflict","Local and cloud data differ. Review and choose one copy in Device sync.",response.version);
      return;
    }
    interval=setInterval(()=>void pollRemote().catch(e=>set("error",String(e))),25000);
  }catch(e){set("error",e instanceof Error?e.message:String(e));}
}
export function stopAutoSync(){
  if(timer){clearTimeout(timer);timer=null;}
  if(interval){clearInterval(interval);interval=null;}
  applyRemote=null;snapshotNow=null;
}
async function pollRemote(){
  if(state.status!=="ready"||!snapshotNow||!applyRemote)return;
  const remote=await accountApi<CloudState>("/sync");
  if(remote.version<=state.version)return;
  if(remote.snapshot&&JSON.stringify(snapshotNow())===lastAck){
    suppressUntil=Date.now()+1500;
    persistCloudSnapshot(remote.snapshot);
    applyRemote(remote.snapshot);
    lastAck=JSON.stringify(remote.snapshot);set("ready","",remote.version);
  }else{
    set("conflict","Remote version advanced while local edits are pending",remote.version);
  }
}
export function queueAutoSync(snapshot:SyncPayload){
  if(state.status!=="ready"||Date.now()<suppressUntil)return;
  if(timer)clearTimeout(timer);
  if(JSON.stringify(snapshot)===lastAck)return;
  timer=setTimeout(()=>{
    timer=null;
    const incoming=snapshotNow?.()||snapshot;
    if(JSON.stringify(incoming)===lastAck)return;
    queue=queue.then(async()=>{
      if(state.status!=="ready")return;
      try{
        const saved=await accountApi<{version:number}>("/sync","PUT",{baseVersion:state.version,snapshot:incoming});
        lastAck=JSON.stringify(incoming);
        set("ready","",saved.version);
      }catch(error){
        const msg=error instanceof Error?error.message:String(error);
        set(msg.includes("conflict")?"conflict":"error",msg);
      }
    });
  },2200);
}

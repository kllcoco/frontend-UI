import {URL} from "node:url";

// No raw string prefix checks: https://github.com.attacker.example is NOT GitHub.
export function isDesktopOriginUrl(raw,origin){
 try{
  const candidate=new URL(raw);
  const app=new URL(origin);
  return candidate.origin===app.origin&&candidate.username===""&&candidate.password===""&&
    candidate.protocol==="http:"&&candidate.hostname==="127.0.0.1";
 }catch{return false;}
}

export function isTrustedExternalUrl(raw){
 try{
  const u=new URL(raw);
  if(u.protocol!=="https:"||u.username||u.password)return false;
  const hostname=u.hostname.toLowerCase();
  return hostname==="github.com"||hostname==="docs.github.com"||
   hostname==="supabase.com"||hostname.endsWith(".supabase.co")||
   hostname==="www.electronjs.org";
 }catch{return false;}
}

export function visibleWindowBounds(saved,displays){
 if(!saved||!Number.isSafeInteger(saved.x)||!Number.isSafeInteger(saved.y)||
    !Number.isSafeInteger(saved.width)||!Number.isSafeInteger(saved.height))return null;
 const width=Math.max(900,Math.min(2800,saved.width));
 const height=Math.max(620,Math.min(1900,saved.height));
 const intersects=(display)=>{
  const rect=display.workArea||display.bounds;
  if(!rect)return false;
  const right=Math.min(saved.x+width,rect.x+rect.width);
  const bottom=Math.min(saved.y+height,rect.y+rect.height);
  const left=Math.max(saved.x,rect.x);
  const top=Math.max(saved.y,rect.y);
  return right-left>=180&&bottom-top>=90;
 };
 return Array.isArray(displays)&&displays.some(intersects)?
  {x:saved.x,y:saved.y,width,height}:null;
}

export function sanitizeWindowState(state){
 if(!state||typeof state!=="object")return null;
 const {x,y,width,height}=state.bounds||{};
 if(![x,y,width,height].every(Number.isSafeInteger))return null;
 return {bounds:{x,y,width,height},maximized:state.maximized===true};
}

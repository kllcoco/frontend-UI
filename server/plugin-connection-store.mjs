import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {sealJSON,unsealJSON} from "./account.mjs";
import {createTransactionalPluginDocument} from "./plugin-transactional-store.mjs";

const empty=()=>({version:1,connections:[],oauth:[],approvals:[],audit:[]});
const valid=x=>x?.version===1&&Array.isArray(x.connections)&&
 Array.isArray(x.oauth)&&Array.isArray(x.approvals)&&Array.isArray(x.audit);
const keyFor=(provider,ownerId)=>"plugin:"+provider+":"+ownerId;
const approvalKey=(ownerId,id)=>"plugin:approval:"+ownerId+":"+id;
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});

export function createPluginConnectionStore({dir,env=process.env}={}){
 const folder=dir||env.CIRO_WORKSPACE_DATA_DIR||join(process.cwd(),".ciro-runtime");
 const database=createTransactionalPluginDocument({
  dir:folder,kind:"plugin_connections",legacyName:"plugin-connections.json",initial:empty,validate:valid
 });
 function change(event,fn,metadata={}){
  return database.mutate(state=>{
   const result=fn(state);
   state.audit.unshift({id:randomUUID(),at:new Date().toISOString(),event,metadata});
   state.audit=state.audit.slice(0,500);
   state.oauth=state.oauth.filter(x=>x.expiresAt>Date.now()).slice(-60);
   state.approvals=state.approvals.filter(x=>x.expiresAt>Date.now()-86_400_000).slice(-120);
   return result;
  });
 }
 function addOAuth({ownerId,sessionId,stateHash,verifier,codeVerifier=null,provider="github"}){
  const sealed=sealJSON({verifier,codeVerifier},env,"plugin:oauth:"+ownerId+":"+stateHash);
  return change("oauth.started",state=>{
   state.oauth=state.oauth.filter(x=>x.ownerId!==ownerId||x.sessionId!==sessionId||x.provider!==provider);
   state.oauth.push({ownerId,sessionId,provider,stateHash,sealed,expiresAt:Date.now()+600000});
  },{provider,ownerId});
 }
 function takeOAuth({ownerId,sessionId,stateHash,provider="github"}){
  const item=change("oauth.consume.attempt",state=>{
   const index=state.oauth.findIndex(x=>x.ownerId===ownerId&&x.sessionId===sessionId&&
    x.provider===provider&&x.stateHash===stateHash&&x.expiresAt>Date.now());
   return index>=0?state.oauth.splice(index,1)[0]:null;
  },{provider,ownerId});
  return item?unsealJSON(item.sealed,env,"plugin:oauth:"+ownerId+":"+stateHash):null;
 }
 function connection(ownerId,provider="github"){
  const found=database.read().connections.find(x=>x.ownerId===ownerId&&x.provider===provider);
  return found?{...found,secret:unsealJSON(found.sealed,env,keyFor(provider,ownerId))}:null;
 }
 function putConnection({ownerId,provider="github",account,secret,scopes=[]}){
  const generation=randomUUID(),sealed=sealJSON(secret,env,keyFor(provider,ownerId));
  change("connection.saved",state=>{
   state.connections=state.connections.filter(x=>x.ownerId!==ownerId||x.provider!==provider);
   state.connections.push({ownerId,provider,account,scopes,generation,sealed,
    connectedAt:new Date().toISOString()});
   state.approvals=state.approvals.filter(x=>x.ownerId!==ownerId||x.provider!==provider);
  },{ownerId,provider});
  return generation;
 }
 function rotateConnectionSecret(ownerId,provider,expectedGeneration,nextSecret){
  const sealed=sealJSON(nextSecret,env,keyFor(provider,ownerId));
  return change("connection.token_rotated",state=>{
   const item=state.connections.find(x=>x.ownerId===ownerId&&x.provider===provider);
   if(!item||item.generation!==expectedGeneration)
    throw fail("Connection was revoked or replaced during token refresh.",409);
   item.sealed=sealed;
   return {generation:item.generation};
  },{ownerId,provider});
 }
 function removeConnection(ownerId,provider="github"){
  return change("connection.revoked",state=>{
   const found=state.connections.some(x=>x.ownerId===ownerId&&x.provider===provider);
   state.connections=state.connections.filter(x=>x.ownerId!==ownerId||x.provider!==provider);
   state.approvals=state.approvals.filter(x=>x.ownerId!==ownerId||x.provider!==provider);
   state.oauth=state.oauth.filter(x=>x.ownerId!==ownerId||x.provider!==provider);
   return found;
  },{ownerId,provider});
 }
 function queueApproval({ownerId,provider,tool,args,source,policySignature,generation,summary}){
  const id=randomUUID(),sealed=sealJSON({tool,args,source},env,approvalKey(ownerId,id));
  change("tool.approval.requested",state=>{
   state.approvals.push({id,ownerId,provider,summary,policySignature,generation,sealed,
    status:"pending",createdAt:new Date().toISOString(),expiresAt:Date.now()+900000});
  },{ownerId,provider,tool});
  return {id,summary};
 }
 function publicRequest(item){
  return {...item,request:unsealJSON(item.sealed,env,approvalKey(item.ownerId,item.id))};
 }
 function getApproval(ownerId,id){
  const item=database.read().approvals.find(x=>x.ownerId===ownerId&&x.id===id&&
   x.status==="pending"&&x.expiresAt>Date.now());
  return item?publicRequest(item):null;
 }
 // Claim is a single atomic pending->processing transition, so two workers cannot
 // both execute the same approved side effect.
 function takeApproval(ownerId,id,decision){
  if(!["approve","reject"].includes(decision))throw fail("Invalid approval decision");
  const nextStatus=decision==="approve"?"processing":"rejected";
  const item=change("tool.approval."+nextStatus,state=>{
   const found=state.approvals.find(x=>x.ownerId===ownerId&&x.id===id&&
    x.status==="pending"&&x.expiresAt>Date.now());
   if(!found)throw fail("Approval expired or already claimed",404);
   found.status=nextStatus;
   found.claimedAt=new Date().toISOString();
   return {...found};
  },{ownerId,id});
  return publicRequest(item);
 }
 function finishApproval(ownerId,id,status){
  if(!["approved","failed"].includes(status))throw fail("Invalid approval finish state");
  return change("tool.approval."+status,state=>{
   const found=state.approvals.find(x=>x.ownerId===ownerId&&x.id===id);
   if(!found||found.status!=="processing")throw fail("Approval is not in processing state",409);
   found.status=status;
   found.finishedAt=new Date().toISOString();
  },{ownerId,id});
 }
 return {
  get:database.read,change,addOAuth,takeOAuth,connection,putConnection,removeConnection,
  queueApproval,getApproval,takeApproval,finishApproval,rotateConnectionSecret,
  publicConnections:ownerId=>database.read().connections.filter(x=>x.ownerId===ownerId)
   .map(({provider,account,scopes,connectedAt,generation})=>({provider,account,scopes,connectedAt,generation})),
  publicApprovals:ownerId=>database.read().approvals.filter(x=>x.ownerId===ownerId&&
    x.status==="pending"&&x.expiresAt>Date.now())
   .map(({id,provider,summary,createdAt})=>({id,provider,summary,createdAt})),
  audit:ownerId=>database.read().audit.filter(x=>x.metadata?.ownerId===ownerId).slice(0,70),
  close:database.close
 };
}

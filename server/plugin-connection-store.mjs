import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {sealJSON, unsealJSON} from "./account.mjs";

const empty = () => ({version:1, connections:[], oauth:[], approvals:[], audit:[]});
const keyFor = (provider, ownerId) => "plugin:" + provider + ":" + ownerId;
const approvalKey = (ownerId, id) => "plugin:approval:" + ownerId + ":" + id;

export function createPluginConnectionStore({dir, env=process.env}={}) {
  const folder = dir || env.CIRO_WORKSPACE_DATA_DIR || join(process.cwd(), ".ciro-runtime");
  mkdirSync(folder, {recursive:true, mode:0o700});
  const path = join(folder, "plugin-connections.json");
  let state = empty();
  if (existsSync(path)) {
    const stat = statSync(path);
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      throw new Error("Plugin credentials file is not private (chmod 600 required).");
    const input = JSON.parse(readFileSync(path, "utf8"));
    if (input?.version !== 1 || !Array.isArray(input.connections) ||
        !Array.isArray(input.oauth) || !Array.isArray(input.approvals) || !Array.isArray(input.audit))
      throw new Error("Incompatible plugin state; refusing destructive migration.");
    state = input;
  }
  function save() {
    const temp = path + "." + process.pid + "." + randomUUID() + ".tmp";
    writeFileSync(temp, JSON.stringify(state), {mode:0o600, flag:"wx"});
    renameSync(temp, path);
  }
  function change(event, fn, metadata={}) {
    const result = fn(state);
    state.audit.unshift({id:randomUUID(), at:new Date().toISOString(), event, metadata});
    state.audit = state.audit.slice(0,500);
    state.oauth = state.oauth.filter(x=>x.expiresAt>Date.now()).slice(-60);
    state.approvals = state.approvals.filter(x=>x.expiresAt>Date.now()-86_400_000).slice(-120);
    save();
    return result;
  }
  function addOAuth({ownerId, sessionId, stateHash, verifier, codeVerifier=null, provider="github"}) {
    const sealed = sealJSON({verifier,codeVerifier}, env, "plugin:oauth:" + ownerId + ":" + stateHash);
    return change("oauth.started", s=>{
      s.oauth = s.oauth.filter(x=>x.ownerId!==ownerId || x.sessionId!==sessionId || x.provider!==provider);
      s.oauth.push({ownerId,sessionId,provider,stateHash,sealed,expiresAt:Date.now()+10*60_000});
    }, {provider,ownerId});
  }
  function takeOAuth({ownerId,sessionId,stateHash,provider="github"}) {
    const item = state.oauth.find(x=>x.ownerId===ownerId && x.sessionId===sessionId &&
      x.stateHash===stateHash && x.provider===provider && x.expiresAt>Date.now());
    if (!item) return null;
    change("oauth.consumed", s=>{s.oauth=s.oauth.filter(x=>x!==item);}, {provider,ownerId});
    return unsealJSON(item.sealed,env,"plugin:oauth:"+ownerId+":"+stateHash);
  }
  function connection(ownerId, provider="github") {
    const found = state.connections.find(x=>x.ownerId===ownerId && x.provider===provider);
    if (!found) return null;
    return {...found, secret:unsealJSON(found.sealed,env,keyFor(provider,ownerId))};
  }
  function putConnection({ownerId,provider="github",account,secret,scopes=[]}) {
    const generation=randomUUID();
    const sealed=sealJSON(secret,env,keyFor(provider,ownerId));
    change("connection.saved",s=>{
      s.connections=s.connections.filter(x=>x.ownerId!==ownerId || x.provider!==provider);
      s.connections.push({ownerId,provider,account,scopes,generation,sealed,
        connectedAt:new Date().toISOString()});
      s.approvals=s.approvals.filter(x=>x.ownerId!==ownerId || x.provider!==provider);
    },{provider,ownerId});
    return generation;
  }
  function rotateConnectionSecret(ownerId,provider,expectedGeneration,nextSecret) {
    const sealed=sealJSON(nextSecret,env,keyFor(provider,ownerId));
    return change("connection.token_rotated",s=>{
      const item=s.connections.find(x=>x.ownerId===ownerId&&x.provider===provider);
      if(!item||item.generation!==expectedGeneration)
        throw new Error("Connection was revoked or replaced during token refresh.");
      item.sealed=sealed;
      return {generation:item.generation};
    },{provider,ownerId});
  }
  function removeConnection(ownerId,provider="github") {
    const found=state.connections.some(x=>x.ownerId===ownerId && x.provider===provider);
    change("connection.revoked",s=>{
      s.connections=s.connections.filter(x=>x.ownerId!==ownerId || x.provider!==provider);
      s.approvals=s.approvals.filter(x=>x.ownerId!==ownerId || x.provider!==provider);
      s.oauth=s.oauth.filter(x=>x.ownerId!==ownerId||x.provider!==provider);
    },{provider,ownerId});
    return found;
  }
  function queueApproval({ownerId,provider,tool,args,source,policySignature,generation,summary}) {
    const id=randomUUID();
    const sealed=sealJSON({tool,args,source},env,approvalKey(ownerId,id));
    change("tool.approval.requested",s=>s.approvals.push({
      id,ownerId,provider,summary,policySignature,generation,sealed,
      status:"pending",createdAt:new Date().toISOString(),expiresAt:Date.now()+15*60_000
    }),{ownerId,provider,tool});
    return {id,summary};
  }
  function getApproval(ownerId,id) {
    const item=state.approvals.find(x=>x.ownerId===ownerId&&x.id===id&&x.status==="pending"&&x.expiresAt>Date.now());
    return item?{...item,request:unsealJSON(item.sealed,env,approvalKey(ownerId,item.id))}:null;
  }
  function finishApproval(ownerId,id,status) {
    if (!["processing","approved","rejected","failed"].includes(status))throw new Error("Bad approval state");
    return change("tool.approval."+status,s=>{
      const item=s.approvals.find(x=>x.ownerId===ownerId&&x.id===id);
      if(!item)throw new Error("Approval no longer exists.");
      item.status=status;
    },{ownerId,id});
  }
  return {
    get:()=>state,change,addOAuth,takeOAuth,connection,putConnection,removeConnection,
    queueApproval,getApproval,finishApproval,rotateConnectionSecret,
    publicConnections:ownerId=>state.connections.filter(x=>x.ownerId===ownerId)
      .map(({provider,account,scopes,connectedAt,generation})=>({provider,account,scopes,connectedAt,generation})),
    publicApprovals:ownerId=>state.approvals.filter(x=>x.ownerId===ownerId&&x.status==="pending"&&x.expiresAt>Date.now())
      .map(({id,provider,summary,createdAt})=>({id,provider,summary,createdAt})),
    audit:ownerId=>state.audit.filter(x=>x.metadata?.ownerId===ownerId).slice(0,70)
  };
}

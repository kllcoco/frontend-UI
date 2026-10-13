import {randomUUID} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,statSync} from "node:fs";
import {join} from "node:path";

// Accounts on one Ciro server. The first account (created with the bootstrap token) is the server
// owner: the only one who can publish announcements, manage users or use the workbench / studio /
// plugins. Everyone else registers as an ordinary user with their own sessions, API keys, memories,
// notifications and synced data.
function blank(){
  return {version:2,users:[],invites:[],sessions:[],apiKeys:[],memories:[],
    notifications:[],syncs:{},
    subscription:{provider:"stripe",status:"not_connected",customerId:null,subscriptionId:null,
      cancelAtPeriodEnd:false,currentPeriodEnd:null,updatedAt:null},
    webhookEvents:[],audit:[]};
}
/** Version 1 had a single `owner`; everything it held becomes the owner's in version 2. */
export function migrateAccountState(data){
  if(data?.version===2)return data;
  if(data?.version!==1||!Array.isArray(data.sessions)||!Array.isArray(data.apiKeys))
    throw new Error("Account state incompatible, refusing destructive migration.");
  const owner=data.owner?{...data.owner,role:"owner"}:null,id=owner?.id||null;
  const mine=list=>(Array.isArray(list)?list:[]).map(x=>({userId:id,...x}));
  const {owner:_o,sync,...rest}=data;
  return {...rest,version:2,users:owner?[owner]:[],invites:[],
    sessions:mine(data.sessions),apiKeys:mine(data.apiKeys),memories:mine(data.memories),
    notifications:mine(data.notifications),syncs:id&&sync?{[id]:sync}:{}};
}
export function createAccountStore(dir){
  mkdirSync(dir,{recursive:true,mode:0o700});
  const path=join(dir,"account-state.json");
  let state=blank();
  if(existsSync(path)){
    const stat=statSync(path);
    if(process.platform!=="win32"&&(stat.mode&0o077)!==0)
      throw new Error("Account store has unsafe permissions; chmod 600 required.");
    const data=migrateAccountState(JSON.parse(readFileSync(path,"utf8")));
    state={...blank(),...data,subscription:{...blank().subscription,...data.subscription}};
  }
  function write(){
    const temp=path+"."+process.pid+"."+randomUUID()+".tmp";
    writeFileSync(temp,JSON.stringify(state),{mode:0o600,flag:"wx"});
    renameSync(temp,path);
  }
  return {
    get:()=>state,
    owner:()=>state.users.find(x=>x.role==="owner")||null,
    user:id=>state.users.find(x=>x.id===id)||null,
    change:(event,fn)=>{
      fn(state);
      state.audit.unshift({id:randomUUID(),event,at:new Date().toISOString()});
      state.audit=state.audit.slice(0,200);
      write();return state;
    },
    id:()=>randomUUID()
  };
}

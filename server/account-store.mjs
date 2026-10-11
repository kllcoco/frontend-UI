import {randomUUID} from "node:crypto";
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,statSync} from "node:fs";
import {join} from "node:path";

function blank(){
  return {version:1,owner:null,sessions:[],apiKeys:[],memories:[],
    notifications:[],sync:{version:0,encrypted:null,updatedAt:null},
    subscription:{provider:"stripe",status:"not_connected",customerId:null,subscriptionId:null,
      cancelAtPeriodEnd:false,currentPeriodEnd:null,updatedAt:null},
    webhookEvents:[],audit:[]};
}
export function createAccountStore(dir){
  mkdirSync(dir,{recursive:true,mode:0o700});
  const path=join(dir,"account-state.json");
  let state=blank();
  if(existsSync(path)){
    const data=JSON.parse(readFileSync(path,"utf8"));
    if(data?.version!==1||!Array.isArray(data.sessions)||!Array.isArray(data.apiKeys))
      throw new Error("Account state incompatible, refusing destructive migration.");
    state={...blank(),...data,sync:{...blank().sync,...data.sync},
      subscription:{...blank().subscription,...data.subscription}};
    const stat=statSync(path);
    if(process.platform!=="win32"&&(stat.mode&0o077)!==0)
      throw new Error("Account store has unsafe permissions; chmod 600 required.");
  }
  function write(){
    const temp=path+"."+process.pid+"."+randomUUID()+".tmp";
    writeFileSync(temp,JSON.stringify(state),{mode:0o600,flag:"wx"});
    renameSync(temp,path);
  }
  return {
    get:()=>state,
    change:(event,fn)=>{
      fn(state);
      state.audit.unshift({id:randomUUID(),event,at:new Date().toISOString()});
      state.audit=state.audit.slice(0,100);
      write();return state;
    },
    id:()=>randomUUID()
  };
}

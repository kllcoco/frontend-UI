// Dedicated single-host plugin read-worker. Supervise this process with your service
// manager; do not expose it to HTTP or give it an account-admin token.
import "dotenv/config";
import {randomUUID} from "node:crypto";
import {createPluginGateway} from "./plugin-gateway.mjs";
import {assertPluginDeploymentSafe} from "./plugin-release-gate.mjs";

assertPluginDeploymentSafe(process.env);
const gateway=createPluginGateway();
const workerId=randomUUID();
let active=true,errors=0;
process.on("SIGINT",()=>{active=false;});
process.on("SIGTERM",()=>{active=false;});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 while(active){
  try{
   const result=await gateway.runNextJob({workerId});
   errors=0;
   if(!result)await sleep(500);
  }catch(error){
   errors++;
   console.error("Plugin worker loop failed:",String(error?.message||"unknown").slice(0,160));
   if(errors>=3)throw new Error("Plugin worker unable to serve durable queue");
   await sleep(1500);
  }
 }
}finally{
 gateway.jobs.close();
 gateway.installs.close();
 gateway.store.close();
}

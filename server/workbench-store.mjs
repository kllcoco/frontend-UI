import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { defaultPolicy } from "./agent-policy.mjs";

function initial() {
  return { version: 1, policy: defaultPolicy(), goals: [], schedules: [], approvals: [],
    plugins: { github: true, scheduler: true, runner: true }, audit: [] };
}
export function createWorkbenchStore(dir) {
  const target = join(dir, "state.json");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let state = initial();
  if (existsSync(target)) {
    const data=JSON.parse(readFileSync(target, "utf8"));
    if (data?.version !== 1 || !Array.isArray(data.goals) || !Array.isArray(data.audit)) {
      throw new Error("Workbench state version invalid; refusing destructive migration.");
    }
    state={ ...initial(), ...data, policy: data.policy || defaultPolicy() };
  }
  function save(){
    const temp = target+"."+process.pid+"."+randomUUID()+".tmp";
    writeFileSync(temp,JSON.stringify(state,null,2),{mode:0o600,flag:"wx"});
    renameSync(temp,target);
  }
  function audit(event, details={}) {
    state.audit.unshift({id:randomUUID(),time:new Date().toISOString(),event,details});
    state.audit=state.audit.slice(0,350);
  }
  return {
    get:()=>state,
    change:(action,details={},modify=()=>{})=>{
      modify(state); audit(action,details);save();return state;
    },
    id:()=>randomUUID(),
    snapshot:()=>({
      policy:state.policy,goals:state.goals.slice(0,70),schedules:state.schedules.slice(0,60),
      approvals:state.approvals.filter(x=>x.status==="pending").map(({id,createdAt,type,summary,scope})=>({id,createdAt,type,summary,scope})),
      audit:state.audit.slice(0,100), plugins:state.plugins
    })
  };
}

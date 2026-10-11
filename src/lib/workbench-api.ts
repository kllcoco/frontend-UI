import {accountFetch} from "./account-api";
import type {StudioTab} from "./studio-api";
export type PermissionMode = "request" | "auto" | "full" | "custom";
export type AgentMode = "goal" | "plan";
export type WorkbenchTab = "goals" | "permissions" | "github" | "plugins" | "schedules" | "billing" | "apps" | "skills" | "account" | "subscription" | "api-keys" | "spending" | "notifications" | "memory" | "sync" | StudioTab;
export type PermissionCustom = {
  githubRead: boolean; githubWrite: boolean; taskExecution: boolean;
  recurringTasks: boolean; externalNetwork: boolean
};
export type WorkbenchPolicy = { mode: PermissionMode; custom: PermissionCustom; repo: string };
export type WorkbenchGoal = {
  id:string;title:string;goal:string;repo:string;mode:AgentMode;phase:string;status:string;
  createdAt:string;updatedAt:string;attempt:number;error:string|null;
  plan:{id:string;title:string;role:string;acceptance:string;status:string}[];
  evidence:{type:string;digest:string;location:string;phase:string;actor:string}[];
  events:{time:string;event:string;details:string}[]
};
export type WorkbenchSchedule = {
  id:string;title:string;goal:string;recurrence:"hourly"|"daily"|"weekly";hour:number|null;
  weekday:number|null;timezone:string;enabled:boolean;lastSlot:string|null
};
export type WorkbenchPlugin = {id:string;title:string;description:string;enabled:boolean;ready:boolean;detail:string};
export type WorkbenchApproval = {
  id:string;createdAt:string;type:string;summary:string;scope:{repo?:string}
};
export type WorkbenchState = {
  policy:WorkbenchPolicy; goals:WorkbenchGoal[];schedules:WorkbenchSchedule[];
  approvals:WorkbenchApproval[];
  audit:{id:string;time:string;event:string;details:Record<string,unknown>}[];
  plugins:Record<string,boolean>;
  capabilities:{
    repo:string[];
    github:{configured:boolean;writeEnabled:boolean;allowedRepositories:string[];selectedRepo:string};
    runtime:{runner:boolean;verifier:boolean;working:boolean};
    plugins:WorkbenchPlugin[]
  }
};
export type GithubFile = { repo:string;path:string;sha:string;content:string };
export type WorkbenchResponse = {status:string;approval?:{id:string;summary:string}};
export async function workbenchApi<T>(path:string, payload?:unknown):Promise<T> {
  const response=await accountFetch("/api/workbench"+path,{
    method:payload===undefined?"GET":"POST",
    headers:payload===undefined?undefined:{"Content-Type":"application/json"},
    cache:"no-store",
    ...(payload===undefined?{}:{body:JSON.stringify(payload)})
  });
  const result:unknown=await response.json().catch(()=>({}));
  if(!response.ok) {
    const error=(result&&typeof result==="object"&&"error" in result)?String(result.error):"Request failed (HTTP "+response.status+")";
    throw new Error(error);
  }
  return result as T;
}
export function initialPermissionCustom():PermissionCustom {
  return {githubRead:true,githubWrite:false,taskExecution:false,recurringTasks:false,externalNetwork:false};
}

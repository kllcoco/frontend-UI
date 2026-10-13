import { localeTag } from "./i18n";
import type { Language } from "./i18n";
import {accountFetch,readApiJson} from "./account-api";
export type StudioTab="studio"|"thinking"|"ide"|"knowledge"|"research"|"media"|"compute"|"library"|"marketplace"|"devices";
export type NativeService={configured:boolean;verified:boolean;status:string};
export type StudioCapabilities={
  version:string;mode:string;languageDefault:string;
  thinking:{modes:string[];provider:NativeService;deepChatSupported:boolean};
  workbench:{status:string};
  ide:{draftEditor:boolean;projectCheckpoint:boolean;sandboxExecution:NativeService};
  knowledge:{localTextIndex:boolean;embedding:NativeService};
  research:NativeService;media:NativeService;
  compute:{signedTelemetry:boolean;status:string;modelControl:NativeService};
  conversations:{folderAndBranch:string;checkpoint:string};
  marketplace:{builtInDirectory:boolean;remoteRegistry:NativeService};
  devices:{pwaShell:boolean;nativeApps:string;accountSync:string}
};
export type DraftFile={path:string;content:string;version:number;updatedAt:string};
export type DraftCheckpoint={id:string;label:string;createdAt:string;revision:number;digest:string};
export type DraftProject={
  id:string;name:string;createdAt:string;updatedAt:string;revision:number;
  files:DraftFile[];checkpoints:DraftCheckpoint[]
};
export type KnowledgeDoc={id:string;title:string;source:string;bytes:number;sha256:string;createdAt:string;indexedAt?:string;indexId?:string};
export type KnowledgeHit={id:string;title:string;source:string;sha256:string;citation:string;
  excerpt:string;line:number;score:number};
export type NativeJob={jobId:string;status:string;summary?:string|null;
  evidence?:unknown[];sources?:{title:string;url:string;excerpt:string}[];verified?:boolean};
export type ModelOverview={
  source:string;models:Record<string,string|number>[];trainingRuns:Record<string,string|number>[];
  datasets:Record<string,string|number>[];checkpoints:Record<string,string|number>[]
};
export type TrainingDetail={id:string;status:string;source:string;evidenceSha256:string|null;
  metrics:{step:number;loss:number;validationLoss?:number}[]};
export type Telemetry={eventId:string;observedAt:string;receivedAt:string;source:string;
  metrics:Record<string,number>};
export type MarketEntry={id:string;kind:"app"|"skill";title:string;description:string;version:string;
  sha256:string;permissions:string[];signature:string;status:string};
export async function studioApi<T>(path:string,method="GET",body?:unknown):Promise<T>{
  const response=await accountFetch("/api/studio"+path,{
    method,headers:body===undefined?undefined:{"Content-Type":"application/json"},
    ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  return readApiJson<T>(response,"Studio request failed");
}
export function humanBytes(value:number,language:Language){
  if(value<1024)return value+" B";
  return new Intl.NumberFormat(localeTag(language),{maximumFractionDigits:1})
    .format(value/1024)+" KB";
}

"use strict";
const {randomBytes}=require("node:crypto");
const {existsSync,readFileSync,mkdirSync,writeFileSync}=require("node:fs");
const {join}=require("node:path");
const VERSION=1;
function isLocalHost(hostname){
 return ["127.0.0.1","localhost","[::1]"].includes(hostname);
}
function trustedLocalUrl(value,expectedPort){
 try {
  const url=new URL(value);
  return url.protocol==="http:"&&isLocalHost(url.hostname)&&
   Number(url.port)===expectedPort&&!url.username&&!url.password;
 }catch{return false;}
}
function loadOrCreateSecrets(root){
 mkdirSync(root,{recursive:true,mode:0o700});
 const path=join(root,"desktop-secrets.json");
 let record,firstRun=false;
 if(existsSync(path)){
  record=JSON.parse(readFileSync(path,"utf8"));
 }else{
  firstRun=true;
  record={schema:VERSION,accountDataKey:randomBytes(32).toString("base64"),
   apiPepper:randomBytes(32).toString("base64url"),
   bootstrapToken:randomBytes(36).toString("base64url")};
  writeFileSync(path,JSON.stringify(record),{flag:"wx",mode:0o600});
 }
 if(record?.schema!==VERSION||
    typeof record.accountDataKey!=="string"||
    Buffer.from(record.accountDataKey,"base64").length!==32||
    typeof record.apiPepper!=="string"||record.apiPepper.length<24||
    typeof record.bootstrapToken!=="string"||record.bootstrapToken.length<24)
  throw new Error("CIRO desktop key file missing or incompatible. Preserve the original; never reset it automatically.");
 const envPath=join(root,".env");
 if(!existsSync(envPath)){
  const defaults=[
   "# CIRO Desktop owner-only configuration; never commit or paste credentials",
   "# Operator must explicitly allowlist a GitHub repository; no company repo is granted by default",
   "CIRO_GITHUB_REPOS=",
   "CIRO_GITHUB_WRITES=false",
   "CIRO_GITHUB_SELF_REPO=",
   "CIRO_GITHUB_SELF_REPAIR_ENABLED=false",
   "# CIRO_API_BASE_URL= (own model inference endpoint; leave empty for preview)",
   ""
  ].join("\n");
  writeFileSync(envPath,defaults,{flag:"wx",mode:0o600});
 }
 return {record,firstRun,path,envPath};
}
function childEnvironment(base,root,record){
 return {...base,ELECTRON_RUN_AS_NODE:"1",HOST:"127.0.0.1",PORT:"0",
  CIRO_DEPLOYMENT_MODE:"single-owner",CIRO_PUBLIC_MULTI_TENANT:"false",
  CIRO_ACCOUNTS_ENABLED:"true",CIRO_PUBLIC_ORIGIN:"",
  CIRO_WORKSPACE_DATA_DIR:root,CIRO_ACCOUNT_DATA_KEY:record.accountDataKey,
  CIRO_API_KEY_PEPPER:record.apiPepper,CIRO_BOOTSTRAP_TOKEN:record.bootstrapToken,
  CIRO_GITHUB_FINE_GRAINED_PAT_ENABLED:"true"};
}
module.exports={trustedLocalUrl,loadOrCreateSecrets,childEnvironment};

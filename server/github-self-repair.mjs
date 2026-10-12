import {validateRepo,safeBranch} from "./agent-policy.mjs";

const bad=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function buildSelfRepairDraft(env,repo,args){
 validateRepo(repo);
 if(env.CIRO_GITHUB_WRITES!=="true"||
    env.CIRO_GITHUB_SELF_REPAIR_ENABLED!=="true"||
    env.CIRO_GITHUB_SELF_REPO!==repo||
    !(env.CIRO_GITHUB_REPOS||"").split(",").map(x=>x.trim()).includes(repo))
  throw bad("Self-repair draft PR disabled or repository not allowlisted",403);
 if(!args||typeof args!=="object"||Array.isArray(args))
  throw bad("Draft PR arguments required");
 const branch=safeBranch(args.branch);
 const base=args.base;
 if(typeof base!=="string"||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,128}$/.test(base)||
    base.includes("..")||base.includes("//")||base.endsWith("/")||base===branch)
  throw bad("Invalid draft PR base");
 const title=typeof args.title==="string"?args.title.trim():"";
 if(!title||title.length>120)throw bad("Draft PR title invalid");
 const body=typeof args.body==="string"?args.body:"";
 if(body.length>3000)throw bad("Draft PR body exceeds 3000 characters");
 return {title,body,base,head:branch,draft:true,maintainer_can_modify:false};
}

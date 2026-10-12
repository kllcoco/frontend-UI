import {createHash} from "node:crypto";
const digest=value=>createHash("sha256").update(value).digest("hex");
export function buildApprovalPreview(item){
 const request=item?.request,args=request?.args;
 if(typeof item?.id!=="string"||typeof item.provider!=="string"||
  typeof request?.tool!=="string"||!args||typeof args!=="object"||Array.isArray(args))
  throw Error("Invalid pending plugin approval");
 const requestSha256=digest(JSON.stringify({provider:item.provider,tool:request.tool,args,source:request.source}));
 const common={id:item.id,provider:item.provider,tool:request.tool,
  summary:item.summary,requestSha256};
 if(item.provider==="github"&&request.tool==="github.write_file"){
  if(typeof args.content!=="string")throw Error("Invalid pending plugin approval");
  return {...common,kind:"full_file_replacement",repo:args.repo,branch:args.branch,
   path:args.path,message:args.message,expectedSha:args.expectedSha||null,
   content:args.content,contentBytes:Buffer.byteLength(args.content,"utf8"),
   contentSha256:digest(args.content)};
 }
 if(item.provider==="github"&&request.tool==="github.open_pull_request")
  return {...common,kind:"draft_pull_request",repo:args.repo,branch:args.branch,
   base:args.base,title:args.title,body:args.body||""};
 if(item.provider==="github"&&request.tool==="github.create_branch")
  return {...common,kind:"branch_creation",repo:args.repo,branch:args.branch,base:args.base||"(default branch)"};
 return {...common,kind:"external_operation"};
}
export const requiresDetailedReview=preview=>preview?.provider==="github"&&
 (preview.tool==="github.write_file"||preview.tool==="github.open_pull_request");

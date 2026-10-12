import test from "node:test";
import assert from "node:assert/strict";
import {buildApprovalPreview,requiresDetailedReview} from "../server/plugin-approval-preview.mjs";
const sample=(tool,args)=>({id:"approval-123",provider:"github",summary:"Review change",
 request:{tool,args,source:"chat"}});
test("full replacement shows exact bytes and scoped digest",()=>{
 const input=sample("github.write_file",{repo:"ciro/test",path:"doc.txt",branch:"ciro/qa",
  message:"Review",content:"hello\n中文",expectedSha:"a".repeat(40)});
 const preview=buildApprovalPreview(input);
 assert.equal(preview.kind,"full_file_replacement");
 assert.equal(preview.content,"hello\n中文");
 assert.equal(preview.contentBytes,Buffer.byteLength(input.request.args.content));
 assert.match(preview.contentSha256,/^[a-f0-9]{64}$/);
 assert.equal(requiresDetailedReview(preview),true);
 const altered=structuredClone(input);
 altered.request.args.content+="!";
 assert.notEqual(buildApprovalPreview(altered).requestSha256,preview.requestSha256);
});
test("draft PR preview includes full body, base and head",()=>{
 const preview=buildApprovalPreview(sample("github.open_pull_request",{
  repo:"ciro/test",branch:"ciro/qa",base:"main",title:"Fix",body:"review before merge"}));
 assert.equal(preview.body,"review before merge");
 assert.equal(preview.base,"main");
 assert.equal(requiresDetailedReview(preview),true);
});
test("branch preview is informational; invalid requests are rejected",()=>{
 assert.equal(requiresDetailedReview(buildApprovalPreview(sample("github.create_branch",{
  repo:"ciro/test",branch:"ciro/qa"}))),false);
 assert.throws(()=>buildApprovalPreview(null),/Invalid pending/);
});

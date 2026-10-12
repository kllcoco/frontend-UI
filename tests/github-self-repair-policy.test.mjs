import test from "node:test";
import assert from "node:assert/strict";
import {buildSelfRepairDraft} from "../server/github-self-repair.mjs";

const env={CIRO_GITHUB_REPOS:"kllcoco/frontend-UI,unrelated/repo",
 CIRO_GITHUB_WRITES:"true",CIRO_GITHUB_SELF_REPO:"kllcoco/frontend-UI",
 CIRO_GITHUB_SELF_REPAIR_ENABLED:"true"};
const args={branch:"ciro/repair-123",base:"feat/ciro-chat-client-v1",
 title:"Repair a regression",body:"Proof and test matrix"};

test("self-repair payload always opens a DRAFT PR and never merges",()=>{
 const value=buildSelfRepairDraft(env,"kllcoco/frontend-UI",args);
 assert.deepEqual(value,{title:"Repair a regression",body:"Proof and test matrix",
  base:"feat/ciro-chat-client-v1",head:"ciro/repair-123",
  draft:true,maintainer_can_modify:false});
 assert.equal("merge_method" in value,false);
});
test("self-repair refuses unapproved repositories, disabled writes and dangerous branches",()=>{
 assert.throws(()=>buildSelfRepairDraft(env,"unrelated/repo",args),/disabled|allowlisted/);
 assert.throws(()=>buildSelfRepairDraft({...env,CIRO_GITHUB_WRITES:"false"},"kllcoco/frontend-UI",args),/disabled/);
 assert.throws(()=>buildSelfRepairDraft(env,"kllcoco/frontend-UI",
  {...args,branch:"main"}),/non-protected branch/);
 assert.throws(()=>buildSelfRepairDraft(env,"kllcoco/frontend-UI",
  {...args,branch:"ciro/../secrets"}));
 assert.throws(()=>buildSelfRepairDraft(env,"kllcoco/frontend-UI",
  {...args,base:"../../main"}),/Invalid draft PR base/);
 assert.throws(()=>buildSelfRepairDraft(env,"kllcoco/frontend-UI",
  {...args,base:"ciro/repair-123"}),/Invalid draft PR base/);
 assert.throws(()=>buildSelfRepairDraft(env,"kllcoco/frontend-UI",
  {...args,title:"x".repeat(121)}),/title invalid/);
 assert.throws(()=>buildSelfRepairDraft(env,"kllcoco/frontend-UI",
  {...args,body:"x".repeat(3001)}),/3000/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {createCiroMcpHandler} from "../supabase/functions/ciro-mcp/mcp-core.mjs";
import {qualifySupabaseMcp} from "../scripts/verify-ciro-supabase-mcp.mjs";

const userA="11111111-1111-4111-8111-111111111111";
const userB="22222222-2222-4222-8222-222222222222";
function adapter({brokenIsolation=false}={}){
 const saved=[];
 const operations={
  async list(userId,limit){
   const rows=brokenIsolation?saved:saved.filter(x=>x.owner_id===userId);
   return rows.slice(-limit);
  },
  async create(userId,op,body){
   const existing=saved.find(x=>x.owner_id===userId&&x.client_op_id===op);
   if(existing){if(existing.body!==body)throw new Error("Idempotency conflict");return existing;}
   const item={id:op,body,owner_id:userId,client_op_id:op};
   saved.push(item);return item;
  }
 };
 const handler=createCiroMcpHandler({authenticate:async token=>{
  if(token==="access_token_of_user_A_long_enough")return {userId:userA,notes:operations};
  if(token==="access_token_of_user_B_long_enough")return {userId:userB,notes:operations};
  throw Error("Bad token");
 }});
 return {
  fetchFn:async(url,opts)=>handler(new Request(url,opts)),
  saved
 };
}
test("external two-user qualification detects actual cross-owner data exposure",async()=>{
 const ok=adapter();
 const receipt=await qualifySupabaseMcp({
  projectRef:"abcdefghij",
  tokenA:"access_token_of_user_A_long_enough",
  tokenB:"access_token_of_user_B_long_enough",fetchFn:ok.fetchFn
 });
 assert.equal(receipt.status,"PASS");
 assert.ok(receipt.evidence.includes("user_B_cannot_read_user_A_record"));
 assert.equal(ok.saved.length,1);
 const bad=adapter({brokenIsolation:true});
 await assert.rejects(()=>qualifySupabaseMcp({
  projectRef:"abcdefghij",
  tokenA:"access_token_of_user_A_long_enough",
  tokenB:"access_token_of_user_B_long_enough",fetchFn:bad.fetchFn
 }),/user_B_cannot_read_user_A_record/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {createCiroMcpHandler} from "../supabase/functions/ciro-mcp/mcp-core.mjs";

const alice="11111111-1111-4111-8111-111111111111";
const bob="22222222-2222-4222-8222-222222222222";
function fixture(){
 const rows=[],calls=[];
 const ops={
  async list(userId,limit){
   calls.push({type:"list",userId,limit});
   return rows.filter(x=>x.owner_id===userId).slice(-limit).map(x=>({id:x.id,body:x.body}));
  },
  async create(userId,operationId,body){
   calls.push({type:"create",userId,operationId});
   const old=rows.find(x=>x.owner_id===userId&&x.client_op_id===operationId);
   if(old){if(old.body!==body)throw Error("conflict");return old;}
   const row={id:String(rows.length+1),owner_id:userId,client_op_id:operationId,body};
   rows.push(row);return row;
  }
 };
 const handler=createCiroMcpHandler({authenticate:async token=>{
  if(token==="token_alice_valid_identity_long")return {userId:alice,notes:ops};
  if(token==="token_bob_valid_identity_long")return {userId:bob,notes:ops};
  throw Error("Unauthenticated");
 }});
 async function rpc(token,method,params={},id=1){
  const request=new Request("https://demo.supabase.co/functions/v1/ciro-mcp",{
   method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
   body:JSON.stringify({jsonrpc:"2.0",id,method,params})
  });
  const response=await handler(request);
  return {status:response.status,body:await response.json()};
 }
 return {handler,rpc,calls,rows};
}
test("MCP server refuses missing/invalid bearer and exposes only bounded tools",async()=>{
 const f=fixture();
 const no=await f.rpc("bad","tools/list");
 assert.equal(no.status,401);
 const list=await f.rpc("token_alice_valid_identity_long","tools/list");
 assert.equal(list.status,200);
 assert.deepEqual(list.body.result.tools.map(x=>x.name),["list_notes","create_note"]);
 const raw=await f.rpc("token_alice_valid_identity_long","tools/call",
  {name:"execute_sql",arguments:{sql:"DROP TABLE accounts"}});
 assert.equal(raw.body.error.code,-32601);
 assert.equal(f.calls.length,0);
});
test("MCP authenticated rows are isolated, writes are idempotent and conflict does not overwrite",async()=>{
 const f=fixture(),id="33333333-3333-4333-8333-333333333333";
 const input={name:"create_note",arguments:{body:"Alice only",client_op_id:id}};
 const first=await f.rpc("token_alice_valid_identity_long","tools/call",input);
 assert.equal(first.body.result.content.length,1);
 await f.rpc("token_alice_valid_identity_long","tools/call",input);
 assert.equal(f.rows.length,1);
 const bobRows=await f.rpc("token_bob_valid_identity_long","tools/call",
  {name:"list_notes",arguments:{limit:10}});
 assert.deepEqual(JSON.parse(bobRows.body.result.content[0].text),[]);
 const aliceRows=await f.rpc("token_alice_valid_identity_long","tools/call",
  {name:"list_notes",arguments:{limit:10}});
 assert.equal(JSON.parse(aliceRows.body.result.content[0].text).length,1);
 const mismatch=await f.rpc("token_alice_valid_identity_long","tools/call",
  {name:"create_note",arguments:{body:"different",client_op_id:id}});
 assert.equal(mismatch.body.result.isError,true);
 assert.equal(f.rows.length,1);
});
test("MCP tool argument and mutation scope validation fail closed",async()=>{
 const f=fixture();
 const badArgs=[
  {name:"create_note",arguments:{body:"note",client_op_id:"not-a-uuid"}},
  {name:"create_note",arguments:{body:"note",client_op_id:"33333333-3333-4333-8333-333333333333",owner_id:bob}},
  {name:"list_notes",arguments:{limit:1000}},
  {name:"list_notes",arguments:{sql:"SELECT *"}},
 ];
 for(const params of badArgs){
  const result=await f.rpc("token_alice_valid_identity_long","tools/call",params);
  assert.equal(result.body.error.code,-32602);
 }
 assert.equal(f.calls.length,0);
 const handshake=await f.rpc("token_alice_valid_identity_long","initialize",
  {protocolVersion:"2025-11-25"});
 assert.equal(handshake.body.result.protocolVersion,"2025-11-25");
});

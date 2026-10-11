#!/usr/bin/env node
// Execute ONLY from a trusted terminal with two independently authenticated
// non-admin Supabase test users. Never print or commit OAuth access tokens.
import {randomUUID} from "node:crypto";
import {createSupabaseMcpSession,trustedSupabaseMcpUrl} from "../server/mcp-client.mjs";

const check=(condition,message)=>{if(!condition)throw new Error(message);};
export async function qualifySupabaseMcp({projectRef,tokenA,tokenB,fetchFn=fetch}){
 const url=trustedSupabaseMcpUrl(projectRef);
 check(typeof tokenA==="string"&&tokenA.length>20,"Test user A OAuth token missing");
 check(typeof tokenB==="string"&&tokenB.length>20&&tokenA!==tokenB,
  "Two distinct user OAuth tokens required");
 const results=[];
 let first=null,second=null;
 const assert=(condition,gate)=>{check(condition,gate);results.push(gate);};
 try{
  const response=await fetchFn(url,{
   method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
   headers:{"Content-Type":"application/json","Authorization":"Bearer invalid"},
   body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})
  });
  assert(response.status===401,"invalid_access_token_rejected");
  first=await createSupabaseMcpSession({projectRef,accessToken:tokenA,fetchFn});
  second=await createSupabaseMcpSession({projectRef,accessToken:tokenB,fetchFn});
  const tools=await first.listTools();
  assert(tools.some(x=>x.name==="list_notes")&&tools.some(x=>x.name==="create_note"),
   "user_mcp_discovery_verified");
  assert(!tools.some(x=>["execute_sql","run_shell","deploy_function"].includes(x.name)),
   "admin_tools_not_exposed");
  const key=randomUUID(),body="CIRO_RLS_QUAL_"+key;
  const firstWrite=await first.callTool("create_note",{client_op_id:key,body});
  assert(firstWrite.isError!==true,"user_A_create_allowed");
  const secondWrite=await first.callTool("create_note",{client_op_id:key,body});
  assert(secondWrite.isError!==true&&
    JSON.stringify(firstWrite.content)===JSON.stringify(secondWrite.content),
    "idempotent_create_does_not_duplicate");
  const aList=await first.callTool("list_notes",{limit:25});
  const bList=await second.callTool("list_notes",{limit:25});
  const aRows=JSON.parse(aList.content?.[0]?.text||"[]");
  const bRows=JSON.parse(bList.content?.[0]?.text||"[]");
  assert(aRows.filter(x=>x.body===body).length===1,"user_A_can_read_own_record_once");
  assert(!bRows.some(x=>x.body===body),"user_B_cannot_read_user_A_record");
  const confused=await second.callTool("create_note",{
   body:"cross-user-attempt",client_op_id:randomUUID(),owner_id:aRows[0]?.owner_id||"11111111-1111-4111-8111-111111111111"
  }).then(()=>false,()=>true);
  assert(confused,"cross_user_owner_override_rejected");
  return {schema:"CIRO_V08_EXTERNAL_SUPABASE_RLS_QUALIFICATION_V1",
   status:"PASS",testedAt:new Date().toISOString(),projectRef,
   evidence:results,qualifier:"two_distinct_user_oauth_sessions",commit:process.env.CIRO_COMMIT_SHA||null};
 }finally{
  await first?.close();await second?.close();
 }
}
if(import.meta.url===new URL("file://"+process.argv[1]).href){
 try{
  const result=await qualifySupabaseMcp({
   projectRef:process.env.CIRO_SUPABASE_PROJECT_REF,
   tokenA:process.env.CIRO_SUPABASE_TEST_USER_A_TOKEN,
   tokenB:process.env.CIRO_SUPABASE_TEST_USER_B_TOKEN
  });
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
 }catch(e){
  process.stderr.write("External RLS qualification FAIL: "+String(e.message||e)+"\n");
  process.exitCode=1;
 }
}

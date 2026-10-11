#!/usr/bin/env node
// CIRO V0.8 live, two-identity RLS acceptance. No secret is printed or committed.
// Use two independently authorized user access tokens, or (only on the disposable
// test project) opt into two short-lived Supabase anonymous test accounts.
import {randomUUID} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createSupabaseMcpSession,trustedSupabaseMcpUrl} from "../server/mcp-client.mjs";

const fail=(gate)=>{throw new Error("Acceptance FAILED: "+gate);};
function ensure(ok,gate,evidence){if(!ok)fail(gate);evidence.push(gate);}
const plainUrl=ref=>"https://"+ref+".supabase.co";
async function boundedFetch(fetchFn,url,options={}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),15000);
 try {
  const response=await fetchFn(url,{redirect:"error",...options,signal:controller.signal});
  return response;
 }finally{clearTimeout(timer);}
}
async function jsonResponse(fetchFn,url,options){
 const response=await boundedFetch(fetchFn,url,options);
 const raw=await response.text();
 if(raw.length>100000)fail("remote_response_too_large");
 let parsed;try{parsed=JSON.parse(raw);}catch{parsed={};}
 return {status:response.status,body:parsed};
}
const userHeaders=(apiKey,token)=>({
 "apikey":apiKey,"Authorization":"Bearer "+token,"Accept":"application/json"
});
async function authenticatedUser({ref,apiKey,token,fetchFn}){
 const result=await jsonResponse(fetchFn,plainUrl(ref)+"/auth/v1/user",{
  method:"GET",headers:userHeaders(apiKey,token)
 });
 if(result.status!==200||typeof result.body.id!=="string"||
    !/^[0-9a-f-]{36}$/i.test(result.body.id))fail("test_user_auth_identity");
 return result.body.id;
}
async function disposableAnonymousUser({ref,apiKey,fetchFn}){
 // This relies on the owner enabling anonymous sign-in for the disposable test
 // project. It never changes Supabase Auth settings or uses a service_role key.
 const response=await jsonResponse(fetchFn,plainUrl(ref)+"/auth/v1/signup",{
  method:"POST",headers:{...userHeaders(apiKey,apiKey),"Content-Type":"application/json"},
  body:JSON.stringify({data:{ciro_acceptance:"v0.8"},gotrue_meta_security:{}})
 });
 const token=response.body.access_token;
 if(response.status!==200||typeof token!=="string"||token.length<50||
    response.body.user?.is_anonymous!==true)
  fail("anonymous_test_signin_unavailable_or_not_enabled");
 return token;
}
async function rest({ref,apiKey,token,method="GET",path,body,fetchFn}){
 const response=await jsonResponse(fetchFn,plainUrl(ref)+"/rest/v1/"+path,{
  method,headers:{...userHeaders(apiKey,token),"Content-Type":"application/json",
   "Prefer":"return=representation"},
  ...(body===undefined?{}:{body:JSON.stringify(body)})
 });
 return response;
}
function noteContent(result){
 if(result.isError)fail("mcp_tool_reported_error");
 const text=result.content?.find(x=>x.type==="text")?.text;
 try{return JSON.parse(text||"null");}catch{fail("mcp_tool_result_is_not_json");}
}
export async function qualifyLiveSupabaseTwoUsers({
 projectRef,apiKey,tokenA,tokenB,fetchFn=fetch,createAnonymous=false
}={}){
 // Never accept an arbitrary URL from model output or from the caller.
 trustedSupabaseMcpUrl(projectRef);
 if(typeof apiKey!=="string"||
   !(apiKey.startsWith("sb_publishable_")||apiKey.startsWith("eyJ")))
  fail("project_publishable_key_required");
 if(createAnonymous&&(!tokenA&&!tokenB)){
  tokenA=await disposableAnonymousUser({ref:projectRef,apiKey,fetchFn});
  tokenB=await disposableAnonymousUser({ref:projectRef,apiKey,fetchFn});
 }
 if(typeof tokenA!=="string"||typeof tokenB!=="string"||
   tokenA.length<40||tokenB.length<40||tokenA===tokenB)
  fail("two_distinct_test_bearers_required");
 const evidence=[];
 const userA=await authenticatedUser({ref:projectRef,apiKey,token:tokenA,fetchFn});
 const userB=await authenticatedUser({ref:projectRef,apiKey,token:tokenB,fetchFn});
 ensure(userA!==userB,"distinct_real_auth_user_ids",evidence);
 const denied=await jsonResponse(fetchFn,trustedSupabaseMcpUrl(projectRef),{
  method:"POST",
  headers:{"Content-Type":"application/json","apikey":apiKey,
   "Authorization":"Bearer invalid_invalid_invalid_invalid"},
  body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/list",params:{}})
 });
 ensure([401,403].includes(denied.status),"invalid_mcp_bearer_denied",evidence);
 let a=null,b=null;
 const runId=randomUUID();
 const aBody="CIRO_V08_RLS_"+runId+"_A";
 const bBody="CIRO_V08_RLS_"+runId+"_B";
 const opId=randomUUID(); // deliberately identical across owners
 try{
  a=await createSupabaseMcpSession({projectRef,accessToken:tokenA,fetchFn});
  b=await createSupabaseMcpSession({projectRef,accessToken:tokenB,fetchFn});
  const visible=await a.listTools();
  ensure(visible.some(t=>t.name==="list_notes")&&visible.some(t=>t.name==="create_note")&&
   !visible.some(t=>/admin|sql|shell/i.test(t.name)),
   "restricted_mcp_tool_catalog",evidence);
  const recordA=noteContent(await a.callTool("create_note",{body:aBody,client_op_id:opId}));
  const recordB=noteContent(await b.callTool("create_note",{body:bBody,client_op_id:opId}));
  ensure(recordA.id!==recordB.id,"cross_user_idempotency_namespace_isolated",evidence);
  const repeated=noteContent(await a.callTool("create_note",{body:aBody,client_op_id:opId}));
  ensure(repeated.id===recordA.id,"replayed_write_returns_same_record",evidence);
  const conflicting=await a.callTool("create_note",{body:aBody+"-CHANGED",client_op_id:opId});
  ensure(conflicting.isError===true,"idempotency_conflict_rejected",evidence);
  const listA=noteContent(await a.callTool("list_notes",{limit:25}));
  const listB=noteContent(await b.callTool("list_notes",{limit:25}));
  ensure(Array.isArray(listA)&&listA.some(x=>x.id===recordA.id)&&
    !listA.some(x=>x.id===recordB.id),"mcp_A_cannot_read_B",evidence);
  ensure(Array.isArray(listB)&&listB.some(x=>x.id===recordB.id)&&
    !listB.some(x=>x.id===recordA.id),"mcp_B_cannot_read_A",evidence);
  const otherAsA=await rest({ref:projectRef,apiKey,token:tokenA,fetchFn,
    path:"ciro_plugin_notes?select=id,owner_id&owner_id=eq."+encodeURIComponent(userB)});
  ensure(otherAsA.status===200&&Array.isArray(otherAsA.body)&&
    otherAsA.body.length===0,"database_RLS_A_cannot_query_B",evidence);
  const otherAsB=await rest({ref:projectRef,apiKey,token:tokenB,fetchFn,
    path:"ciro_plugin_notes?select=id,owner_id&owner_id=eq."+encodeURIComponent(userA)});
  ensure(otherAsB.status===200&&Array.isArray(otherAsB.body)&&
    otherAsB.body.length===0,"database_RLS_B_cannot_query_A",evidence);
  const forged=await rest({ref:projectRef,apiKey,token:tokenB,fetchFn,method:"POST",
    path:"ciro_plugin_notes?select=id",body:{
     owner_id:userA,client_op_id:randomUUID(),body:"CIRO_V08_RLS_FORGED_"+runId
    }});
  ensure(![200,201,204].includes(forged.status),"database_RLS_cross_user_insert_rejected",evidence);
  const noAuth=await rest({ref:projectRef,apiKey,token:apiKey,fetchFn,
    path:"ciro_plugin_notes?select=id&limit=1"});
  ensure(noAuth.status!==200||(Array.isArray(noAuth.body)&&noAuth.body.length===0),
   "unauthenticated_data_not_exposed",evidence);
  return {schema:"ciro.v08.supabase.two_auth_users.live.v1",status:"PASS",
   projectRef,testRunId:runId,identityMode:createAnonymous?"anonymous_test_auth_users":"independent_user_tokens",
   evidence,providerResult:"LIVE",testedAt:new Date().toISOString(),
   note:"Disposable acceptance notes remain for operator cleanup; no token or API key is included."};
 }finally{
  await a?.close();await b?.close();
 }
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try {
  const env=process.env;
  const useAnon=env.CIRO_SUPABASE_TEST_CREATE_ANON_USERS==="YES_TEST_PROJECT_ONLY";
  const result=await qualifyLiveSupabaseTwoUsers({
   projectRef:env.CIRO_SUPABASE_PROJECT_REF,
   apiKey:env.CIRO_SUPABASE_PUBLISHABLE_KEY,
   tokenA:env.CIRO_SUPABASE_TEST_USER_A_TOKEN,
   tokenB:env.CIRO_SUPABASE_TEST_USER_B_TOKEN,
   createAnonymous:useAnon
  });
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
 }catch(error){
  // Deliberately omit remote response content; it may contain sensitive data.
  process.stderr.write(String(error.message||"Acceptance failed").slice(0,220)+"\n");
  process.exitCode=1;
 }
}

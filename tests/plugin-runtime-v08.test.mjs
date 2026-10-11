import test from "node:test";
import assert from "node:assert/strict";
import {issueAgentPluginCapability,verifyAgentPluginCapability} from "../server/plugin-agent-capability.mjs";
import {runPluginChat} from "../server/plugin-chat-runtime.mjs";
import {trustedSupabaseMcpUrl,createSupabaseMcpSession} from "../server/mcp-client.mjs";
import {supabaseStartAuthorization,supabaseToken,supabaseIdentity} from "../server/supabase-oauth.mjs";

const config={CIRO_SUPABASE_PROJECT_REF:"abc123xyz9",CIRO_SUPABASE_OAUTH_CLIENT_ID:"ciro-client",
 CIRO_SUPABASE_OAUTH_CLIENT_SECRET:"0123456789abcdef",
 CIRO_SUPABASE_MCP_RLS_VERIFIED:"true"};
test("agent plugin capabilities are bound to owner, active goal, scope and expiry",()=>{
 const secret="a".repeat(48),now=1760000000000;
 const goal={id:"job-one",ownerId:"alice",repo:"owner/allowed",status:"running"};
 const capability=issueAgentPluginCapability({secret,goal,now});
 assert.deepEqual(verifyAgentPluginCapability({secret,goal,token:capability,now:now+1000}),
  {jobId:goal.id,ownerId:"alice",repo:goal.repo});
 assert.throws(()=>verifyAgentPluginCapability({secret,goal:{...goal,ownerId:"bob"},token:capability,now}),/scope|revoked/i);
 assert.throws(()=>verifyAgentPluginCapability({secret,goal:{...goal,status:"paused"},token:capability,now}),/scope|revoked/i);
 assert.throws(()=>verifyAgentPluginCapability({secret,goal,token:capability,now:now+301000}),/expired/i);
 assert.throws(()=>verifyAgentPluginCapability({secret,goal,token:capability+"x",now}),/signature/i);
});
test("CIRO chat tools invoke only installed tool definitions and feed tool results back",async()=>{
 const requests=[],tools=[{type:"function",function:{name:"ciro_github_read_file",
  parameters:{type:"object",properties:{repo:{type:"string"}},required:["repo"]}}}];
 let invocations=0;
 const gateway={listModelTools:()=>tools,executeModelTool:async()=>{
  invocations++;return {result:{content:"bounded code"}};
 }};
 const fetchFn=async (_url,options)=>{
  const input=JSON.parse(options.body);requests.push(input);
  return new Response(JSON.stringify({choices:[{message:requests.length===1?{
   content:null,tool_calls:[{id:"tool01",type:"function",function:{
    name:"ciro_github_read_file",arguments:JSON.stringify({repo:"owner/allowed"})}}]}:
   {content:"文件内容已经分析完成。"}}]}),{status:200});
 };
 const out=await runPluginChat({payload:{model:"ciro",messages:[{role:"user",content:"查看项目"}]},
  principal:"alice",gateway,upstream:{url:"https://ciro.example.test/model",apiKey:"model-secret"},fetchFn});
 assert.equal(out.toolCalls,1);
 assert.equal(invocations,1);
 assert.equal(out.content,"文件内容已经分析完成。");
 assert.equal(requests[1].messages.at(-1).role,"tool");
 assert.equal(requests[1].messages.at(-1).content,'{"content":"bounded code"}');
});
test("CIRO chat never executes model-requested uninstalled tools, and approvals stop the loop",async()=>{
 const allowed=[{type:"function",function:{name:"ciro_github_read_file",parameters:{type:"object"}}}];
 let invoked=0;
 const gateway={listModelTools:()=>allowed,executeModelTool:async()=>{
  invoked++;return {approvalRequired:true,id:"approval-1"};
 }};
 let replies=0;
 const badFetch=async()=>{replies++;return new Response(JSON.stringify({choices:[{message:{
  tool_calls:[{id:"c1",function:{name:"ciro_uninstalled_execute",arguments:"{}"}}]
 }}]}),{status:200});};
 await assert.rejects(()=>runPluginChat({payload:{messages:[]},principal:"alice",gateway,
  upstream:{url:"https://example.test"},fetchFn:badFetch}),/unregistered/);
 assert.equal(invoked,0);
 const approvalFetch=async()=>{replies++;return new Response(JSON.stringify({choices:[{message:{
  tool_calls:[{id:"c2",function:{name:"ciro_github_read_file",arguments:"{}"}}]
 }}]}),{status:200});};
 const result=await runPluginChat({payload:{messages:[]},principal:"alice",gateway,
  upstream:{url:"https://example.test"},fetchFn:approvalFetch});
 assert.equal(result.approvalRequired,true);
 assert.equal(invoked,1);
 assert.equal(replies,2);
});
test("Supabase OAuth client uses PKCE; no admin token or cross-origin URL is accepted",async()=>{
 assert.equal(trustedSupabaseMcpUrl(config.CIRO_SUPABASE_PROJECT_REF),
  "https://abc123xyz9.supabase.co/functions/v1/ciro-mcp");
 assert.throws(()=>trustedSupabaseMcpUrl("https://evil.com"),/project reference/);
 const started=supabaseStartAuthorization(config,"https://ciro.example.com/api/plugins/supabase/callback");
 const address=new URL(started.authorizeUrl);
 assert.equal(address.hostname,"abc123xyz9.supabase.co");
 assert.equal(address.searchParams.get("code_challenge_method"),"S256");
 assert.notEqual(address.searchParams.get("code_challenge"),started.codeVerifier);
 const calls=[];
 const fetchFn=async(url,options={})=>{
  calls.push({url,options});
  return new Response(JSON.stringify(String(url).endsWith("/userinfo")?
   {sub:"user-01",email:"user@example.org"}:
   {access_token:"a".repeat(40),refresh_token:"b".repeat(40),expires_in:3600,token_type:"bearer",scope:"email"}),{status:200});
 };
 const token=await supabaseToken(config,{type:"authorization_code",code:"code",
  redirectUri:"https://ciro.example.com/api/plugins/supabase/callback",codeVerifier:started.codeVerifier},fetchFn);
 assert.equal(token.projectRef,config.CIRO_SUPABASE_PROJECT_REF);
 const id=await supabaseIdentity(config,token.accessToken,fetchFn);
 assert.equal(id.id,"user-01");
 assert.equal(calls.length,2);
 assert.equal(calls[0].options.headers.Authorization.startsWith("Basic "),true);
});
test("MCP HTTP initialize/list/call checks JSON-RPC IDs and negotiates session",async()=>{
 const calls=[];
 const fetchFn=async(url,options)=>{
  calls.push({url,options});
  assert.equal(String(url),"https://abc123xyz9.supabase.co/functions/v1/ciro-mcp");
  const body=JSON.parse(options.body);
  if(body.method==="notifications/initialized")return new Response(null,{status:202});
  const result=body.method==="initialize"?{protocolVersion:"2025-11-25",capabilities:{}}:
   body.method==="tools/list"?{tools:[{name:"list_rows",inputSchema:{type:"object"}}]}:
   {content:[{type:"text",text:"ok"}]};
  return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result}),{
   status:200,headers:{"Content-Type":"application/json","MCP-Session-Id":"session-123"}});
 };
 const mcp=await createSupabaseMcpSession({projectRef:"abc123xyz9",
  accessToken:"per-user-oauth-access-token-12345",fetchFn});
 try{
  const entries=await mcp.listTools();
  assert.equal(entries[0].name,"list_rows");
  const out=await mcp.callTool("list_rows",{limit:10});
  assert.equal(out.content[0].text,"ok");
  assert.equal(calls[2].options.headers["MCP-Session-Id"],"session-123");
  assert.equal(calls[2].options.headers.Authorization,"Bearer per-user-oauth-access-token-12345");
 }finally{await mcp.close();}
});

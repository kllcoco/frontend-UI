import {randomUUID} from "node:crypto";

const PROTOCOL="2025-11-25";
const COMPATIBLE=new Set([PROTOCOL,"2025-06-18","2025-03-26"]);
const fail=(message,statusCode=502)=>Object.assign(new Error(message),{statusCode});

export function trustedSupabaseMcpUrl(projectRef){
  if(typeof projectRef!=="string"||!/^[a-z0-9]{8,32}$/.test(projectRef))
    throw fail("An exact Supabase project reference is required",503);
  // Only an operator-deployed, user-authenticated MCP Edge Function is allowed.
  // Supabase's hosted developer/admin MCP must never be exposed as a customer plugin.
  return "https://"+projectRef+".supabase.co/functions/v1/ciro-mcp";
}
function parsedReply(raw,contentType,id){
  if(raw.length>600000)throw fail("MCP reply exceeds allowed size");
  const messages=[];
  if(contentType.includes("text/event-stream")){
    for(const block of raw.split(/\r?\n\r?\n/)){
      const data=block.split(/\r?\n/).filter(x=>x.startsWith("data:")).map(x=>x.slice(5).trimStart()).join("\n");
      if(!data||data==="[DONE]")continue;
      try{messages.push(JSON.parse(data));}catch{throw fail("Invalid MCP SSE JSON");}
    }
  }else{
    try{messages.push(JSON.parse(raw));}catch{throw fail("Invalid MCP JSON");}
  }
  const matched=messages.find(x=>x?.jsonrpc==="2.0"&&x.id===id);
  if(!matched)throw fail("MCP request ended without matching response");
  if(matched.error)throw fail("MCP server rejected tool request");
  if(!matched.result || typeof matched.result!=="object")throw fail("Invalid MCP result");
  return matched.result;
}
export async function createSupabaseMcpSession({projectRef,accessToken,fetchFn=fetch,signal}){
  const url=trustedSupabaseMcpUrl(projectRef);
  if(typeof accessToken!=="string"||accessToken.length<20)throw fail("Per-user Supabase OAuth token required",403);
  const controller=new AbortController();
  const relay=()=>controller.abort();
  if(signal?.aborted)relay();
  signal?.addEventListener("abort",relay,{once:true});
  const timer=setTimeout(()=>controller.abort(),15000);
  let sessionId=null,version=PROTOCOL;
  async function post(body,{notification=false}={}){
    const response=await fetchFn(url,{method:"POST",redirect:"error",signal:controller.signal,
      headers:{"Authorization":"Bearer "+accessToken,
        "Content-Type":"application/json",
        "Accept":"application/json, text/event-stream",
        "MCP-Protocol-Version":version,
        ...(sessionId?{"MCP-Session-Id":sessionId}:{})},
      body:JSON.stringify(body)});
    if(!response.ok)throw fail("MCP HTTP "+response.status);
    const nextSession=response.headers.get("mcp-session-id");
    if(nextSession){
      if(nextSession.length>200||!/^[\x21-\x7e]+$/.test(nextSession))
        throw fail("Invalid MCP session ID");
      if(sessionId && sessionId!==nextSession)throw fail("Unexpected MCP session change");
      sessionId=nextSession;
    }
    if(notification){
      if(response.status!==202)throw fail("MCP notification not acknowledged");
      return {};
    }
    const raw=await response.text();
    return parsedReply(raw,response.headers.get("content-type")||"application/json",body.id);
  }
  async function request(method,params={}){
    return post({jsonrpc:"2.0",id:randomUUID(),method,params});
  }
  async function close(){
    try {
      if(sessionId)await fetchFn(url,{method:"DELETE",redirect:"error",signal:controller.signal,
        headers:{"Authorization":"Bearer "+accessToken,"MCP-Session-Id":sessionId,
          "MCP-Protocol-Version":version}});
    }catch{/* never convert completed work into success on cleanup failure */}
    clearTimeout(timer);
    signal?.removeEventListener("abort",relay);
  }
  try{
    const hello=await request("initialize",{protocolVersion:PROTOCOL,capabilities:{},
      clientInfo:{name:"CIRO",version:"0.8.0"}});
    if(!COMPATIBLE.has(hello.protocolVersion))throw fail("Unsupported MCP protocol version");
    version=hello.protocolVersion;
    await post({jsonrpc:"2.0",method:"notifications/initialized"},{notification:true});
    return {
      async listTools(){
        let cursor=null,all=[];
        for(let page=0;page<3;page++){
          const answer=await request("tools/list",cursor?{cursor}:{});
          if(!Array.isArray(answer.tools))throw fail("Invalid MCP tool catalog");
          for(const tool of answer.tools){
            if(typeof tool?.name!=="string"||!/^[A-Za-z0-9_.:-]{1,100}$/.test(tool.name))continue;
            if(!tool.inputSchema||tool.inputSchema.type!=="object")continue;
            all.push({name:tool.name,description:String(tool.description||"").slice(0,300),
              inputSchema:tool.inputSchema});
          }
          if(all.length>100)throw fail("MCP tool catalog exceeds limit");
          if(!answer.nextCursor)return all;
          if(typeof answer.nextCursor!=="string"||answer.nextCursor.length>200)throw fail("Invalid cursor");
          cursor=answer.nextCursor;
        }
        throw fail("MCP pagination limit exceeded");
      },
      async callTool(name,args){
        if(typeof name!=="string"||!/^[A-Za-z0-9_.:-]{1,100}$/.test(name))
          throw fail("Invalid MCP tool name",400);
        if(!args||typeof args!=="object"||Array.isArray(args)||JSON.stringify(args).length>32000)
          throw fail("Invalid MCP arguments",400);
        const response=await request("tools/call",{name,arguments:args});
        return {isError:response.isError===true,
          content:Array.isArray(response.content)?response.content.slice(0,25):[]};
      },
      close
    };
  }catch(error){await close();throw error;}
}

// CIRO V0.8 customer-scope MCP reference transport. No admin SQL, no service role,
// no arbitrary tool registration. RLS and identity must be enforced by the caller.
const VERSION="2025-11-25";
const TOOLS=Object.freeze([
 {name:"list_notes",description:"List the authenticated user's CIRO plugin notes (read-only).",
  inputSchema:{type:"object",additionalProperties:false,properties:{
   limit:{type:"integer",minimum:1,maximum:25}
  }}},
 {name:"create_note",description:"Create one user-owned note. Requires a UUID idempotency key; user confirmation is enforced in CIRO.",
  inputSchema:{type:"object",additionalProperties:false,properties:{
   body:{type:"string",minLength:1,maxLength:2000},
   client_op_id:{type:"string",format:"uuid"}
  },required:["body","client_op_id"]}}
]);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
function json(body,status=200){return new Response(JSON.stringify(body),{status,headers});}
function response(id,result){return json({jsonrpc:"2.0",id,result});}
function problem(id,code,message,status=200){return json({jsonrpc:"2.0",id,error:{code,message}},status);}
function validateArgs(args,allowed){
 if(!args||typeof args!=="object"||Array.isArray(args))return false;
 return Object.keys(args).every(x=>allowed.includes(x));
}
export function createCiroMcpHandler({authenticate,notes}){
 if(typeof authenticate!=="function"||!notes)throw new Error("Identity and RLS handlers required");
 return async function handle(req){
  if(req.method!=="POST")
   return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
  if((Number(req.headers.get("content-length"))||0)>32768)
   return json({error:"Request too large"},413);
  let bearer=req.headers.get("authorization")||"";
  if(!/^Bearer [A-Za-z0-9_.~+/-]{20,8192}={0,2}$/.test(bearer))
   return json({error:"User OAuth Bearer token required"},401);
  let request;
  try {
   const raw=await req.text();
   if(raw.length>32768)return json({error:"Request too large"},413);
   request=JSON.parse(raw);
  }catch{return json({error:"Malformed JSON"},400);}
  if(!request||request.jsonrpc!=="2.0"||typeof request.method!=="string"||
     request.method.length>90)
   return problem(request?.id??null,-32600,"Invalid JSON-RPC request",400);
  if(request.method==="notifications/initialized")
   return new Response(null,{status:202,headers:{"Cache-Control":"no-store"}});
  if((typeof request.id!=="string"||request.id.length>100)&&
     (!Number.isSafeInteger(request.id)||request.id<0))
   return problem(null,-32600,"JSON-RPC request id required",400);
  // Authenticate on EVERY request, including discovery and initialize; never
  // trust client-supplied user_id/role or JWT claims without provider validation.
  let scope;
  try {scope=await authenticate(bearer.slice(7));}
  catch{return json({error:"Authentication failed"},401);}
  if(!scope||typeof scope.userId!=="string"||!UUID.test(scope.userId))
   return json({error:"User authentication required"},401);
  const {id,method}=request;
  if(method==="initialize"){
   const version=request.params?.protocolVersion;
   if(!["2025-11-25","2025-06-18","2025-03-26"].includes(version))
    return problem(id,-32602,"Unsupported MCP protocol version");
   return response(id,{protocolVersion:version,capabilities:{tools:{listChanged:false}},
    serverInfo:{name:"ciro-user-mcp",version:"0.8.0"}});
  }
  if(method==="tools/list")
   return response(id,{tools:TOOLS});
  if(method!=="tools/call")return problem(id,-32601,"Method not available");
  const params=request.params??{},name=params.name,args=params.arguments??{};
  if(name==="list_notes"){
   if(!validateArgs(args,["limit"])||("limit" in args &&
     (!Number.isInteger(args.limit)||args.limit<1||args.limit>25)))
    return problem(id,-32602,"Invalid list_notes parameters");
   try {
    const result=await notes.list(scope.userId,args.limit??10);
    return response(id,{content:[{type:"text",text:JSON.stringify(result).slice(0,12000)}]});
   }catch{return response(id,{isError:true,content:[{type:"text",text:"Read failed; no data returned."}]});}
  }
  if(name==="create_note"){
   if(!validateArgs(args,["body","client_op_id"])||typeof args.body!=="string"||
      !args.body.trim()||args.body.length>2000||!UUID.test(args.client_op_id))
    return problem(id,-32602,"Invalid create_note parameters");
   try {
    const result=await notes.create(scope.userId,args.client_op_id,args.body.trim());
    return response(id,{content:[{type:"text",text:JSON.stringify(result).slice(0,4000)}]});
   }catch{return response(id,{isError:true,content:[{type:"text",text:"Write failed or idempotency conflict."}]});}
  }
  return problem(id,-32601,"Unknown MCP tool");
 };
}

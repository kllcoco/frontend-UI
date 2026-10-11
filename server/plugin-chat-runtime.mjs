// The model never receives account credentials. Only server-enumerated, installed tools
// are exposed; every invocation re-enters the authoritative policy gateway.
const MAX_ROUNDS = 4;
const MAX_CALLS = 8;
const MAX_ARGUMENT_BYTES = 32_000;
const MAX_RESULT_CHARS = 12_000;
const raise = (message, statusCode=502) => Object.assign(new Error(message), {statusCode});

export async function runPluginChat({payload, principal, gateway, upstream, signal, fetchFn=fetch}) {
  const tools = gateway.listModelTools(principal);
  if (!tools.length) throw raise("No installed, connected tools are available.", 409);
  const supported = new Set(tools.map(x=>x.function.name));
  const messages = [...payload.messages];
  let calls = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal?.aborted) throw raise("Request cancelled", 499);
    const request = {
      ...payload, messages,
      stream:false, tools, tool_choice:"auto"
    };
    const response = await fetchFn(upstream.url, {
      method:"POST", redirect:"error", signal,
      headers:{"Content-Type":"application/json",
        ...(upstream.apiKey?{"Authorization":"Bearer "+upstream.apiKey}:{})},
      body:JSON.stringify(request)
    });
    if (!response.ok) throw raise("Model tool adapter rejected request (HTTP "+response.status+")");
    const raw = await response.text();
    if (raw.length > 1_200_000) throw raise("Model response too large");
    let data;
    try { data = JSON.parse(raw); }
    catch {throw raise("Model endpoint must return JSON with stream=false for plugin calls");}
    const message = data?.choices?.[0]?.message;
    if (!message || typeof message !== "object") throw raise("Invalid model tool response");
    const next = message.tool_calls;
    if (!Array.isArray(next) || !next.length) {
      if (typeof message.content !== "string") throw raise("Model did not return final text");
      return {content:message.content, toolCalls:calls};
    }
    if (next.length > 4 || calls + next.length > MAX_CALLS) throw raise("Tool call budget exceeded", 429);
    const assistantCalls = [];
    const outputs = [];
    for (const item of next) {
      const id = item?.id;
      const name = item?.function?.name;
      const rawArguments = item?.function?.arguments;
      if (typeof id!=="string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(id) ||
          typeof name!=="string" || !supported.has(name) ||
          typeof rawArguments!=="string" || rawArguments.length>MAX_ARGUMENT_BYTES) {
        throw raise("Model requested an unregistered or invalid tool", 403);
      }
      let args;
      try {args=JSON.parse(rawArguments);}
      catch {throw raise("Model returned invalid tool arguments", 400);}
      if (!args || typeof args!=="object" || Array.isArray(args))
        throw raise("Tool arguments must be a JSON object", 400);
      const expected=gateway.listModelTools(principal).some(x=>x.function.name===name);
      if (!expected) throw raise("Tool was disconnected or revoked", 403);
      const result = await gateway.executeModelTool(principal,name,args,"chat");
      calls++;
      if (result.approvalRequired) {
        // Never resume or execute a write just because the model repeats it.
        return {content:"此操作需要你亲自批准。请进入「插件中心」的待审批区，核对操作后点击批准。审批编号："+result.id,
          approvalRequired:true, approvalId:result.id,toolCalls:calls};
      }
      assistantCalls.push({id,type:"function",function:{name,arguments:rawArguments}});
      const text=JSON.stringify(result.result??result);
      outputs.push({role:"tool",tool_call_id:id,content:text.slice(0,MAX_RESULT_CHARS)});
    }
    messages.push({role:"assistant",content:typeof message.content==="string"?message.content:null,tool_calls:assistantCalls});
    messages.push(...outputs);
  }
  throw raise("Tool conversation exceeded safe round limit; no completion claimed", 429);
}

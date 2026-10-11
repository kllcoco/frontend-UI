// Supabase Edge Function entrypoint for CIRO V0.8 MCP.
// Requires a Supabase project, OAuth 2.1 enabled, and deployed RLS SQL.
// Authentication and each data operation use a freshly scoped low-privilege client.
import {createClient} from "npm:@supabase/supabase-js@2.95.0";
import {createCiroMcpHandler} from "./mcp-core.mjs";

const url=Deno.env.get("SUPABASE_URL")||"";
const published=JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")||"{}");
const publishableKey=Deno.env.get(published.default||"")||
  Deno.env.get("CIRO_SUPABASE_PUBLISHABLE_KEY")||"";
if(!url||!publishableKey||!publishableKey.startsWith("sb_publishable_"))
 throw new Error("CIRO MCP requires a Supabase publishable key; never use a secret or service role key");

const notesTable="ciro_plugin_notes";
const handle=createCiroMcpHandler({
 authenticate:async token=>{
  // No shared client or mutable global user context: scopes are request-local.
  const client=createClient(url,publishableKey,{
   auth:{persistSession:false,autoRefreshToken:false},
   global:{headers:{Authorization:"Bearer "+token}}
  });
  const {data:{user},error}=await client.auth.getUser(token);
  if(error||!user?.id)throw new Error("Invalid provider identity");
  return {userId:user.id,notes:{
   async list(ownerId,limit){
    const {data,error}=await client.from(notesTable)
     .select("id,body,created_at,client_op_id")
     .eq("owner_id",ownerId)
     .order("created_at",{ascending:false}).limit(limit);
    if(error)throw error;
    return data;
   },
   async create(ownerId,operationId,body){
    const {data,error}=await client.from(notesTable)
     .insert({owner_id:ownerId,client_op_id:operationId,body})
     .select("id,body,created_at,client_op_id").single();
    if(!error)return data;
    if(error.code!=="23505")throw error;
    // Duplicate client operation: return only the exact first write, never overwrite.
    const found=await client.from(notesTable)
     .select("id,body,created_at,client_op_id")
     .eq("owner_id",ownerId).eq("client_op_id",operationId).single();
    if(found.error||!found.data||found.data.body!==body)
     throw new Error("Conflicting idempotency key");
    return found.data;
   }
  }};
 }
});
Deno.serve(handle);

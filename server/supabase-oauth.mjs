import {createHash,randomBytes} from "node:crypto";
import {trustedSupabaseMcpUrl} from "./mcp-client.mjs";

const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
export function supabaseOAuthConfig(env=process.env){
 const ref=env.CIRO_SUPABASE_PROJECT_REF||"";
 const clientId=env.CIRO_SUPABASE_OAUTH_CLIENT_ID||"";
 const clientSecret=env.CIRO_SUPABASE_OAUTH_CLIENT_SECRET||"";
 const ready=/^[a-z0-9]{8,32}$/.test(ref)&&clientId.length>=6&&clientSecret.length>=12&&
  env.CIRO_SUPABASE_MCP_RLS_VERIFIED==="true";
 return {ready,projectRef:ref,clientId,clientSecret,
  origin:ready?"https://"+ref+".supabase.co":null,
  resource:ready?trustedSupabaseMcpUrl(ref):null};
}
export function supabaseStartAuthorization(env,redirectUri){
 const config=supabaseOAuthConfig(env);
 if(!config.ready)throw fail("Per-user Supabase MCP not configured or RLS verification missing",503);
 if(typeof redirectUri!=="string"||!redirectUri.startsWith("https://"))throw fail("HTTPS redirect required",503);
 const state=randomBytes(32).toString("base64url");
 const codeVerifier=randomBytes(48).toString("base64url");
 const challenge=createHash("sha256").update(codeVerifier).digest("base64url");
 const url=new URL(config.origin+"/auth/v1/oauth/authorize");
 url.searchParams.set("response_type","code");
 url.searchParams.set("client_id",config.clientId);
 url.searchParams.set("redirect_uri",redirectUri);
 url.searchParams.set("scope","email");
 url.searchParams.set("state",state);
 url.searchParams.set("code_challenge",challenge);
 url.searchParams.set("code_challenge_method","S256");
 return {authorizeUrl:url.href,state,codeVerifier,projectRef:config.projectRef};
}
export async function supabaseToken(env,grant,fetchFn=fetch){
 const config=supabaseOAuthConfig(env);
 if(!config.ready)throw fail("Supabase user OAuth configuration missing",503);
 const body=new URLSearchParams({grant_type:grant.type});
 if(grant.type==="authorization_code"){
  body.set("code",grant.code);body.set("redirect_uri",grant.redirectUri);
  body.set("code_verifier",grant.codeVerifier);
 }else if(grant.type==="refresh_token"){
  body.set("refresh_token",grant.refreshToken);
 }else throw fail("Unsupported OAuth grant");
 const credentials=Buffer.from(config.clientId+":"+config.clientSecret).toString("base64");
 const response=await fetchFn(config.origin+"/auth/v1/oauth/token",{
  method:"POST",redirect:"error",
  headers:{"Accept":"application/json","Content-Type":"application/x-www-form-urlencoded",
   "Authorization":"Basic "+credentials},
  body:body.toString()});
 if(!response.ok)throw fail("Supabase OAuth token exchange failed",502);
 const data=await response.json();
 if(typeof data.access_token!=="string"||data.access_token.length<20||
    data.token_type?.toLowerCase()!=="bearer"||
    !Number.isFinite(data.expires_in)||data.expires_in<=0||data.expires_in>86400)
   throw fail("Invalid Supabase OAuth token reply",502);
 return {accessToken:data.access_token,
  refreshToken:typeof data.refresh_token==="string"&&data.refresh_token?data.refresh_token:null,
  expiresAt:Date.now()+data.expires_in*1000,projectRef:config.projectRef,
  scopes:typeof data.scope==="string"?data.scope.split(/\s+/):[]};
}
export async function supabaseIdentity(env,accessToken,fetchFn=fetch){
 const config=supabaseOAuthConfig(env);
 if(!config.ready)throw fail("Supabase OAuth not configured",503);
 const response=await fetchFn(config.origin+"/auth/v1/oauth/userinfo",{
  redirect:"error",headers:{"Authorization":"Bearer "+accessToken,"Accept":"application/json"}});
 if(!response.ok)throw fail("Supabase OAuth identity verification failed",502);
 const data=await response.json();
 if(typeof data?.sub!=="string"||!data.sub||data.sub.length>128)
  throw fail("Supabase user identity missing",502);
 return {id:data.sub,email:typeof data.email==="string"?data.email.slice(0,200):undefined};
}

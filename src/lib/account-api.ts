export type SessionSnapshot={
  enabled:boolean;authenticated:boolean;user:{
    id:string;email:string;displayName:string;memoryEnabled:boolean;createdAt:string
  }|null;csrf:string|null;mode:string|null;bootstrapAvailable:boolean;
};
export type AccountTab="account"|"subscription"|"api-keys"|"spending"|"notifications"|"memory"|"sync";
/** Parses an API response. A page served instead of JSON (offline app, wrong server, proxy page) is an error,
    never an empty object that later crashes the screen reading missing fields. */
export async function readApiJson<T>(response:Response,fallback:string):Promise<T>{
  const isJson=/json/i.test(response.headers.get("content-type")||"");
  const data:unknown=isJson?await response.json().catch(()=>null):null;
  if(!response.ok){
    const msg=data&&typeof data==="object"&&"error" in data?String((data as {error:unknown}).error):fallback+" (HTTP "+response.status+")";
    throw new Error(msg);
  }
  if(!isJson||data===null||typeof data!=="object")throw new Error("未连接到 Ciro 服务：服务器没有返回数据");
  return data as T;
}
let cachedSession:SessionSnapshot|null=null;
let pending:Promise<SessionSnapshot>|null=null;
export function invalidateAccountSession(){cachedSession=null;pending=null;}
export async function getAccountSession(force=false):Promise<SessionSnapshot>{
  if(!force&&cachedSession)return cachedSession;
  if(!force&&pending)return pending;
  pending=fetch("/api/account/session",{cache:"no-store",credentials:"same-origin"}).then(async result=>{
    const data=await readApiJson<SessionSnapshot>(result,"Unable to contact account service");
    cachedSession=data;
    return data;
  }).finally(()=>{pending=null;});
  return pending;
}
export async function accountFetch(path:string,init:RequestInit={}):Promise<Response>{
  const method=(init.method||"GET").toUpperCase();
  const headers=new Headers(init.headers);
  if(["POST","PUT","DELETE","PATCH"].includes(method)&&
    !["/api/account/login","/api/account/bootstrap"].includes(path)){
    const status=await getAccountSession();
    if(status.enabled){
      if(!status.authenticated)throw new Error("请先登录 Ciro 账户");
      if(!status.csrf)throw new Error("此操作必须使用安全的浏览器登录会话");
      headers.set("X-Ciro-Csrf",status.csrf);
    }
  }
  return fetch(path,{...init,headers,credentials:"same-origin",cache:"no-store"});
}
export async function accountApi<T>(path:string,method="GET",body?:unknown):Promise<T>{
  const response=await accountFetch("/api/account"+path,{
    method,
    ...(body===undefined?{}:{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})
  });
  return readApiJson<T>(response,"Account request failed");
}
export async function refreshAuthAfterLogin():Promise<SessionSnapshot>{
  invalidateAccountSession();
  return getAccountSession(true);
}
export function openVerifiedCheckout(url:string):void{
  const candidate=new URL(url);
  if(candidate.protocol!=="https:"||!["checkout.stripe.com","billing.stripe.com"].includes(candidate.hostname))
    throw new Error("不可信的付款地址");
  window.location.assign(candidate.href);
}

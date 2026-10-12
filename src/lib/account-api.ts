export type SessionSnapshot={
  enabled:boolean;authenticated:boolean;user:{
    id:string;email:string;displayName:string;desktopLocal?:boolean;memoryEnabled:boolean;createdAt:string
  }|null;csrf:string|null;mode:string|null;bootstrapAvailable:boolean;
};
export type AccountTab="account"|"subscription"|"api-keys"|"spending"|"notifications"|"memory"|"sync";
let cachedSession:SessionSnapshot|null=null;
let pending:Promise<SessionSnapshot>|null=null;
export function invalidateAccountSession(){cachedSession=null;pending=null;}
export async function getAccountSession(force=false):Promise<SessionSnapshot>{
  if(!force&&cachedSession)return cachedSession;
  if(!force&&pending)return pending;
  pending=fetch("/api/account/session",{cache:"no-store",credentials:"same-origin"}).then(async result=>{
    if(!result.ok)throw new Error("Unable to contact account service");
    const data=await result.json() as SessionSnapshot;
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
  const result:unknown=await response.json().catch(()=>({}));
  if(!response.ok){
    const msg=result&&typeof result==="object"&&"error" in result?String(result.error):"HTTP "+response.status;
    throw new Error(msg);
  }
  return result as T;
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

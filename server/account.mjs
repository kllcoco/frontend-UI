import { createSmsCodes, maskPhone, normalizePhone } from "./sms.mjs";
import { createCwuLedger, cwuEnabled, cwuPacks } from "./cwu.mjs";
import {createSyncStore,SYNC_KINDS,SYNC_LIMITS} from "./sync-store.mjs";
import express from "express";
import {
  randomBytes,randomUUID,createHash,createHmac,scrypt as scryptCb,
  timingSafeEqual,createCipheriv,createDecipheriv
} from "node:crypto";
import {promisify} from "node:util";
import {createAccountStore} from "./account-store.mjs";

const scrypt=promisify(scryptCb);
const SESSION_COOKIE="ciro_sid";
const SCOPES=new Set(["chat:invoke","sync:read","sync:write"]);
const COOKIE_MAX_AGE=30*86400000;
const MAX_MEMORIES=150,MAX_NOTIFICATIONS=350;
const attempts=new Map();
const hash=value=>createHash("sha256").update(value).digest("hex");
const token=()=>randomBytes(32).toString("base64url");
const bad=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
function equal(a,b){
  const aa=Buffer.from(a||""),bb=Buffer.from(b||"");
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function checkSecret(value,name,min=24){
  if(typeof value!=="string"||Buffer.byteLength(value,"utf8")<min)throw bad(name+" not configured",503);
  return value;
}
function encryptionKey(env){
  const raw=env.CIRO_ACCOUNT_DATA_KEY;
  const k=typeof raw==="string"?Buffer.from(raw,"base64"):Buffer.alloc(0);
  if(k.length!==32 || raw!==k.toString("base64"))throw bad("CIRO_ACCOUNT_DATA_KEY must be a stable 32-byte base64 key",503);
  return k;
}
export function sealJSON(value,env,aad){
  const key=encryptionKey(env),iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key,iv);cipher.setAAD(Buffer.from(aad));
  const bytes=Buffer.from(JSON.stringify(value),"utf8");
  const data=Buffer.concat([cipher.update(bytes),cipher.final()]);
  return {iv:iv.toString("base64"),data:data.toString("base64"),tag:cipher.getAuthTag().toString("base64")};
}
export function unsealJSON(item,env,aad){
  if(!item)return null;
  const decipher=createDecipheriv("aes-256-gcm",encryptionKey(env),Buffer.from(item.iv,"base64"));
  decipher.setAAD(Buffer.from(aad));decipher.setAuthTag(Buffer.from(item.tag,"base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(item.data,"base64")),decipher.final()]).toString("utf8"));
}
async function passwordHash(password,salt){
  return (await scrypt(password,Buffer.from(salt,"base64"),64,{N:16384,r:8,p:1})).toString("hex");
}
async function passwordMatches(password,user){
  const got=await passwordHash(password,user.salt);
  return equal(got,user.passwordHash);
}
function parseCookies(req){
  const cookies={};
  for(const part of (req.headers.cookie||"").split(";")){
    const j=part.indexOf("=");if(j<0)continue;
    const key=part.slice(0,j).trim(),value=part.slice(j+1).trim();
    if(key===SESSION_COOKIE)cookies[key]=value;
  }
  return cookies;
}
function publicOwner(owner){
  return owner?{id:owner.id,email:owner.email||"",phone:maskPhone(owner.phone||""),displayName:owner.displayName,role:owner.role==="owner"?"owner":"user",
    createdAt:owner.createdAt,memoryEnabled:owner.memoryEnabled===true,hasPassword:owner.noPassword!==true}:null;
}
/** Who may create an account: "closed" (only the owner, via bootstrap), "invite" (with a code) or "open". */
export function registrationMode(env){
  const v=(env.CIRO_REGISTRATION||"closed").trim().toLowerCase();
  return ["open","invite"].includes(v)?v:"closed";
}
function publicSubscription(store,env){
  const data=store.get().subscription;
  const configured=Boolean(env.CIRO_STRIPE_SECRET_KEY&&env.CIRO_STRIPE_PRICE_ID&&
    env.CIRO_STRIPE_WEBHOOK_SECRET&&/^https:\/\//.test(env.CIRO_PUBLIC_ORIGIN||""));
  return {configured,provider:"stripe",status:configured?data.status:"not_connected",
    cancelAtPeriodEnd:configured&&data.cancelAtPeriodEnd===true,
    currentPeriodEnd:configured?data.currentPeriodEnd:null,
    lastVerifiedAt:configured?data.updatedAt:null,
    paymentsAvailable:configured};
}
function ipLimit(req){
  const key=String(req.socket.remoteAddress||"unknown");
  const now=Date.now(),value=attempts.get(key)||{count:0,until:now+900000};
  if(value.until<now){value.count=0;value.until=now+900000;}
  if(value.count>=10)throw bad("Too many login attempts; try again later",429);
  value.count++;attempts.set(key,value);
  if(attempts.size>1000)attempts.clear();
  return ()=>attempts.delete(key);
}
function validatePassword(text){
  if(typeof text!=="string"||text.length<12||text.length>128)throw bad("Password must contain 12 to 128 characters");
  return text;
}
function validateEmail(text){
  if(typeof text!=="string"||text.length>180||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text))throw bad("Invalid email");
  return text.toLowerCase();
}
function validateName(text){
  if(typeof text!=="string"||text.trim().length<1||text.length>80)throw bad("Invalid display name");
  return text.trim();
}
function confirmOrigin(req,env){
  if(!["POST","PUT","PATCH","DELETE"].includes(req.method))return;
  const origin=req.get("origin");
  if(!origin)return; // non-browser clients still need CSRF or API token for mutations
  const local=["http://localhost:5173","http://127.0.0.1:5173",
    "http://localhost:8787","http://127.0.0.1:8787"];
  const publicOrigin=env.CIRO_PUBLIC_ORIGIN;
  let sameOrigin=false;
  try {
    const parsed=new URL(origin),host=req.get("host")||"";
    const localHost=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
    sameOrigin=parsed.host===host && (parsed.protocol==="https:" ||
      (parsed.protocol==="http:"&&localHost));
  }catch{/* malformed origin is denied */}
  if(!sameOrigin && ![...local,publicOrigin].filter(Boolean).includes(origin))
    throw bad("Origin forbidden",403);
}
function sessionCookie(req,env,raw){
  const site=env.CIRO_PUBLIC_ORIGIN||"";
  const secure=site.startsWith("https://");
  const cookie=SESSION_COOKIE+"="+raw+"; HttpOnly; Path=/; SameSite=Lax; Max-Age="+Math.floor(COOKIE_MAX_AGE/1000)+(secure?"; Secure":"");
  return cookie;
}
async function stripeCall(env,path,params,fetchFn){
  const key=checkSecret(env.CIRO_STRIPE_SECRET_KEY,"Stripe secret");
  const controller=new AbortController();const limit=setTimeout(()=>controller.abort(),12000);
  try{
    const result=await fetchFn("https://api.stripe.com/v1/"+path,{
      method:"POST",signal:controller.signal,
      headers:{"Authorization":"Bearer "+key,"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams(params).toString()
    });
    const body=await result.json().catch(()=>({}));
    if(!result.ok)throw bad("Stripe rejected request: "+(body?.error?.type||result.status),502);
    if(typeof body.url!=="string"||!/^https:\/\/(checkout\.stripe\.com|billing\.stripe\.com)\//.test(body.url))
      throw bad("Stripe did not return a valid hosted URL",502);
    return body;
  }finally{clearTimeout(limit);}
}
export function verifyStripeEvent(req,env,now=Date.now()){
  const secret=checkSecret(env.CIRO_STRIPE_WEBHOOK_SECRET,"Stripe webhook secret");
  const header=req.get("stripe-signature")||"";
  const time=header.match(/(?:^|,)t=(\d{10})(?:,|$)/)?.[1];
  const signatures=[...header.matchAll(/(?:^|,)v1=([a-f0-9]{64})(?=,|$)/g)].map(x=>x[1]);
  if(!time||!signatures.length||!Buffer.isBuffer(req.rawBody))throw bad("Stripe signature required",401);
  if(Math.abs(now-Number(time)*1000)>300000)throw bad("Stale Stripe signature",401);
  const actual=createHmac("sha256",secret).update(time+".").update(req.rawBody).digest("hex");
  if(!signatures.some(x=>equal(x,actual)))throw bad("Invalid Stripe signature",401);
  const event=JSON.parse(req.rawBody.toString("utf8"));
  if(typeof event.id!=="string"||typeof event.type!=="string")throw bad("Invalid Stripe event");
  return event;
}
function validateSnapshot(value){
  if(!value||typeof value!=="object"||Array.isArray(value)||!Array.isArray(value.conversations))
    throw bad("Invalid synchronization snapshot");
  const raw=JSON.stringify(value);
  if(Buffer.byteLength(raw)>650000)throw bad("Sync data exceeds 650 KB");
  if(value.conversations.length>100)throw bad("Too many conversations");
  const mapMessage=m=>{
    if(!m||typeof m.id!=="string"||m.id.length>100||
      !["user","assistant"].includes(m.role)||typeof m.content!=="string"||
      m.content.length>30000||!Number.isFinite(m.createdAt))throw bad("Invalid chat message");
    return {id:m.id,role:m.role,content:m.content,createdAt:m.createdAt,...(m.preview===true?{preview:true}:{})};
  };
  const conversations=value.conversations.map(c=>{
    if(!c||typeof c!=="object"||typeof c.id!=="string"||c.id.length>100||
      typeof c.title!=="string"||c.title.length>180||
      !Number.isFinite(c.createdAt)||!Number.isFinite(c.updatedAt)||
      !Array.isArray(c.messages)||c.messages.length>240)throw bad("Invalid conversation");
    if(c.folder!==undefined&&(typeof c.folder!=="string"||c.folder.length>60))throw bad("Invalid folder");
    if(c.parentId!==undefined&&(typeof c.parentId!=="string"||c.parentId.length>100))throw bad("Invalid branch parent");
    if(c.checkpoints!==undefined&&(!Array.isArray(c.checkpoints)||c.checkpoints.length>10))
      throw bad("Invalid checkpoints");
    const checkpoints=(c.checkpoints||[]).map(x=>{
      if(!x||typeof x.id!=="string"||x.id.length>100||
        typeof x.label!=="string"||x.label.length>100||
        !Number.isFinite(x.createdAt)||!Array.isArray(x.messages)||x.messages.length>240)
        throw bad("Invalid checkpoint");
      return {id:x.id,label:x.label,createdAt:x.createdAt,messages:x.messages.map(mapMessage)};
    });
    return {id:c.id,title:c.title,createdAt:c.createdAt,updatedAt:c.updatedAt,
      messages:c.messages.map(mapMessage),
      ...(c.folder!==undefined?{folder:c.folder}:{}),
      ...(c.parentId!==undefined?{parentId:c.parentId}:{}),
      ...(checkpoints.length?{checkpoints}:{})};
  });
  const p=value.preferences||{};
  if(!p||typeof p!=="object"||Array.isArray(p))throw bad("Invalid preferences");
  const prefRaw=JSON.stringify(p);
  if(prefRaw.length>12000)throw bad("Preferences too large");
  return {conversations,activeId:typeof value.activeId==="string"&&value.activeId.length<100?value.activeId:null,
    preferences:JSON.parse(prefRaw)};
}
export function createAccountService({env=process.env,dir,fetchFn=fetch}={}){
  const enabled=env.CIRO_ACCOUNTS_ENABLED==="true";
  const registration=registrationMode(env);
  const dataDir=dir||env.CIRO_WORKSPACE_DATA_DIR||".ciro-runtime";
  const store=createAccountStore(dataDir);
  const cwu=createCwuLedger(store,env);
  const sms=createSmsCodes(env,fetchFn);
  const smsSends=new Map(); // per network address, against code spamming
  let syncDb=null;
  const syncStore=()=>syncDb||(syncDb=createSyncStore(dataDir,store.owner()?.id||null));
  const router=express.Router();
  const userOf=p=>store.user(p.id);
  const live=u=>u&&!u.disabledAt;
  function issueSession(res,user){
    const raw=token(),csrf=token(),id=randomUUID(),expiresAt=Date.now()+COOKIE_MAX_AGE;
    store.change("account.session.created",s=>{
      const now=Date.now();
      const others=s.sessions.filter(x=>x.expiresAt>now&&x.userId!==user.id);
      const mine=s.sessions.filter(x=>x.expiresAt>now&&x.userId===user.id).slice(-30);
      s.sessions=[...others,...mine,{id,userId:user.id,hash:hash(raw),csrf,expiresAt,createdAt:new Date().toISOString()}];
      const u=s.users.find(x=>x.id===user.id);if(u)u.lastSeenAt=new Date().toISOString();
    });
    res.setHeader("Set-Cookie",sessionCookie(null,env,raw));
    return {csrf,id};
  }
  function principal(req){
    if(!enabled)return {mode:"local",id:"local",role:"owner",scopes:["*"]};
    const bearer=req.get("authorization")||"";
    if(bearer.startsWith("Bearer ciro_sk_")){
      const pepper=env.CIRO_API_KEY_PEPPER;
      if(typeof pepper!=="string"||pepper.length<24)return null;
      const presented=bearer.slice(7);
      const digest=createHmac("sha256",pepper).update(presented).digest("hex");
      const key=store.get().apiKeys.find(x=>x.hash===digest&&!x.revokedAt&&
        (!x.expiresAt||x.expiresAt>Date.now()));
      const user=key&&store.user(key.userId);
      return live(user)?{id:user.id,role:user.role,mode:"api-key",scopes:key.scopes,keyId:key.id}:null;
    }
    const raw=parseCookies(req)[SESSION_COOKIE];
    if(!raw)return null;
    const session=store.get().sessions.find(x=>x.hash===hash(raw)&&x.expiresAt>Date.now());
    const user=session&&store.user(session.userId);
    return live(user)?{id:user.id,role:user.role,mode:"session",sessionId:session.id,csrf:session.csrf,scopes:["*"]}:null;
  }
  // Server-wide tools (workbench, studio, plugins) act on shared state, so only the owner uses them.
  const OWNER_ONLY=/^\/(workbench|studio|plugins)(\/|$)/;
  function guard(req,res,next){
    try{
      if(!enabled){req.principal={mode:"local",id:"local",role:"owner",scopes:["*"]};return next();}
      if(req.path==="/status")return next();
      // Work mode: paired computers authenticate with their own device token inside the remote router.
      if(req.path==="/remote/pair"||req.path.startsWith("/remote/device/"))return next();
      // Only these machine-to-machine mutations bypass cookie/session auth.
      // Every target route independently validates the exact raw-body HMAC
      // and timestamp. All other Workbench routes still require user auth.
      if(req.method==="POST" && (
        req.path==="/workbench/commercial/billing/ingest" ||
        req.path==="/studio/compute/ingest" ||
        req.path==="/plugins/agent/invoke" ||
        req.path==="/workbench/commercial/billing/reservations" ||
        /^\/workbench\/commercial\/billing\/reservations\/[a-zA-Z0-9_:-]{8,120}\/release$/.test(req.path)
      ))return next();
      const p=principal(req);
      if(!p)return res.status(401).json({error:"Sign in to Ciro first"});
      confirmOrigin(req,env);
      if(p.mode==="api-key"){
        const scope=req.path==="/chat"?"chat:invoke":
          req.path.startsWith("/account/sync")?"sync:"+(req.method==="GET"?"read":"write"):null;
        if(!scope||!p.scopes.includes(scope))return res.status(403).json({error:"API key scope denied"});
      } else if(["POST","PUT","PATCH","DELETE"].includes(req.method)){
        if(!equal(req.get("x-ciro-csrf"),p.csrf))return res.status(403).json({error:"CSRF token required"});
      }
      if(p.role!=="owner"&&OWNER_ONLY.test(req.path))return res.status(403).json({error:"Only the server owner can use this"});
      req.principal=p;next();
    }catch(e){res.status(e.statusCode||400).json({error:e.message});}
  }
  const wrapped=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>{
    res.status(e.statusCode||400).json({error:e.message||"Request rejected"});
  });
  const protectedSession=fn=>(req,res)=>wrapped(async(req,res)=>{
    if(!enabled)throw bad("Accounts are disabled",503);
    const p=principal(req);if(!p)throw bad("Please sign in",401);
    if(p.mode!=="session")throw bad("A browser session is required",403);
    confirmOrigin(req,env);
    if(["POST","PUT","PATCH","DELETE"].includes(req.method)&&!equal(req.get("x-ciro-csrf"),p.csrf))
      throw bad("CSRF token required",403);
    return fn(req,res,p,userOf(p));
  })(req,res);
  const ownerSession=fn=>protectedSession((req,res,p,u)=>{
    if(u.role!=="owner")throw bad("Only the server owner can do this",403);
    return fn(req,res,p,u);
  });
  const guardedRead=fn=>(req,res)=>wrapped(async(req,res)=>{
    if(!enabled)throw bad("Accounts are disabled",503);
    const p=principal(req);if(!p)throw bad("Please sign in",401);
    confirmOrigin(req,env);
    const isWrite=["POST","PUT","DELETE","PATCH"].includes(req.method);
    if(p.mode==="api-key"&&!p.scopes.includes("sync:"+(isWrite?"write":"read")))
      throw bad("API key scope denied",403);
    if(p.mode==="session"&&isWrite&&!equal(req.get("x-ciro-csrf"),p.csrf))
      throw bad("CSRF token required",403);
    return fn(req,res,p,userOf(p));
  })(req,res);
  router.use((req,res,next)=>{
    res.set("Cache-Control","no-store");next();
  });
  router.get("/session",(req,res)=>{
    const p=principal(req);
    res.json({enabled,authenticated:enabled&&Boolean(p),user:enabled&&p?publicOwner(userOf(p)):null,
      mode:p?.mode||null,csrf:p?.mode==="session"?p.csrf:null,
      registration:enabled&&store.owner()?registration:"closed",
      phoneSignIn:enabled&&sms.enabled(),
      bootstrapAvailable:enabled&&!store.owner()&&typeof env.CIRO_BOOTSTRAP_TOKEN==="string"&&env.CIRO_BOOTSTRAP_TOKEN.length>=24});
  });
  /** An account made with a phone number; a password is optional (it can always sign in with an SMS code). */
  async function phoneUser(phone,body){
    const displayName=body?.displayName?validateName(body.displayName):"Ciro 用户 "+phone.slice(-4);
    const salt=randomBytes(16).toString("base64");
    const pw=typeof body?.password==="string"&&body.password?validatePassword(body.password):randomBytes(24).toString("base64");
    // Signed up with only a code: no password they know yet (they can set one with an SMS code, see /password).
    return {id:randomUUID(),email:"",phone,displayName,role:"user",passwordHash:await passwordHash(pw,salt),salt,
      ...(typeof body?.password==="string"&&body.password?{}:{noPassword:true}),
      memoryEnabled:false,createdAt:new Date().toISOString(),disabledAt:null};
  }
  async function newUser(body,role){
    const email=validateEmail(body?.email),displayName=validateName(body?.displayName);
    const pw=validatePassword(body?.password),salt=randomBytes(16).toString("base64");
    return {id:randomUUID(),email,displayName,role,passwordHash:await passwordHash(pw,salt),salt,
      memoryEnabled:false,createdAt:new Date().toISOString(),disabledAt:null};
  }
  router.post("/bootstrap",wrapped(async(req,res)=>{
    if(!enabled)throw bad("Enable CIRO_ACCOUNTS_ENABLED first",503);
    confirmOrigin(req,env);
    if(store.owner())throw bad("Account already initialized",409);
    const secret=checkSecret(env.CIRO_BOOTSTRAP_TOKEN,"Bootstrap token");
    if(!equal(req.body?.bootstrapToken,secret))throw bad("Bootstrap authorization failed",401);
    const user=await newUser(req.body,"owner");
    store.change("account.bootstrap",s=>{
      if(s.users.some(x=>x.role==="owner"))throw bad("Account already initialized",409);
      if(s.users.some(x=>x.email===user.email))throw bad("This email is already registered",409);
      s.users.push(user);
    });
    const session=issueSession(res,user);
    res.status(201).json({authenticated:true,user:publicOwner(user),csrf:session.csrf});
  }));
  // Phone sign-up / sign-in: a 6-digit code by SMS (see server/sms.mjs).
  router.post("/sms/send",wrapped(async(req,res)=>{
    if(!enabled||!sms.enabled())throw bad("Phone sign-in is not available",503);
    confirmOrigin(req,env);
    const ip=String(req.socket.remoteAddress||"unknown"),now=Date.now(),hits=(smsSends.get(ip)||[]).filter(x=>now-x<3600000);
    if(hits.length>=20)throw bad("Too many codes requested; try again later",429);
    smsSends.set(ip,[...hits,now]);if(smsSends.size>5000)smsSends.clear();
    const phone=normalizePhone(req.body?.phone),purpose=req.body?.purpose==="login"?"login":"register";
    if(!phone)throw bad("请输入正确的手机号",400);
    const known=store.get().users.find(x=>x.phone===phone);
    if(purpose==="register"){
      if(!store.owner()||registration==="closed")throw bad("Registration is closed on this server",403);
      if(known)throw bad("这个手机号已经注册，请直接登录",409);
    } else if(!known)throw bad("这个手机号还没有注册",404);
    await sms.send(phone,purpose);
    res.json({sent:true});
  }));
  router.post("/register",wrapped(async(req,res)=>{
    if(!enabled)throw bad("Accounts are disabled",503);
    confirmOrigin(req,env);
    if(!store.owner())throw bad("This server is not set up yet",409);
    if(registration==="closed")throw bad("Registration is closed on this server",403);
    const clear=ipLimit(req);
    const code=typeof req.body?.inviteCode==="string"?req.body.inviteCode.trim().toUpperCase():"";
    const invite=registration==="invite"?store.get().invites.find(x=>x.code===code&&!x.usedAt&&x.expiresAt>Date.now()):null;
    if(registration==="invite"&&!invite)throw bad("Invalid or used invite code",403);
    const phone=req.body?.phone!==undefined?normalizePhone(req.body.phone):"";
    if(req.body?.phone!==undefined&&!phone)throw bad("请输入正确的手机号",400);
    // Checked before the code is used up, so a refused sign-up does not burn it.
    if(store.get().users.length>=Number(env.CIRO_MAX_USERS||100000))throw bad("This server is not accepting new accounts",403);
    if(phone&&!sms.check(phone,"register",req.body?.smsCode))throw bad("验证码不正确或已过期",401);
    const user=phone?await phoneUser(phone,req.body):await newUser(req.body,"user");
    store.change("account.registered",s=>{
      if(user.email&&s.users.some(x=>x.email===user.email))throw bad("This email is already registered",409);
      if(user.phone&&s.users.some(x=>x.phone===user.phone))throw bad("这个手机号已经注册，请直接登录",409);
      s.users.push(user);
      if(invite){const i=s.invites.find(x=>x.code===invite.code);i.usedAt=new Date().toISOString();i.usedBy=user.id;}
    });
    clear();
    const bonus=Number(env.CIRO_CWU_SIGNUP_BONUS||0);
    if(cwuEnabled(env)&&Number.isFinite(bonus)&&bonus>0)cwu.credit(user.id,Math.min(bonus,1e9),"signup","signup:"+user.id);
    const session=issueSession(res,user);
    res.status(201).json({authenticated:true,user:publicOwner(user),csrf:session.csrf});
  }));
  router.post("/login",wrapped(async(req,res)=>{
    if(!enabled)throw bad("Accounts are disabled",503);
    confirmOrigin(req,env);const clear=ipLimit(req);
    let user;
    if(req.body?.phone!==undefined){
      // Phone: an SMS code, or the password if one was set.
      const phone=normalizePhone(req.body.phone);
      user=phone?store.get().users.find(x=>x.phone===phone):null;
      const ok=user&&(req.body?.smsCode?sms.check(phone,"login",req.body.smsCode)
        :typeof req.body?.password==="string"&&await passwordMatches(req.body.password,user));
      if(!ok)throw bad("Invalid credentials",401);
    } else {
      const email=typeof req.body?.email==="string"?req.body.email.toLowerCase():"";
      user=email?store.get().users.find(x=>x.email&&equal(email,x.email)):null;
      if(!user||typeof req.body?.password!=="string"||!(await passwordMatches(req.body.password,user)))
        throw bad("Invalid credentials",401);
    }
    if(user.disabledAt)throw bad("This account has been disabled",403);
    clear();
    const session=issueSession(res,user);
    res.json({authenticated:true,user:publicOwner(user),csrf:session.csrf});
  }));
  router.post("/logout",protectedSession((_req,res,p)=>{
    store.change("account.logout",s=>{s.sessions=s.sessions.filter(x=>x.id!==p.sessionId);});
    res.setHeader("Set-Cookie",SESSION_COOKIE+"=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
    res.json({ok:true});
  }));
  router.get("/profile",protectedSession((_req,res,p,u)=>{
    res.json({user:publicOwner(u),
      subscription:u.role==="owner"?publicSubscription(store,env):publicSubscription({get:()=>({subscription:{}})},{}),
      sessions:store.get().sessions.filter(x=>x.userId===u.id&&x.expiresAt>Date.now()).map(x=>({id:x.id,createdAt:x.createdAt,expiresAt:x.expiresAt}))});
  }));
  router.post("/profile",protectedSession((req,res,p,u)=>{
    const displayName=validateName(req.body?.displayName);
    store.change("account.profile.update",()=>{u.displayName=displayName;});
    res.json({user:publicOwner(u)});
  }));
  router.post("/password",protectedSession(async(req,res,p,u)=>{
    const next=validatePassword(req.body?.newPassword);
    // Accounts with a phone may confirm with an SMS code instead (the only way for those that never had a password).
    if(req.body?.smsCode!==undefined){
      if(!u.phone||!sms.check(u.phone,"password",req.body.smsCode))throw bad("验证码不正确或已过期",401);
    } else if(!(await passwordMatches(validatePassword(req.body?.currentPassword),u)))throw bad("Current password incorrect",403);
    const salt=randomBytes(16).toString("base64"),newHash=await passwordHash(next,salt);
    store.change("account.password.changed",s=>{
      u.salt=salt;u.passwordHash=newHash;delete u.noPassword;
      s.sessions=s.sessions.filter(x=>x.userId!==u.id||x.id===p.sessionId);
      s.apiKeys.forEach(x=>{if(x.userId===u.id&&!x.revokedAt)x.revokedAt=new Date().toISOString();});
    });
    res.json({ok:true,otherSessionsRevoked:true,apiKeysRevoked:true});
  }));
  router.post("/password/sms",protectedSession(async(_req,res,_p,u)=>{
    if(!sms.enabled()||!u.phone)throw bad("Phone verification is not available",503);
    await sms.send(u.phone,"password");
    res.json({sent:true});
  }));
  router.post("/sessions/revoke",protectedSession((req,res,p,u)=>{
    if(req.body?.allOthers!==true)throw bad("Confirm allOthers=true");
    store.change("account.sessions.revoked",s=>{s.sessions=s.sessions.filter(x=>x.userId!==u.id||x.id===p.sessionId);});
    res.json({ok:true});
  }));
  const safeKey=({hash,userId,...safe})=>safe;
  router.get("/api-keys",protectedSession((_req,res,p,u)=>{
    res.json({keys:store.get().apiKeys.filter(x=>x.userId===u.id).map(safeKey),scopes:[...SCOPES]});
  }));
  router.post("/api-keys",protectedSession((req,res,p,u)=>{
    checkSecret(env.CIRO_API_KEY_PEPPER,"API key pepper");
    const name=validateName(req.body?.name);
    const scopes=req.body?.scopes;
    if(!Array.isArray(scopes)||!scopes.length||scopes.length>3||
      scopes.some(x=>!SCOPES.has(x)))throw bad("Invalid API key scopes");
    const days=req.body?.expiresDays??90;
    if(!Number.isInteger(days)||days<1||days>365)throw bad("API key expiration must be 1-365 days");
    const raw="ciro_sk_"+token();
    const entry={id:randomUUID(),userId:u.id,name,hash:createHmac("sha256",env.CIRO_API_KEY_PEPPER).update(raw).digest("hex"),
      prefix:raw.slice(0,15),scopes:[...new Set(scopes)],createdAt:new Date().toISOString(),
      expiresAt:Date.now()+days*86400000,revokedAt:null};
    store.change("account.api_key.created",s=>{
      if(s.apiKeys.filter(x=>x.userId===u.id&&!x.revokedAt).length>=25)throw bad("Too many active API keys",409);
      s.apiKeys.push(entry);
    });
    res.status(201).json({key:raw,record:safeKey(entry)});
  }));
  router.post("/api-keys/:id/revoke",protectedSession((req,res,p,u)=>{
    const entry=store.get().apiKeys.find(x=>x.id===req.params.id&&x.userId===u.id);
    if(!entry)throw bad("API key not found",404);
    store.change("account.api_key.revoked",()=>{
      entry.revokedAt=new Date().toISOString();
    });
    res.json({revoked:true,id:entry.id});
  }));
  const myNotes=u=>store.get().notifications.filter(x=>x.userId===u.id);
  router.get("/notifications",protectedSession((_req,res,p,u)=>{
    const rows=myNotes(u).reverse().map(({userId,...x})=>x);
    res.json({notifications:rows,unread:rows.filter(x=>!x.readAt).length});
  }));
  router.post("/notifications/:id/read",protectedSession((req,res,p,u)=>{
    const entry=myNotes(u).find(x=>x.id===req.params.id);
    if(!entry)throw bad("Notification not found",404);
    store.change("notification.read",()=>{entry.readAt=new Date().toISOString();});
    res.json({ok:true});
  }));
  router.post("/notifications/read-all",protectedSession((_req,res,p,u)=>{
    store.change("notifications.read_all",()=>{for(const x of myNotes(u)){if(!x.readAt)x.readAt=new Date().toISOString();}});
    res.json({ok:true});
  }));
  /** Notifies one user (default: the server owner, who runs the workbench and billing). */
  function notify({type="info",title,body,refId=null,userId}){
    const user=userId?store.user(userId):store.owner();
    if(!user)return;
    if(!["info","warning","success"].includes(type)||typeof title!=="string"||typeof body!=="string")return;
    store.change("notification.created",s=>{
      s.notifications.push({id:randomUUID(),userId:user.id,type,title:title.slice(0,130),body:body.slice(0,500),
        refId,createdAt:new Date().toISOString(),readAt:null});
      const mine=s.notifications.filter(x=>x.userId===user.id);
      if(mine.length>MAX_NOTIFICATIONS){const drop=new Set(mine.slice(0,mine.length-MAX_NOTIFICATIONS));s.notifications=s.notifications.filter(x=>!drop.has(x));}
    });
  }
  const memAad=(u,id)=>"ciro-memory:"+u.id+":"+id;
  const myMemories=u=>store.get().memories.filter(x=>x.userId===u.id);
  router.get("/memories",protectedSession((_req,res,p,u)=>{
    const memories=myMemories(u).map(x=>({id:x.id,category:x.category,createdAt:x.createdAt,
      content:unsealJSON(x.encrypted,env,memAad(u,x.id))}));
    res.json({enabled:u.memoryEnabled===true,memories});
  }));
  router.post("/memories/preferences",protectedSession((req,res,p,u)=>{
    if(typeof req.body?.enabled!=="boolean")throw bad("Boolean enabled required");
    if(req.body.enabled)encryptionKey(env);
    store.change("memory.preference",()=>{u.memoryEnabled=req.body.enabled;});
    res.json({enabled:req.body.enabled});
  }));
  router.post("/memories",protectedSession((req,res,p,u)=>{
    const content=req.body?.content,category=req.body?.category||"general";
    if(typeof content!=="string"||!content.trim()||content.length>1500)throw bad("Memory must contain 1-1500 characters");
    if(!["general","style","project"].includes(category))throw bad("Invalid memory category");
    if(myMemories(u).length>=MAX_MEMORIES)throw bad("Memory limit reached",409);
    const id=randomUUID();
    const encrypted=sealJSON(content.trim(),env,memAad(u,id));
    store.change("memory.created",s=>{s.memories.push({id,userId:u.id,category,encrypted,createdAt:new Date().toISOString()});});
    res.status(201).json({id,content:content.trim(),category});
  }));
  router.delete("/memories/:id",protectedSession((req,res,p,u)=>{
    const before=store.get().memories.length;
    store.change("memory.deleted",s=>{s.memories=s.memories.filter(x=>!(x.id===req.params.id&&x.userId===u.id));});
    res.json({deleted:before!==store.get().memories.length});
  }));
  function memoryContext(req){
    if(!enabled)return "";
    const p=principal(req),u=p&&userOf(p);
    if(p?.mode!=="session"||!u?.memoryEnabled)return "";
    return myMemories(u).slice(-30).map(x=>unsealJSON(x.encrypted,env,memAad(u,x.id)))
      .filter(x=>typeof x==="string").join("\n").slice(0,8000);
  }
  const blankSync={version:0,encrypted:null,updatedAt:null};
  router.get("/sync",guardedRead((_req,res,p,u)=>{
    const s=store.get().syncs[u.id]||blankSync;
    const snapshot=s.encrypted?unsealJSON(s.encrypted,env,"ciro-sync:"+u.id):null;
    res.json({version:s.version,updatedAt:s.updatedAt,snapshot});
  }));
  router.put("/sync",guardedRead((req,res,p,u)=>{
    if(!Number.isSafeInteger(req.body?.baseVersion)||req.body.baseVersion<0)throw bad("Invalid baseVersion");
    const state=store.get().syncs[u.id]||blankSync;
    if(state.version!==req.body.baseVersion)
      return res.status(409).json({error:"Sync conflict; refresh and reconcile first",currentVersion:state.version});
    const data=validateSnapshot(req.body.snapshot);
    const enc=sealJSON(data,env,"ciro-sync:"+u.id);
    store.change("sync.snapshot.updated",s=>{
      const cur=s.syncs[u.id]||{...blankSync};
      s.syncs[u.id]={version:cur.version+1,encrypted:enc,updatedAt:new Date().toISOString()};
    });
    res.json({version:store.get().syncs[u.id].version,updatedAt:store.get().syncs[u.id].updatedAt});
  }));
  // Incremental sync (v2): per-item encrypted rows with tombstones; see server/sync-store.mjs.
  const syncAad=(u,key)=>"ciro-sync2:"+u.id+":"+key;
  const syncRow=u=>r=>({key:r.key,kind:r.kind,id:r.item_id,rev:Number(r.rev),mtime:Number(r.mtime),deleted:!!r.deleted,
    data:r.deleted||!r.payload?null:unsealJSON(JSON.parse(r.payload),env,syncAad(u,r.key))});
  router.get("/sync/v2/changes",guardedRead((req,res,p,u)=>{
    const since=Number(req.query.since||0);
    if(!Number.isSafeInteger(since)||since<0)throw bad("Invalid since");
    const db=syncStore(),rows=db.since(u.id,since,SYNC_LIMITS.pageItems+1);
    const page=rows.slice(0,SYNC_LIMITS.pageItems);
    res.json({rev:page.length?Number(page.at(-1).rev):Math.max(since,db.rev(u.id)),latest:db.rev(u.id),
      more:rows.length>SYNC_LIMITS.pageItems,count:db.count(u.id),items:page.map(syncRow(u))});
  }));
  router.post("/sync/v2/push",guardedRead((req,res,p,u)=>{
    const input=req.body?.items;
    if(!Array.isArray(input)||input.length>SYNC_LIMITS.batchItems)throw bad("Invalid sync batch");
    const items=input.map(x=>{
      if(!x||!SYNC_KINDS.has(x.kind)||typeof x.id!=="string"||!x.id||x.id.length>120||
        !Number.isSafeInteger(x.mtime)||x.mtime<0||typeof x.deleted!=="boolean")throw bad("Invalid sync item");
      if(!x.deleted&&(!x.data||typeof x.data!=="object"||Array.isArray(x.data)))throw bad("Invalid sync item data");
      const payload=x.deleted?null:JSON.stringify(sealJSON(x.data,env,syncAad(u,x.kind+":"+x.id)));
      if(payload&&payload.length>SYNC_LIMITS.itemBytes*1.4)throw bad("Sync item too large");
      return {...x,key:x.kind+":"+x.id,payload};
    });
    const db=syncStore();
    if(db.total(u.id)+items.length>SYNC_LIMITS.totalItems)throw bad("Sync storage is full",413);
    // Older edits never overwrite newer ones; equal mtime lets the latest writer win.
    const results=db.write(u.id,items,(item,existing)=>existing&&Number(existing.mtime)>item.mtime?null:{payload:item.payload});
    res.json({rev:db.rev(u.id),count:db.count(u.id),
      accepted:results.filter(r=>r.accepted).map(r=>({key:r.item.key,rev:r.rev})),
      rejected:results.filter(r=>!r.accepted).map(r=>syncRow(u)(r.existing))});
  }));
  // User management for the server owner: list, disable / enable, remove, and invite codes.
  const adminUser=x=>({id:x.id,email:x.email,displayName:x.displayName,role:x.role==="owner"?"owner":"user",
    createdAt:x.createdAt,lastSeenAt:x.lastSeenAt||null,disabled:Boolean(x.disabledAt),
    apiKeys:store.get().apiKeys.filter(k=>k.userId===x.id&&!k.revokedAt).length});
  router.get("/admin/users",ownerSession((_req,res)=>{
    res.json({users:store.get().users.map(adminUser),registration,
      invites:store.get().invites.filter(x=>!x.usedAt&&x.expiresAt>Date.now())});
  }));
  const target=(req,u)=>{
    const x=store.user(req.params.id);
    if(!x)throw bad("User not found",404);
    if(x.id===u.id||x.role==="owner")throw bad("The server owner cannot be changed here",409);
    return x;
  };
  router.post("/admin/users/:id",ownerSession((req,res,p,u)=>{
    const x=target(req,u);
    if(typeof req.body?.disabled!=="boolean")throw bad("Boolean disabled required");
    store.change(req.body.disabled?"admin.user.disabled":"admin.user.enabled",s=>{
      x.disabledAt=req.body.disabled?new Date().toISOString():null;
      if(req.body.disabled)s.sessions=s.sessions.filter(y=>y.userId!==x.id);
    });
    res.json({user:adminUser(x)});
  }));
  router.delete("/admin/users/:id",ownerSession((req,res,p,u)=>{
    const x=target(req,u);
    store.change("admin.user.deleted",s=>{
      s.users=s.users.filter(y=>y.id!==x.id);
      for(const k of ["sessions","apiKeys","memories","notifications"])s[k]=s[k].filter(y=>y.userId!==x.id);
      delete s.syncs[x.id];
    });
    syncStore().removeUser(x.id);
    res.json({deleted:true});
  }));
  router.post("/admin/invites",ownerSession((req,res)=>{
    const days=req.body?.days??7;
    if(!Number.isInteger(days)||days<1||days>90)throw bad("Invite expiry must be 1-90 days");
    const code=randomBytes(6).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g,"X").slice(0,8);
    const invite={code,createdAt:new Date().toISOString(),expiresAt:Date.now()+days*86400000,usedAt:null};
    store.change("admin.invite.created",s=>{
      s.invites=s.invites.filter(x=>!x.usedAt&&x.expiresAt>Date.now()).slice(-199);
      s.invites.push(invite);
    });
    res.status(201).json({invite});
  }));
  router.delete("/admin/invites/:code",ownerSession((req,res)=>{
    store.change("admin.invite.deleted",s=>{s.invites=s.invites.filter(x=>x.code!==req.params.code);});
    res.json({ok:true});
  }));
  // CWU: one balance per account, the same on every device and wherever it was bought.
  router.get("/cwu",protectedSession((_req,res,_p,u)=>{
    res.json({enabled:cwuEnabled(env),balance:cwu.balance(u.id),ledger:cwu.ledger(u.id),
      packs:cwuPacks(env).map(({stripePrice,...pack})=>pack),
      buy:cwuEnabled(env)&&Boolean(env.CIRO_STRIPE_SECRET_KEY)&&typeof env.CIRO_PUBLIC_ORIGIN==="string"});
  }));
  router.post("/cwu/checkout",protectedSession(async(req,res,_p,u)=>{
    if(!cwuEnabled(env)||typeof env.CIRO_PUBLIC_ORIGIN!=="string")throw bad("CWU purchases are not available",503);
    const pack=cwuPacks(env).find(x=>x.id===req.body?.pack);
    if(!pack)throw bad("Unknown CWU pack",400);
    const origin=env.CIRO_PUBLIC_ORIGIN.replace(/\/+$/,"");
    const session=await stripeCall(env,"checkout/sessions",{
      mode:"payment","line_items[0][price]":pack.stripePrice,"line_items[0][quantity]":"1",
      success_url:origin+"/?cwu=success",cancel_url:origin+"/?cwu=cancel",client_reference_id:u.id,...(u.email?{customer_email:u.email}:{}),
      "metadata[ciro_kind]":"cwu","metadata[ciro_user]":u.id,"metadata[ciro_cwu]":String(pack.cwu),"metadata[ciro_pack]":pack.id
    },fetchFn);
    res.json({url:session.url,id:session.id});
  }));
  // The owner can give CWU (support, promotions, refunds); negative amounts take CWU back.
  router.post("/admin/users/:id/cwu",ownerSession((req,res)=>{
    const amount=Number(req.body?.cwu);
    if(!Number.isFinite(amount)||amount===0||Math.abs(amount)>1e9)throw bad("Invalid CWU amount",400);
    if(!store.user(req.params.id))throw bad("No such user",404);
    if(amount>0)cwu.credit(req.params.id,amount,"grant");else cwu.charge(req.params.id,-amount,undefined,"adjust");
    res.json({balance:cwu.balance(req.params.id)});
  }));
  // Stripe subscription: the server owner's own plan for this deployment.
  const hasStripe=()=>publicSubscription(store,env).configured;
  router.post("/subscription/checkout",ownerSession(async(_req,res,p,owner)=>{
    if(!hasStripe())throw bad("Stripe subscription is not configured",503);
    const sub=store.get().subscription;
    const origin=env.CIRO_PUBLIC_ORIGIN.replace(/\/+$/,"");
    const params={
      mode:"subscription","line_items[0][price]":env.CIRO_STRIPE_PRICE_ID,
      "line_items[0][quantity]":"1",success_url:origin+"/?billing=success",
      cancel_url:origin+"/?billing=cancel",client_reference_id:owner.id,
      "subscription_data[metadata][ciro_owner_id]":owner.id
    };
    if(sub.customerId)params.customer=sub.customerId;else params.customer_email=owner.email;
    const session=await stripeCall(env,"checkout/sessions",params,fetchFn);
    res.json({url:session.url,id:session.id});
  }));
  router.post("/subscription/portal",ownerSession(async(_req,res)=>{
    if(!hasStripe())throw bad("Stripe portal is not configured",503);
    const customer=store.get().subscription.customerId;
    if(!customer)throw bad("No verified Stripe customer; checkout first",409);
    const result=await stripeCall(env,"billing_portal/sessions",{
      customer,return_url:env.CIRO_PUBLIC_ORIGIN.replace(/\/+$/,"")+"/?billing=return"
    },fetchFn);
    res.json({url:result.url});
  }));
  router.post("/subscription/webhook",wrapped((req,res)=>{
    const event=verifyStripeEvent(req,env);
    const payload=event.data?.object||{},owner=store.owner();
    // A CWU pack paid (in the app or on the website): credit that account, once per Stripe session.
    if(event.type==="checkout.session.completed"&&payload.metadata?.ciro_kind==="cwu"&&payload.payment_status!=="unpaid"){
      const amount=Number(payload.metadata.ciro_cwu);
      const user=store.user(payload.metadata.ciro_user||payload.client_reference_id||"")||cwu.userByEmail(payload.customer_details?.email||payload.customer_email);
      if(!user||!Number.isSafeInteger(amount)||amount<=0)return res.status(202).json({ignored:true});
      const applied=cwu.credit(user.id,amount,"purchase","stripe:"+payload.id);
      if(applied)notify({type:"info",title:"CWU 已到账",body:"充值 "+amount+" CWU 已到账。",userId:user.id});
      return res.json({received:true,applied});
    }
    if(!owner)return res.status(202).json({ignored:true});
    if(store.get().webhookEvents.includes(event.id))return res.json({received:true,duplicate:true});
    const sub=store.get().subscription;
    const type=event.type;
    const checkout=type==="checkout.session.completed" && payload.client_reference_id===owner.id;
    const subscription=type.startsWith("customer.subscription.")&&
      typeof payload.customer==="string" &&
      (payload.customer===sub.customerId || payload.metadata?.ciro_owner_id===owner.id);
    store.change("stripe.webhook."+type,s=>{
      s.webhookEvents.push(event.id);s.webhookEvents=s.webhookEvents.slice(-1200);
      if(checkout){
        s.subscription.customerId=typeof payload.customer==="string"?payload.customer:s.subscription.customerId;
        s.subscription.subscriptionId=typeof payload.subscription==="string"?payload.subscription:s.subscription.subscriptionId;
        if(["not_connected","pending_confirmation","unverified"].includes(s.subscription.status))
          s.subscription.status="pending_confirmation";
        s.subscription.updatedAt=new Date().toISOString();
      } else if(subscription){
        if(!s.subscription.customerId)s.subscription.customerId=payload.customer;
        s.subscription.subscriptionId=payload.id||s.subscription.subscriptionId;
        s.subscription.status=["active","trialing","past_due","canceled","incomplete","unpaid","paused"].includes(payload.status)
          ?payload.status:"unverified";
        s.subscription.cancelAtPeriodEnd=payload.cancel_at_period_end===true;
        s.subscription.currentPeriodEnd=Number.isInteger(payload.current_period_end)?
          new Date(payload.current_period_end*1000).toISOString():null;
        s.subscription.updatedAt=new Date().toISOString();
      }
    });
    if(checkout)notify({type:"info",title:"Checkout confirmed by Stripe",body:"Waiting for subscription status webhook."});
    if(subscription)notify({type:"info",title:"Stripe subscription updated",body:"Verified subscription status: "+payload.status});
    res.json({received:true,applied:Boolean(checkout||subscription)});
  }));
  /** The server owner (the account created first), signed in through the browser — API keys and paired devices never count. */
  function isOwner(req){
    const p=req.principal;
    if(!enabled||!p||p.mode!=="session")return false;
    return store.user(p.id)?.role==="owner";
  }
  /** API key ids that belong to the signed-in user (for the API console). */
  const keyIdsOf=userId=>new Set(store.get().apiKeys.filter(x=>x.userId===userId).map(x=>x.id));
  return {router,guard,store,principal,memoryContext,notify,enabled,isOwner,keyIdsOf,cwu};
}

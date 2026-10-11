// The packaged desktop app serves its UI/API on an ephemeral loopback port.
// A per-launch 256-bit token, injected only by Electron's trusted main process,
// prevents unrelated local browsers/websites from reaching privileged endpoints.
import {timingSafeEqual} from "node:crypto";

export function desktopTokenAccepted(expected,received){
 if(typeof expected!=="string"||!expected.length)return true;
 if(typeof received!=="string"||!received.length)return false;
 const wanted=Buffer.from(expected,"utf8"),actual=Buffer.from(received,"utf8");
 return wanted.length===actual.length&&timingSafeEqual(wanted,actual);
}

export function createDesktopGuard(env=process.env){
 const secret=env.CIRO_DESKTOP_TOKEN||"";
 if(secret && (secret.length<32||!["127.0.0.1","::1","localhost"].includes(env.HOST||"127.0.0.1")))
  throw new Error("Desktop API must use a strong ephemeral secret and loopback binding");
 return (req,res,next)=>{
  if(secret&&!desktopTokenAccepted(secret,req.get("x-ciro-desktop-token"))){
   return res.status(403).set("Cache-Control","no-store").json({error:"Desktop client authorization required"});
  }
  if(secret){
   res.set("Content-Security-Policy",[
    "default-src 'self'","base-uri 'self'","object-src 'none'",
    "script-src 'self'","style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:","font-src 'self' data:","connect-src 'self'",
    "worker-src 'self' blob:","form-action 'self'","frame-ancestors 'none'"
   ].join("; "));
   res.set("X-Content-Type-Options","nosniff");
   res.set("Referrer-Policy","no-referrer");
  }
  next();
 };
}

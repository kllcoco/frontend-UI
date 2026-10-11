import {createHmac,randomBytes,timingSafeEqual} from "node:crypto";
const fail=(message,statusCode=403)=>Object.assign(new Error(message),{statusCode});
function key(secret){
 if(typeof secret!=="string"||secret.length<32)throw fail("Agent plugin capability secret not configured",503);
 return secret;
}
export function issueAgentPluginCapability({secret,goal,ttlMs=300000,now=Date.now()}){
 key(secret);
 if(!goal||!goal.id||!goal.ownerId||!goal.repo||goal.status!=="running")
  throw fail("Active, owned agent goal required");
 const payload={v:1,jobId:goal.id,ownerId:goal.ownerId,repo:goal.repo,
  issuedAt:now,expiresAt:now+ttlMs,nonce:randomBytes(16).toString("hex")};
 const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");
 const mac=createHmac("sha256",secret).update(encoded).digest("base64url");
 return encoded+"."+mac;
}
export function verifyAgentPluginCapability({secret,token,goal,now=Date.now()}){
 key(secret);
 if(typeof token!=="string"||token.length>1500)throw fail("Missing agent capability");
 const parts=token.split(".");
 if(parts.length!==2||parts[1].length<40)throw fail("Malformed agent capability");
 const expected=createHmac("sha256",secret).update(parts[0]).digest();
 let provided;try{provided=Buffer.from(parts[1],"base64url");}catch{throw fail("Malformed signature");}
 if(provided.length!==expected.length||!timingSafeEqual(provided,expected))
  throw fail("Invalid agent capability signature");
 let payload;try{payload=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));}
 catch{throw fail("Invalid agent capability payload");}
 if(payload.v!==1||payload.jobId!==goal?.id||payload.ownerId!==goal?.ownerId||
    payload.repo!==goal?.repo||goal?.status!=="running"||
    !Number.isFinite(payload.issuedAt)||!Number.isFinite(payload.expiresAt)||
    payload.expiresAt<=now||payload.issuedAt>now+5000||payload.expiresAt-payload.issuedAt>300000)
   throw fail("Agent capability expired, revoked or out of scope");
 return {jobId:payload.jobId,ownerId:payload.ownerId,repo:payload.repo};
}

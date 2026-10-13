// Phone sign-up / sign-in: one-time codes sent by SMS.
//   CIRO_SMS_PROVIDER=aliyun   CIRO_SMS_ALIYUN_KEY_ID, CIRO_SMS_ALIYUN_KEY_SECRET, CIRO_SMS_ALIYUN_SIGN (签名),
//                              CIRO_SMS_ALIYUN_TEMPLATE (模板 code; the template must contain ${code})
//   CIRO_SMS_PROVIDER=twilio   CIRO_SMS_TWILIO_SID, CIRO_SMS_TWILIO_TOKEN, CIRO_SMS_TWILIO_FROM (number or MG… service id)
//   CIRO_SMS_PROVIDER=log      development only: the code is printed in the server log, nothing is sent
import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const CODE_TTL = 10 * 60_000, RESEND_AFTER = 60_000, MAX_TRIES = 5, PER_DAY = 10;

export function smsProvider(env) {
  const p = String(env.CIRO_SMS_PROVIDER || "").trim().toLowerCase();
  return ["aliyun", "twilio", "log"].includes(p) ? p : "";
}

/** "+8613812345678" for mainland numbers typed with or without +86; other countries need "+<country code>…". */
export function normalizePhone(raw) {
  const v = String(raw || "").replace(/[\s()-]/g, "");
  if (/^1[3-9]\d{9}$/.test(v)) return "+86" + v;
  if (/^(\+|00)86 ?1[3-9]\d{9}$/.test(v)) return "+86" + v.replace(/^(\+|00)86 ?/, "");
  if (/^\+[1-9]\d{6,14}$/.test(v)) return v;
  return "";
}
export function maskPhone(p) {
  if (!p) return "";
  if (p.startsWith("+86")) { const d = p.slice(3); return d.slice(0, 3) + "****" + d.slice(-4); }
  return p.slice(0, Math.max(3, p.length - 8)) + "****" + p.slice(-4);
}

const pct = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function sendAliyun(env, phone, code, fetchFn) {
  const params = {
    AccessKeyId: env.CIRO_SMS_ALIYUN_KEY_ID, Action: "SendSms", Format: "JSON", PhoneNumbers: phone.replace(/^\+86/, ""),
    RegionId: "cn-hangzhou", SignName: env.CIRO_SMS_ALIYUN_SIGN, SignatureMethod: "HMAC-SHA1", SignatureNonce: randomUUID(),
    SignatureVersion: "1.0", TemplateCode: env.CIRO_SMS_ALIYUN_TEMPLATE, TemplateParam: JSON.stringify({ code }),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), Version: "2017-05-25"
  };
  const query = Object.keys(params).sort().map((k) => pct(k) + "=" + pct(String(params[k]))).join("&");
  const signature = createHmac("sha1", env.CIRO_SMS_ALIYUN_KEY_SECRET + "&").update("GET&%2F&" + pct(query)).digest("base64");
  const res = await fetchFn("https://dysmsapi.aliyuncs.com/?Signature=" + pct(signature) + "&" + query);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.Code !== "OK") throw new Error("SMS provider rejected the message: " + (body.Code || res.status));
}

async function sendTwilio(env, phone, code, fetchFn) {
  const from = String(env.CIRO_SMS_TWILIO_FROM || "");
  const form = new URLSearchParams({ To: phone, Body: "【Ciro】验证码 " + code + "，10 分钟内有效。如非本人操作请忽略。" });
  if (from.startsWith("MG")) form.set("MessagingServiceSid", from); else form.set("From", from);
  const res = await fetchFn("https://api.twilio.com/2010-04-01/Accounts/" + encodeURIComponent(env.CIRO_SMS_TWILIO_SID) + "/Messages.json", {
    method: "POST", body: form.toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(env.CIRO_SMS_TWILIO_SID + ":" + env.CIRO_SMS_TWILIO_TOKEN).toString("base64") }
  });
  if (!res.ok) throw new Error("SMS provider rejected the message: " + res.status);
}

const digest = (phone, purpose, code) => createHash("sha256").update(phone + "|" + purpose + "|" + code).digest();

/** Codes live in memory (they are short-lived): one pending code per phone and purpose. */
export function createSmsCodes(env, fetchFn = fetch, log = console) {
  const pending = new Map(), daily = new Map();
  return {
    enabled: () => Boolean(smsProvider(env)),
    async send(phone, purpose) {
      const key = phone + "|" + purpose, now = Date.now(), prev = pending.get(key);
      if (prev && now - prev.sentAt < RESEND_AFTER) { const e = new Error("验证码已发送，请稍后再试"); e.statusCode = 429; throw e; }
      const day = new Date().toISOString().slice(0, 10), count = daily.get(phone + day) || 0;
      if (count >= PER_DAY) { const e = new Error("今天获取验证码的次数太多了，请明天再试"); e.statusCode = 429; throw e; }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      const provider = smsProvider(env);
      if (provider === "aliyun") await sendAliyun(env, phone, code, fetchFn);
      else if (provider === "twilio") await sendTwilio(env, phone, code, fetchFn);
      else if (provider === "log") log.info("[ciro sms] code for " + maskPhone(phone) + " (" + purpose + "): " + code);
      else { const e = new Error("Phone sign-in is not available"); e.statusCode = 503; throw e; }
      pending.set(key, { hash: digest(phone, purpose, code), sentAt: now, expires: now + CODE_TTL, tries: 0 });
      daily.set(phone + day, count + 1);
      if (daily.size > 50_000) daily.clear();
    },
    /** True once for the right code (then it is used up); wrong codes count towards a limit. */
    check(phone, purpose, code) {
      const key = phone + "|" + purpose, entry = pending.get(key);
      if (!entry || entry.expires < Date.now() || !/^\d{6}$/.test(String(code || ""))) return false;
      entry.tries += 1;
      const ok = timingSafeEqual(entry.hash, digest(phone, purpose, String(code)));
      if (ok || entry.tries >= MAX_TRIES) pending.delete(key);
      return ok;
    }
  };
}

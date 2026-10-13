import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAccountService } from "../server/account.mjs";
import { usedCwu, cwuPacks } from "../server/cwu.mjs";

const hook = "whsec_test_secret_of_enough_length_123";
const env = { CIRO_ACCOUNTS_ENABLED: "true", CIRO_BOOTSTRAP_TOKEN: "bootstrap-secret-of-32-characters-long", CIRO_API_KEY_PEPPER: "api-key-hmac-pepper-more-than-24-bytes",
  CIRO_ACCOUNT_DATA_KEY: randomBytes(32).toString("base64"), CIRO_REGISTRATION: "open", CIRO_CWU_BILLING: "on", CIRO_CWU_SIGNUP_BONUS: "500",
  CIRO_STRIPE_WEBHOOK_SECRET: hook, CIRO_CWU_PACKS: JSON.stringify([{ id: "s", cwu: 100000, label: "10 万 CWU", price: "¥30", stripePrice: "price_123" }, { id: "bad", cwu: -1, stripePrice: "x" }]) };
const pw = "a-very-secure-long-password";

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "ciro-cwu-"));
  const service = createAccountService({ env, dir });
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use("/api/account", service.router); app.use("/api", service.guard);
  // Same rule as server/index.mjs: no balance, no reply; then charge what the model reported.
  app.post("/api/chat", (req, res) => {
    if (!service.cwu.canSpend(req.principal.id)) return res.status(402).json({ error: "CWU 额度不足，充值后即可继续。", code: "insufficient_cwu" });
    service.cwu.charge(req.principal.id, usedCwu('data: {"choices":[],"usage":{"prompt_tokens":9,"cwu":' + req.body.cwu + '}}'));
    res.json({ ok: true });
  });
  const server = await new Promise((r) => { const l = app.listen(0, "127.0.0.1", () => r(l)); });
  const url = "http://127.0.0.1:" + server.address().port;
  const client = () => {
    let cookie = "", csrf = "";
    return async (path, { method = "GET", body, headers = {} } = {}) => {
      const h = { ...headers }; if (cookie) h.Cookie = cookie; if (csrf && method !== "GET") h["X-Ciro-Csrf"] = csrf;
      if (body !== undefined && !h["Content-Type"]) h["Content-Type"] = "application/json";
      const r = await fetch(url + path, { method, headers: h, ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}) });
      const json = await r.json().catch(() => null);
      const set = r.headers.get("set-cookie"); if (set && json?.csrf) { cookie = set.split(";")[0]; csrf = json.csrf; }
      return { status: r.status, json };
    };
  };
  return { service, client, close: async () => { await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); } };
}
const signed = (event) => {
  const raw = JSON.stringify(event), t = Math.floor(Date.now() / 1000);
  return { body: raw, headers: { "Content-Type": "application/json", "Stripe-Signature": "t=" + t + ",v1=" + createHmac("sha256", hook).update(t + "." + raw).digest("hex") } };
};

test("CWU: one balance per account; sign-up bonus, charged per reply, 402 when empty, purchases credited once by id or email", async () => {
  const ctx = await setup();
  try {
    const owner = ctx.client(), a = ctx.client();
    assert.equal((await owner("/api/account/bootstrap", { method: "POST", body: { bootstrapToken: env.CIRO_BOOTSTRAP_TOKEN, email: "owner@example.com", displayName: "O", password: pw } })).status, 201);
    const reg = await a("/api/account/register", { method: "POST", body: { email: "a@x.io", displayName: "A", password: pw } });
    assert.equal(reg.status, 201);
    const id = reg.json.user.id;
    let me = await a("/api/account/cwu");
    assert.equal(me.json.balance, 500);
    assert.deepEqual(me.json.packs, [{ id: "s", cwu: 100000, label: "10 万 CWU", price: "¥30" }], "price ids and malformed packs never reach the client");
    assert.equal((await a("/api/chat", { method: "POST", body: { cwu: 300 } })).status, 200);
    assert.equal((await a("/api/chat", { method: "POST", body: { cwu: 300 } })).status, 200); // may end below zero…
    assert.equal((await a("/api/account/cwu")).json.balance, -100);
    const refused = await a("/api/chat", { method: "POST", body: { cwu: 1 } });  // …then the next one is refused
    assert.equal(refused.status, 402); assert.equal(refused.json.code, "insufficient_cwu");
    // Paid in the app (user id in metadata) — the same Stripe session twice counts once.
    const paid = { id: "evt_1", type: "checkout.session.completed", data: { object: { id: "cs_1", payment_status: "paid", client_reference_id: id, metadata: { ciro_kind: "cwu", ciro_user: id, ciro_cwu: "100000" } } } };
    assert.equal((await a("/api/account/subscription/webhook", { method: "POST", ...signed(paid) })).json.applied, true);
    assert.equal((await a("/api/account/subscription/webhook", { method: "POST", ...signed({ ...paid, id: "evt_2" }) })).json.applied, false);
    // Paid on the website: only the account email is known.
    const web = { id: "evt_3", type: "checkout.session.completed", data: { object: { id: "cs_web", payment_status: "paid", customer_details: { email: "A@X.io" }, metadata: { ciro_kind: "cwu", ciro_cwu: "1000" } } } };
    assert.equal((await a("/api/account/subscription/webhook", { method: "POST", ...signed(web) })).json.applied, true);
    me = await a("/api/account/cwu");
    assert.equal(me.json.balance, 100900);
    assert.deepEqual(me.json.ledger.map((e) => e.reason), ["purchase", "purchase", "chat", "chat", "signup"]);
    assert.equal((await a("/api/chat", { method: "POST", body: { cwu: 1 } })).status, 200);
    // Only the owner grants CWU.
    assert.equal((await a("/api/account/admin/users/" + id + "/cwu", { method: "POST", body: { cwu: 50 } })).status, 403);
    assert.equal((await owner("/api/account/admin/users/" + id + "/cwu", { method: "POST", body: { cwu: 50 } })).json.balance, 100949);
  } finally { await ctx.close(); }
});

test("usedCwu reads only the usage object, never the reply text", () => {
  assert.equal(usedCwu('data: {"choices":[{"delta":{"content":"\\"cwu\\": 99999"}}]}\n\ndata: {"usage":{"cwu":12.5,"gwu":3}}'), 12.5);
  assert.equal(usedCwu('data: {"choices":[{"delta":{"content":"say \\"cwu\\":5"}}]}'), 0);
  assert.deepEqual(cwuPacks({ CIRO_CWU_PACKS: "not json" }), []);
});

test("phone sign-up and sign-in with SMS codes (one use, wrong codes refused, same account as email users)", async () => {
  const codes = [];
  const orig = console.info;
  console.info = (line) => { const m = /code for .*?: (\d{6})/.exec(String(line)); if (m) codes.push(m[1]); else orig(line); };
  const prev = env.CIRO_SMS_PROVIDER; env.CIRO_SMS_PROVIDER = "log";
  const ctx = await setup();
  try {
    const owner = ctx.client(), a = ctx.client(), b = ctx.client();
    await owner("/api/account/bootstrap", { method: "POST", body: { bootstrapToken: env.CIRO_BOOTSTRAP_TOKEN, email: "owner@example.com", displayName: "O", password: pw } });
    assert.equal((await a("/api/account/session")).json.phoneSignIn, true);
    assert.equal((await a("/api/account/sms/send", { method: "POST", body: { phone: "12345", purpose: "register" } })).status, 400);
    assert.equal((await a("/api/account/sms/send", { method: "POST", body: { phone: "138 1234 5678", purpose: "register" } })).status, 200);
    assert.equal((await a("/api/account/sms/send", { method: "POST", body: { phone: "13812345678", purpose: "register" } })).status, 429, "resend waits a minute");
    assert.equal((await a("/api/account/register", { method: "POST", body: { phone: "13812345678", smsCode: "000000" } })).status, 401);
    const reg = await a("/api/account/register", { method: "POST", body: { phone: "+8613812345678", smsCode: codes.at(-1) } });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.user.phone, "138****5678");
    assert.equal((await a("/api/account/cwu")).json.balance, 500, "phone accounts get the same CWU account");
    assert.equal((await b("/api/account/register", { method: "POST", body: { phone: "13812345678", smsCode: codes.at(-1) } })).status, 401, "a code works once");
    assert.equal((await b("/api/account/sms/send", { method: "POST", body: { phone: "13812345678", purpose: "register" } })).status, 409);
    assert.equal((await b("/api/account/sms/send", { method: "POST", body: { phone: "13900000000", purpose: "login" } })).status, 404);
    assert.equal((await b("/api/account/sms/send", { method: "POST", body: { phone: "13812345678", purpose: "login" } })).status, 200);
    const login = await b("/api/account/login", { method: "POST", body: { phone: "13812345678", smsCode: codes.at(-1) } });
    assert.equal(login.status, 200); assert.equal(login.json.user.id, reg.json.user.id);
    assert.equal((await b("/api/account/login", { method: "POST", body: { email: "", password: "x" } })).status, 401, "no empty-email match");
  } finally { console.info = orig; env.CIRO_SMS_PROVIDER = prev; await ctx.close(); }
});

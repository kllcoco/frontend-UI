// CWU balance per account. One balance per user, whatever the device or where the CWU were bought: the app, the
// website and the Stripe webhook all credit the same account (by user id, or by the account email for purchases
// made outside the app). Each reply is charged with the CWU the model reports; with no balance left, chats stop
// with a clear "top up" message. Off unless CIRO_CWU_BILLING=on (self-hosted servers are not billed).
//
//   CIRO_CWU_BILLING=on
//   CIRO_CWU_SIGNUP_BONUS=20000                       CWU given to each new account (optional)
//   CIRO_CWU_PACKS=[{"id":"s","cwu":100000,"label":"10 万 CWU","price":"¥30","stripePrice":"price_…"}]

const LEDGER_KEEP = 300;

export function cwuEnabled(env) { return /^(1|on|true|yes)$/i.test(String(env.CIRO_CWU_BILLING || "")); }

/** Packs offered for sale (only well-formed entries; the Stripe price id never reaches the client). */
export function cwuPacks(env) {
  let list = [];
  try { list = JSON.parse(env.CIRO_CWU_PACKS || "[]"); } catch { return []; }
  if (!Array.isArray(list)) return [];
  return list.filter((p) => p && /^[a-z0-9_-]{1,32}$/i.test(String(p.id)) && Number.isSafeInteger(p.cwu) && p.cwu > 0 && /^price_[A-Za-z0-9]+$/.test(String(p.stripePrice || "")))
    .slice(0, 12).map((p) => ({ id: String(p.id), cwu: p.cwu, label: String(p.label || p.cwu + " CWU").slice(0, 40), price: String(p.price || "").slice(0, 24), stripePrice: String(p.stripePrice) }));
}

/** Ledger operations on the account store (store.get / store.change from account-store.mjs). */
export function createCwuLedger(store, env) {
  const state = () => store.get();
  const balanceOf = (userId) => {
    const u = state().users.find((x) => x.id === userId);
    return u && Number.isFinite(u.cwuBalance) ? u.cwuBalance : 0;
  };
  /** Adds (or with a negative amount, takes) CWU. `ref` makes it idempotent (a Stripe session paid twice counts once). */
  function apply(userId, amount, reason, ref) {
    let applied = false;
    store.change("cwu." + reason, (s) => {
      const u = s.users.find((x) => x.id === userId);
      if (!u) return;
      s.cwuLedger ||= {};
      const list = (s.cwuLedger[userId] ||= []);
      if (ref && list.some((e) => e.ref === ref)) return;
      u.cwuBalance = Math.round(((Number.isFinite(u.cwuBalance) ? u.cwuBalance : 0) + amount) * 100) / 100;
      list.push({ at: new Date().toISOString(), delta: Math.round(amount * 100) / 100, reason, ...(ref ? { ref } : {}), balance: u.cwuBalance });
      if (list.length > LEDGER_KEEP) list.splice(0, list.length - LEDGER_KEEP);
      applied = true;
    });
    return applied;
  }
  return {
    enabled: () => cwuEnabled(env),
    balance: balanceOf,
    ledger: (userId, n = 50) => ((state().cwuLedger || {})[userId] || []).slice(-n).reverse(),
    /** Chats need a positive balance (a reply may end slightly below zero; the next one is refused). */
    canSpend: (userId) => !cwuEnabled(env) || userId === "local" || balanceOf(userId) > 0,
    credit: (userId, amount, reason, ref) => amount > 0 && apply(userId, amount, reason, ref),
    charge: (userId, amount, ref) => cwuEnabled(env) && userId !== "local" && amount > 0 && apply(userId, -amount, "chat", ref),
    /** A purchase made elsewhere (e.g. the website) arrives with the account email only. */
    userByEmail: (email) => state().users.find((x) => typeof email === "string" && x.email.toLowerCase() === email.trim().toLowerCase()) || null
  };
}

/** The CWU a reply used, from the usage the model reports (SSE tail or JSON body). */
export function usedCwu(text) {
  let last = 0;
  // Only inside a "usage" object, so a reply that merely mentions "cwu" is never charged by its text.
  for (const m of String(text || "").matchAll(/"usage"\s*:\s*\{[^{}]*?"cwu"\s*:\s*([0-9]+(?:\.[0-9]+)?)/g)) last = Number(m[1]);
  return Number.isFinite(last) ? last : 0;
}

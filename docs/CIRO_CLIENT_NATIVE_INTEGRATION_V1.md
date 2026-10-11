# CIRO Client ↔ NCPA Native Runtime Integration Contract V1

**Status:** client/control-plane implementation exists on the frontend-UI Draft PR.
No CIRO GEN1 authority claim until native runtime, independent verifier, billing,
TLS and Stripe are configured and the end-to-end checks below pass.

## Trust boundaries

- Browser: input and UI only; receives session/CSRF and one-time client key secret.
  No Stripe secret, runtime token, GitHub token, encryption key or HMAC secret.
- Client backend: authenticates the single owner, evaluates per-request permission,
  validates Stripe webhooks and HMAC metering receipts, encrypts memory/snapshots.
- CIRO native runtime: owns actual model compute, agent execution, skill execution,
  sandbox, tool authorization, budget enforcement *during* compute, and metering.
- Independent verifier: must produce real test/red-team/audit evidence; a model
  replying "PASS" or fabricating SHA256 evidence is not authoritative.
- Stripe: owns card data, subscription charges, hosted checkout and portal.

## 1. Model chat

Use CIRO_API_BASE_URL and CIRO_API_PATH (default /chat/completions),
CIRO_MODEL and CIRO_API_KEY on the backend. The frontend calls POST /api/chat
with messages/model and optional user custom instructions. Backend authenticates
the user (if CIRO_ACCOUNTS_ENABLED=true), verifies CSRF for cookie requests,
adds **opted-in** encrypted-memory notes as clearly untrusted user context,
then forwards to the actual model provider with server-side authorization.
The model must support OpenAI-compatible JSON/SSE completion streaming.
Errors are delivered as actual 4xx/5xx or SSE error, never synthetic model output.

Future real token work must produce signed CWU/GWU metering receipts; chat does
not locally guess dollar charges from token length.

## 2. CIRO Agent Workbench and Skills

Configure distinct CIRO_AGENT_RUNNER_URL/TOKEN and CIRO_VERIFIER_URL/TOKEN.

POST {runner_url}/workbench/step requires Bearer runner credential and carries:

{
  "jobId": "<stable id>",
  "goal": "<goal>",
  "mode": "goal or plan",
  "phase": "plan|implement|repair|test|redteam|audit",
  "repo": "<selected authorized repository>",
  "plan": [],
  "attempt": 0,
  "policy": {"mode": "request|auto|full|custom", "...": "..."},
  "skills": [
    {"id":"architecture","version":"1.0.0","scope":["task.run"]}
  ],
  "context": {"lastResult": "..."},
  "requirements": {"evidenceDigests":true,"independentVerifier":false}
}

Expected response:

{
  "ok": true,
  "summary": "Actual execution performed",
  "evidence": [
    {"type":"test","digest":"64-character SHA256 hex","location":"evidence/test.json"}
  ],
  "plan": [
    {"title":"Implement module","role":"Builder","acceptance":"Reproducible test evidence"}
  ]
}

This is the FRONTEND bridge protocol; **not an assertion** that existing NCPA
native interfaces already conform. The owner must implement and independently
validate a trusted adapter in NCPA before claiming real autonomous delivery.
Skills are manifests with version/required scopes. Selecting a skill in UI
does not install code, grant permissions, or make the native skill executable.

## 3. Trusted usage and spend reservation

Only CIRO runtime/metering infrastructure may call these endpoints; do not
request or expose CIRO_BILLING_EVENT_SECRET in the browser.

Signature: for any JSON request, set:

  x-ciro-timestamp: UTC Unix epoch milliseconds as decimal
  x-ciro-signature: hex HMAC-SHA256(
    CIRO_BILLING_EVENT_SECRET,
    timestamp + "." + EXACT raw UTF-8 JSON request body
  )

The backend rejects missing/tampered signatures and stale timestamps
(5-minute tolerance). Unique event/reservation IDs ensure idempotency.
These three routes are reachable without a browser cookie **only because**
they independently verify the signature:

1. POST /api/workbench/commercial/billing/reservations
   {"reservationId":"compute-unique-001","estimatedCostUsd":"1.25"}

   Response indicates accepted or rejected. Budget admission fails closed
   if monthly/daily/per-run limits or existing reservations would be exceeded,
   if CWU/GWU rates are unknown or trusted metering is not configured.

2. POST /api/workbench/commercial/billing/ingest
   {
     "eventId":"meter-unique-001",
     "observedAt":"<ISO-8601 UTC>",
     "category":"chat|agent|tool|training",
     "model":"ciro",
     "unit":"CWU|GWU",
     "units":1000000,
     "receiptSha256":"<64 lowercase hex>",
     "reservationId":"compute-unique-001"
   }

   Authorization/ingest must be paired with real native measurement evidence.
   A signed summary alone is not proof of authentic GPU consumption. Provider
   prices are configured using CIRO_BILLING_CWU_USD_PER_MILLION and the GWU
   equivalent; each receipt freezes the computed rate at ingest time.
   Unpriced events never count as free.

3. POST /api/workbench/commercial/billing/reservations/:id/release
   Signed JSON body for cancel/unused reserve.

Runtime hard spending limits require reserve BEFORE costly compute, use the
authorized amount to limit native work, and halt/abort *during* execution
when cost reaches the ceiling. The client backend alone cannot hard-stop
compute it does not control. Unsettled reservations expire after 20 minutes.

## 4. Stripe recurring subscriptions

Configure:
- CIRO_STRIPE_SECRET_KEY, CIRO_STRIPE_PRICE_ID, CIRO_STRIPE_WEBHOOK_SECRET;
- HTTPS CIRO_PUBLIC_ORIGIN; never a localhost URL in a public purchase flow.

Authenticated POST /api/account/subscription/checkout calls the real Stripe
Checkout Sessions API. Authenticated /subscription/portal calls Stripe Billing
Portal API. Customer checkout redirect is NOT evidence of payment.

Stripe should POST signed events to /api/account/subscription/webhook
(raw body and Stripe-Signature t/v1). Owner metadata on the subscription
and verified checkout client_reference_id/customer bind events to this owner.
The backend accepts only valid signed events, is idempotent, and handles
subscription/checkout webhook ordering. Run real Stripe test-mode checkout
and refunds in the merchant account before commercial launch; CI tests use
contract mocks and verified signature rejection, NOT actual charges.

## 5. Identity, memory and cross-device sync

- Server-enabled one-owner bootstrap, salted scrypt passwords, persistent
  hashed sessions, cookie CSRF/origin gating and revocable scoped API keys.
- The account store is an atomic JSON file, safe only for one owner and
  one server process. For public multi-user SaaS, migrate to transactional
  SQL with migrations, tenant isolation, signed migrations, backups, and
  per-tenant quotas. No public deploy using this file store.
- CIRO_ACCOUNT_DATA_KEY: stable random AES-256-GCM key; server uses it for
  user-managed memories and conversation/settings cloud snapshots.
- POST memories requires explicit user text and enabled consent flag before
  chat attaches any note. Memory text is non-authoritative reference material.
- GET /api/account/sync and PUT /api/account/sync use monotonically increasing
  server version. Updates with a stale baseVersion are HTTP 409, never silent
  lost updates. The client offers manual recovery and opt-in automatic
  2.2-second debounce plus 25-second remote polling. If snapshots diverge,
  it stops to request a human resolution instead of overwriting data.
  Wallpaper binary media are NOT synced and remain on device.

## 6. Activation and acceptance checklist

1. Frontend UI Node/security tests pass; desktop/mobile E2E and one real
   authenticated two-browser sync test pass.
2. Account bootstrap on loopback with fresh credentials, CSRF/cookie
   and API-key-negative tests pass; leaked/revoked keys remain rejected.
3. Encryption-at-rest tests verify plaintext does not appear in the state file.
4. Metering signature tamper, replay, time window and budget denial tests pass.
5. Native CIRO inference stream returns *actual* tokens in authenticated chat;
   deliberate backend outage yields visible error, not a fake answer.
6. Real CIRO Agent implementation runs a sandboxed multi-step project with
   scoped permissions, actual GitHub writes, independent red-team and receipts.
7. Native metering drives a reservation, actual compute, ingested receipt and
   exhausted-budget rejection; cancellation/over-limit mid-flight is audited.
8. Stripe test-mode merchant completes a checkout; verified webhook establishes
   subscription, tampered webhook is rejected; portal can manage it.
9. Two real devices on the same HTTPS account synchronize with conflict
   detection and consent, and password/key revocation works remotely.
10. For public SaaS replace single-process account/workbench JSON stores with
    transactional per-tenant persistence and full operational security review.

**Never classify the overall system as production-ready merely because the
frontend API and mocked integration contract tests are green.**

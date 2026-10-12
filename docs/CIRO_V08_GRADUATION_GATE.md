> **Historical pre-merge snapshot (2026-10-11).** The PR and CI statements below describe that earlier checkpoint, not current state. Plugin PR #2 has since merged into `feat/ciro-chat-client-v1`. On 2026-10-12, live Postgres RLS role simulation passed on the free Supabase acceptance project; real signed-user OAuth/MCP E2E and commercial release remain unqualified. Current evidence: `docs/CIRO_V08_RELEASE_RECEIPT.json` and `docs/CIRO_V08_SUPABASE_RLS_EVIDENCE_2026_10_12.md`.

# CIRO V0.8 / plugin marketplace — pre-release evidence (2026-10-11)

**Verdict: NOT GRADUATED.** This file deliberately distinguishes source-code implementation from verified operation. A draft PR exists against the existing V0.7 branch; no merge or release has occurred.

## Implemented / committed

- In the existing CIRO left navigation, open **Plugin Center**. Its left pane lists per-user installed plugins and supports disabling, re-enabling and uninstalling; its right pane shows the curated marketplace with discovery, categories, descriptions and permission review.
- Install is a user-driven, authenticated browser-only, session-bound two-step flow; a model or agent cannot invoke installation APIs. Version + permission fingerprint and nonce are validated once and expire.
- A central gateway refuses calls for uninstalled, disabled, disconnected or out-of-scope plugins. Client APIs cannot spoof `source: "chat"` or `source: "agent"`.
- GitHub OAuth: user-initiated authorization, state tied to session, encrypted credentials, expiry-aware refresh, scoped read/create-branch/write tool implementation, server repository allowlist, manual approvals and provider-grant revocation on disconnect/uninstall.
- Supabase: secure **operator-deployed user/RLS-scoped** MCP Edge Function integration with Supabase Auth OAuth 2.1 + PKCE and rotating user JWT, MCP Streamable HTTP initialization, discovery and allowlisted tool calls. The official Supabase developer/admin MCP is expressly NOT used for end-user access. Supabase marketplace installation remains disabled without an exact project, registered client, operator RLS verification and explicit tool allowlist.
- Chat: bounded structured model `tools` round trip with safe result refeeding, one-shot approval stop and no access to OAuth tokens. Agent: short-lived capability bound to owner, active job and repository; server revalidates policy and install/connection before use.
- V0.7 server-wide GitHub token endpoints are disabled for authenticated accounts to prevent bypass of the installed-plugin gateway. In-flight network requests are aborted on disconnect, disable or uninstall.

## Test evidence available in this session

- New server and test `.mjs` source files: successfully parsed by V8 static compilation with ESM imports/exports stripped for syntax checks. This is not an actual Node project build.
- Exact repository `plugin-chat-runtime.mjs` logic: tool call -> tool response -> final model answer PASS; unregistered function refusal PASS, using injected mocks.
- Exact repository `mcp-client.mjs` logic: initialize, session binding, tools/list, tools/call, DELETE cleanup PASS with an injected fake HTTP transport.
- Exact repository `plugin-install-store.mjs` logic: explicit confirmation, session match, owner separation, persisted reload, uninstall PASS with an injected filesystem.
- Tests authored for additional OAuth/agent/gateway behaviors; **these tests have not been run under `npm test`**.
- On latest branch commit at time of this report, GitHub commit workflow listing showed no completed CI run.

## Graduation blockers (hard stop)

1. Run `npm test`, `npm run build` and `npm run test:e2e` against the **exact candidate commit**. A CI workflow targeting the V0.7 feature branch has been added, but a started/completed run was not yet confirmed.
2. Verify live GitHub OAuth with a registered app, real account and non-production allowlisted repository. Cover OAuth state replay, account isolation, expiring token refresh, branch changes, append/create/update, account disconnect, provider revocation and concurrent uninstall.
3. Deploy and externally assess an RLS-protected, **non-admin** Supabase MCP Edge Function, register confidential OAuth client, verify user-scoped rows, cross-user access denial, token rotation and revocation, timeout and response-size limits. **No operator assertion alone counts as independent RLS evidence.**
4. Supply and run an independent security test for prompts injected through tool output, attempted provider override, model tool name spoofing, forbidden tool args, user switching, reconnect races, pending approvals, duplicate side effects and store concurrency.
5. Replace single-process JSON state and in-memory scheduler where needed before public multi-tenant commercial launch. Require transactional storage, durable jobs, idempotency keys, tenant ownership, encryption key rotation and failure recovery.
6. Third-party signed executable plugin packages and developer publishing are not implemented. The current marketplace installs pre-integrated adapters, **not arbitrary executable code**. A safe distribution format, content digest verification, sandbox execution and extension API require separate acceptance.
7. Gmail, Google Drive, Calendar and browser plugins are listed for future expansion, not connected or validated. Do not advertise them as usable.

## Release decision

Do not merge PR #2 or mark V0.8 production ready until the above evidence exists. Preview UX and code may be reviewed in the draft branch. Absence of third-party keys/user authorizations is not test success.

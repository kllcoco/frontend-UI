# CIRO V0.8 — Live acceptance and release runbook

Release scope: frontend-UI branch feat/ciro-v08-plugin-marketplace, PR #2.
Status: developer candidate, NOT certified for public multi-tenant operation.

## User-facing invariant

A user personally chooses a plugin in the market, reviews its permissions, confirms the installation, then authorizes the provider account separately. Installed plugins appear on the left; market discovery is on the right. Conversation/Agent requests cannot install plugins. A disabled, uninstalled, disconnected, wrong-tenant or wrong-resource plugin must never execute.

External GitHub writes and Supabase mutations require separate explicit approval even in Full Access mode. The gateway returns only bounded tool output, never OAuth credentials. GitHub approvals include destination repository/branch/file and a hash of the content rather than plaintext.

## Data-only downloaded marketplace packages

The operator may configure CIRO_PLUGIN_REGISTRY_ORIGIN (trusted HTTPS),
CIRO_PLUGIN_REGISTRY_HOST_ALLOWLIST (exact trusted host) and
CIRO_PLUGIN_TRUSTED_KEYS_JSON (mapping publisher.keyId to pinned Ed25519 public key).
The market downloads a signed data-only manifest, verifies signature, expiry, identity and exact built-in adapter capability, then requires user confirmation. No signing private key belongs on CIRO servers or in Git history. Any manifest describing arbitrary executable code or an unregistered adapter must fail closed. This does not yet qualify third-party executable plugins.

## Supabase customer OAuth/RLS integration

An example user-authenticated MCP Edge Function is provided at supabase/functions/ciro-mcp/index.ts, with a dependency-free protocol handler in mcp-core.mjs. It uses a Supabase publishable key with a request-local client bound to a verified OAuth user token, never an admin/service-role credential. The only tools are list_notes and idempotent create_note on a user-scoped example table.

1. The explicitly authorized non-production project is now `ciro-v08-acceptance` (`idlqjltdqxgeyaitldoo`) in the existing **Free** Ciro organization. Do not create a second project or enable billable resources.
2. The reviewed SQL from `supabase/sql/ciro_plugin_notes_rls.sql` has been applied to the authorized test project; `ciro-mcp` v2 is deployed with `verify_jwt=true`. Real Postgres RLS/role simulation assertions were rerun directly from the repository's `supabase/tests/ciro_plugin_notes_rls_acceptance.sql` and passed, then rolled back (0 users/0 notes). **This is NOT genuine OAuth-token evidence.** See `docs/CIRO_V08_SUPABASE_RLS_EVIDENCE_2026_10_12.md`.
3. Enable the currently free Supabase Auth OAuth 2.1 server from the project dashboard, set the authorization path and build an explicit **human-visible login/consent UI** at the owned HTTPS Site URL, then register an explicit confidential client with an exact HTTPS callback ending in `/api/plugins/supabase/callback`. **The 2026-10-12 audit found 0 registered OAuth clients, 0 users, and 0 consents.** Do not reuse service-role or secret keys in the browser or MCP handler. Stop if the dashboard requests payment or plan upgrade.
4. Configure only server-side `CIRO_SUPABASE_PROJECT_REF=idlqjltdqxgeyaitldoo`, `CIRO_SUPABASE_OAUTH_CLIENT_ID`, `CIRO_SUPABASE_OAUTH_CLIENT_SECRET`, `CIRO_SUPABASE_MCP_TOOLS=list_notes,create_note`, and `CIRO_PUBLIC_ORIGIN`. Keep `CIRO_SUPABASE_MCP_RLS_VERIFIED=false` until independently verified using **real** signed per-user JWTs, real CIRO callback and cross-user HTTP/MCP access tests. Do not enter provider secrets/tokens in chat or Git.
5. With TWO distinct consenting test users and their OAuth access tokens held only as environment variables CIRO_SUPABASE_TEST_USER_A_TOKEN and CIRO_SUPABASE_TEST_USER_B_TOKEN, run: node scripts/verify-ciro-supabase-mcp.mjs. Its token-free JSON report checks invalid-token denial, non-admin tool discovery, per-user write, repeated idempotency key, cross-user read denial, and unauthorized owner-field rejection.
6. Independently verify expired token, refresh, revoke, concurrency and restart. A claim or config flag alone is never evidence of working RLS.

## GitHub live acceptance

Register an OAuth App with callback ending in /api/plugins/github/callback and enter ID/secret only on the server. Use an allowlisted disposable repository, not production; opt in to CIRO_GITHUB_WRITES=true only during authorized test. Verify install -> connect -> consent -> read -> separate write approval -> branch/file write -> audit -> disable -> disconnect -> upstream revoke -> subsequent denial. Try replayed OAuth state, wrong browser session, wrong repo, expired approval and mid-flight uninstall. Unit tests against a fake provider do not replace this real-grant check.

## Key rotation

The plugin credential store supports CIRO_ACCOUNT_DATA_KEY_PREVIOUS as a temporary server-only old 32-byte Base64 AES key while CIRO_ACCOUNT_DATA_KEY holds the new current key. First credential access re-encrypts old secrets inside a SQLite transaction without broadening their grants, and logs a rotation event. OAuth/approval intents fail closed and must be repeated. CIRO account memory/sync encrypted with the same account key must be migrated under a separate verified plan; plugin migration is NOT whole-account migration.

## Release hard gate

The account subsystem remains single-owner, even though plugin state and OAuth approvals now use SQLite WAL transactions. CIRO_DEPLOYMENT_MODE=production and CIRO_PUBLIC_MULTI_TENANT=true are rejected at startup. Single-host SQLite is not a substitute for a multi-tenant identity/data/queue system. Public commercial launch requires a real transactional multi-tenant auth backend, durable jobs/idempotency, key lifecycle, external provider evidence, multi-tenant attack matrix and independent signoff.

## Evidence and status

Record exact commit SHA, CI test counts, build and browser E2E, the live GitHub OAuth test, the external Supabase two-user RLS test, signing key verification and independent red-team results. Each result should be labelled PASS, FAIL or NOT RUN. Do not merge or call V0.8 publicly graduated until the mandatory external and production gates are met.

# CIRO V0.8 — Supabase live database RLS evidence (2026-10-12)

## Exact target

- Repository: `kllcoco/frontend-UI`; merged V0.8 plugin PR #2 on 2026-10-11; base `feat/ciro-chat-client-v1`.
- Project: `ciro-v08-acceptance` (`idlqjltdqxgeyaitldoo`), Ciro organization's existing **Free** plan, `eu-west-1`.
- Project verification: `ACTIVE_HEALTHY`, Postgres 17; `ciro-mcp` Edge Function **version 2, ACTIVE**, `verify_jwt=true`.
- Reproducible source: `supabase/tests/ciro_plugin_notes_rls_acceptance.sql`, Git blob `c818b90aaa8f71f1007ebfd88e1e04cacd1df95e`.
- Cloud execution: Supabase `execute_sql` against this exact project on 2026-10-12, from freshly fetched repository SQL. Result string: `PASS_SQL_ROLE_SIMULATION_ONLY; NOT_REAL_OAUTH_OR_HTTP`.

## PASS — real Postgres, simulated identities

The SQL harness changes transaction-local Postgres roles and simulated `request.jwt.claim.sub`, with two temporary `auth.users` fixtures and ownership-scoped notes. It asserts:

1. Simulated A can SELECT and INSERT A's own notes, but cannot see B's notes or INSERT on B's behalf.
2. Simulated B sees only B's notes and can use the same idempotency key as a different owner.
3. A duplicate `(owner_id, client_op_id)` is rejected; authenticated UPDATE/DELETE privileges are absent.
4. Unknown user C and authenticated-with-missing-sub see no rows; missing-sub cannot insert.
5. `anon` cannot SELECT/INSERT, including when a spoofed sub claim is set.
6. A deliberate rollback sentinel removes every ephemeral user and note. Follow-up SQL confirmed 0 `auth.users` and 0 `ciro_plugin_notes` rows.
7. The table retains `rls_enabled=true` and `force_rls=true`. Supabase security advisor reported zero lint notices on this inspection.

**Scope limit:** This is NOT a genuine OAuth/HTTP/MCP or independently authenticated two-human-user test. No end-user access tokens were generated or copied to ChatGPT. Simulating a JWT claim inside SQL tests policy behavior, not JWT cryptographic validation or API gateway routing.

## NOT RUN — external and commercial release gates

- OAuth 2.1 confidential client registration: **0 records** in `auth.oauth_clients`.
- End-user Auth identities: **0 records** in `auth.users` after rollback.
- OAuth consent records: **0 records**. Supabase Auth OAuth server enablement and consent UI have **not been verified**.
- Live anonymous/invalid JWT HTTP denial, two actual user JWTs, MCP initialize/tools list/write/read, refresh, revoke, expired token, replay, concurrency: **NOT RUN**.
- GitHub real-user OAuth, dedicated Linux/TLS installation, independent red team and public multitenant GA: **NOT RUN**. PR merge and green code CI do not establish these gates.

## Safe next actions (no paid infrastructure)

1. Operator opens [Supabase OAuth Server settings](https://supabase.com/dashboard/project/idlqjltdqxgeyaitldoo/auth/oauth-server), enables the beta feature only while it remains free, and configures an owned HTTPS Site URL plus user-visible consent UI at a verified Authorization Path (for example `/oauth/consent`).
2. Register a confidential OAuth client for CIRO with exact callback `https://<CIRO_HTTPS_HOST>/api/plugins/supabase/callback`. Do not use wildcard redirect URIs.
3. Store `CIRO_SUPABASE_OAUTH_CLIENT_ID` and `CIRO_SUPABASE_OAUTH_CLIENT_SECRET` only in the trusted CIRO server environment, with `CIRO_SUPABASE_PROJECT_REF=idlqjltdqxgeyaitldoo`. Never put tokens or secret keys in Git, a browser, this chat or an artifact.
4. Keep `CIRO_SUPABASE_MCP_RLS_VERIFIED=false` until two consenting *real* users complete the existing trusted-terminal `node scripts/verify-ciro-supabase-mcp.mjs` and independent HTTP/refresh/revoke tests pass.
5. The test project remains on Free. Stop if any configuration step requests an upgrade, payment, paid resource or billable hosted deployment.

**Decision:** `LIVE_DB_RLS_ROLE_SIMULATION_PASS`, `REAL_OAUTH_AND_MCP_E2E_NOT_RUN`, `NOT_GRADUATED_FOR_PUBLIC_COMMERCIAL_RELEASE`.

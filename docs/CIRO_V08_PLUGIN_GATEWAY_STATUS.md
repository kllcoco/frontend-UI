# CIRO V0.8 plugin gateway — implementation status

This change extends the existing V0.7 application. It does not replace the Workbench or the signed marketplace.

## Implemented in this branch

- `server/plugin-connection-store.mjs`: per-principal encrypted provider tokens (AES-256-GCM through the existing account key), OAuth state, one-shot approvals, local revocation and bounded audit.
- `server/plugin-gateway.mjs`: a centrally routed tool invocation boundary with repository allowlist, Workbench policy checks, and scoped GitHub read/branch/write operations.
- GitHub OAuth App authorization-code round-trip for authenticated browser sessions. OAuth starts with a CSRF-protected POST. Callback binds a single-use state to the browser session.
- `/api/plugins/catalog`, `/api/plugins/invoke`, `/api/plugins/approvals/:id`, `/api/plugins/:provider/disconnect` and GitHub OAuth endpoints.
- Existing Workbench plugin tab now shows provider connection status, verified read requests, approval queue, and audit.
- New regression test source `tests/plugin-gateway.test.mjs`; not yet executed in this environment.

## Current restrictions

- GitHub OAuth requires a configured OAuth App, HTTPS public origin, enabled CIRO accounts, and the existing stable 32-byte encryption key. GitHub allowed repositories and server-side write opt-in still apply.
- Supabase is listed as a future provider but intentionally **fails closed**. Production-safe user-scoped OAuth and MCP session transport are not implemented. A Supabase admin/service-role secret must not be reused for customer connections.
- The signed Studio marketplace is **not executable** through this gateway yet. Installing a manifest does not confer plugin execution permission.
- The chat proxy has not been given a model tool-call loop. Requests can currently reach the gateway through its explicit API; Agent integration is not yet certified.
- JSON file persistence remains a single-process development backend. Do not deploy this as a multi-user commercial control plane. Concurrent writes, durable queues, refresh-token rotation, remote revocation, upstream disconnect and browser sandboxing remain outstanding.
- `disconnect` removes local credentials and pending approvals; revoke upstream app authorization separately.
- Tests/build have not been run in the current execution environment; this is a development branch, **not V0.8 acceptance**.

## Required verification before merge or release

1. Run `npm install --no-audit --no-fund --ignore-scripts`, `npm test`, and `npm run build` in a clean trusted checkout.
2. Exercise real GitHub OAuth with approved OAuth redirect, initial login, state replay rejection, missing session rejection and removal/revocation.
3. Verify branch/file writes in a disposable allowlisted test repository only. Reject wrong repo, wrong user, changed policy, changed connection generation, rejected/expired/replayed approval and protected branch.
4. Test restart behavior, user isolation, timeout, network failures, provider error payloads, encryption key rotation and concurrent requests.
5. Implement remote OAuth grants and MCP initialize/tools/list/tools/call state machine, allowlisted tool schema and resource scopes, abort and timeout controls, logs and cancellation.
6. Wire structured model tool calls through the gateway in chat and delegated agents; apply side-effect approvals at the final execution boundary.
7. Replace the JSON development store with transactional production storage and durable worker infrastructure, then perform full integration/security verification.

## GitHub OAuth configuration

- `CIRO_ACCOUNTS_ENABLED=true` and a working HTTPS `CIRO_PUBLIC_ORIGIN`
- `CIRO_ACCOUNT_DATA_KEY` — a stable 32-byte Base64 AES key, never exposed to browser
- `CIRO_GITHUB_OAUTH_CLIENT_ID` and `CIRO_GITHUB_OAUTH_CLIENT_SECRET` — set on server only
- OAuth callback `https://YOUR_DOMAIN/api/plugins/github/callback`
- `CIRO_GITHUB_REPOS=owner/repo` with explicit repository allowlist
- `CIRO_GITHUB_WRITES=true` only for approved non-production use

No provider token should be committed, sent to the frontend, or written to audit events.

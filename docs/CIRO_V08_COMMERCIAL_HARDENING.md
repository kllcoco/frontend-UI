# CIRO V0.8 commercial hardening — durable plugin operations

This is a **source implementation and candidate qualification** document, not a public-commercial release certificate. PR #2 remains drafted against the existing V0.7 client.

## Product boundary (accepted)

- Users must explicitly choose, install, authorize and uninstall plugins in the plugin center. Chat/Agent actions cannot install plugins.
- Each installed plugin has a scoped OAuth grant and an independent installation generation.
- Read-only background work must survive a worker restart without losing tenant ownership.
- **Any provider mutation remains independently human-approved.** A worker crash or deadline must never automatically repeat an uncertain write.
- Provider tokens and queued tool arguments/results are encrypted, not embedded in chat or logs.
- CIRO's current account/workbench model is **single-owner**, not qualified multi-tenant. Keep the public multi-tenant startup refusal.

## New queue and ledger

The SQLite WAL control database (\`plugin-control.sqlite\`) now contains an additional transactional \`plugin_jobs\` document. Its jobs are bounded and keyed by owner and caller-supplied idempotency key. Every job pins the installed-plugin generation, connection generation and policy digest. New attempts reread authoritative install, connection and policy state **immediately before side effects**.

Allowed automatic background jobs:

- \`github.read_file\` — bounded repository read.
- \`supabase.list_tools\` — bounded discover-only operation, if the customer-scoped MCP endpoint has been separately qualified.

External GitHub writes, branch creation and Supabase mutations continue through one-shot human approvals. Approved writes now receive an immutable *execution ledger entry* and a foreground lease before dispatch. They are **never picked up by the automated read worker**.

The queue stores safe summaries and encrypted results. It does not store OAuth tokens. Terminal statuses: \`succeeded\`, \`failed\`, \`cancelled\`, or \`uncertain\`. An expired write lease transitions to \`uncertain\`; an operator must reconcile the actual provider state. Safe reads may retry at most three times. Canceling an in-flight action requests cancellation but cannot undo a request already accepted by GitHub or Supabase.

## Operator configuration for a single-owner limited pilot

- Node.js 22+ on one trusted host, local persistent SSD (not NFS) for the SQLite WAL state.
- Stable server-side \`CIRO_ACCOUNT_DATA_KEY\`; never send keys, sessions or OAuth tokens to the frontend or issue comments.
- \`CIRO_DEPLOYMENT_MODE=single-owner\`, \`CIRO_ACCOUNTS_ENABLED=true\`, \`HOST=127.0.0.1\`.
- Terminate TLS at a trusted reverse proxy; set \`CIRO_PUBLIC_ORIGIN\` to the exact HTTPS origin.
- Start the app with \`npm start\`, and separately supervise the durable read worker with \`npm run worker:plugins\`. Both MUST use the same \`CIRO_WORKSPACE_DATA_DIR\` and encryption key.
- The dedicated worker has no public HTTP port or account administrator token.
- Stop the worker before key rotation and before moving state to another machine, then verify SQLite WAL checkpoint, permissions and restart.
- A limited pilot must still complete **real** GitHub OAuth/approved write tests (and Supabase if advertised) in a disposable scope. Passing mock tests alone does not authorize charging customers for unverified integration.

## Evidence matrix / release gates

| Gate | Source state | Independent gate |
|---|---|---|
| Manual store + sign/permissions | Implemented | CI + browser E2E |
| Per-user encrypted provider grants | Implemented | Real OAuth and revocation |
| Transactional install + approval | Implemented | Two-worker contention and restart |
| Durable background read + ledger | Implemented in this candidate | Multi-worker/recovery CI and supervised-worker smoke |
| Live Supabase OAuth/RLS | Server/SQL written, not deployed | Two independent authorized test users on a real Supabase project |
| Multi-tenant account + Workbench + Studio | Not implemented | Cross-tenant identity and per-resource attack matrix |
| Public commercial release | Blocked by startup gate | Production identity/queue isolation, ops response and independent security acceptance |
| Arbitrary downloadable executable plugins | Not implemented | Independent sandbox/signature/developer qualification |

**No lowering of the original public-multi-tenant graduation standard.** A restricted single-owner pilot is a separate commercial edition, not evidence that the general-purpose plugin marketplace is ready for paying consumers.

## Validation and deployment sequence

1. Exact candidate checkout: \`npm install --no-audit --no-fund --ignore-scripts\`, \`npm test\`, \`npm run build\`, \`npm run test:e2e\`.
2. Verify that multiple independent queue instances observe one job claim, owner separation and idempotency key replay/conflict.
3. Kill a read worker mid-lease; on restart the read may retry. Kill a write mid-lease; after expiry it MUST be \`uncertain\` and MUST NOT replay.
4. Uninstall a plugin, rotate its OAuth generation or change policy with an outstanding job; subsequent execution MUST be denied.
5. Run real provider authorization in a non-production repository and the two-user Supabase RLS checks before any corresponding user-facing commercial promise.
6. Independent security reviewer signs the exact release code hash. Do not merge/release if the checks fail.

This queue is **single-host SQLite**, not proof of distributed database operation across separate hosts. The existing account and workbench state remain single-owner, and public multi-tenant mode must remain blocked until they are replaced and independently qualified.

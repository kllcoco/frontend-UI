# CIRO V0.8: dedicated single-owner enterprise pilot

**Scope: one paying customer / one isolated Linux machine / one CIRO owner account.**
This is a safer, smaller commercial rollout route than sharing the current single-owner Workbench/Account/Studio service across unrelated customers. It does **not** graduate CIRO as a public shared multi-tenant SaaS.

## Why a dedicated instance

The current frontend-UI Account and Workbench stores are single-owner. SQLite transactions harden plugin installs, OAuth grants, approvals and durable job receipts, but they **do not** magically make the entire application multi-tenant. A dedicated operating-system and host boundary keeps different customers on separate processes, filesystem roots, credentials, provider grants, and databases. The hard gate refusing \`CIRO_PUBLIC_MULTI_TENANT=true\` stays in place.

Never install two unrelated customers into one instance or use the same CIRO encryption key across customers.

## Deployment requirements

- Dedicated Linux VM/host, up-to-date Node.js 22+, systemd, private SSD and a TLS-terminating reverse proxy you operate and monitor.
- One unprivileged \`ciro\` account per host with code under \`/opt/ciro/frontend-UI\`.
- Create \`/etc/ciro/ciro.env\` owned by root, mode \`0600\`. It contains **only server-side secrets**. Never commit it, put it in command history, or paste it into ChatGPT.
- Set \`CIRO_DEPLOYMENT_MODE=single-owner\`, \`CIRO_ACCOUNTS_ENABLED=true\`, \`HOST=127.0.0.1\`, \`CIRO_WORKSPACE_DATA_DIR=/var/lib/ciro\`.
- Configure \`CIRO_PUBLIC_ORIGIN=https://<a dedicated customer domain>\`, a working \`CIRO_API_BASE_URL\`, a stable 32-byte Base64 \`CIRO_ACCOUNT_DATA_KEY\`, GitHub OAuth ID/secret, and an explicit disposable/prod-appropriate \`CIRO_GITHUB_REPOS\` allowlist.
- Configure a **real** GitHub OAuth App with the exact callback \`https://<customer-domain>/api/plugins/github/callback\`. Only an authorized user should complete this interactive consent flow.
- Enable a Supabase plugin only once a real non-admin OAuth server, RLS-bound MCP Edge Function, and independent two-user RLS assessment pass. Never put a \`service_role\` key in CIRO.
- Use a trusted reverse proxy serving HTTPS to internet clients and forwarding to the app's *loopback-only* port. Audit forwarding headers, origin, HSTS, certificate renewal, request body limits, and provider redirect URIs before service activation.

The supplied systemd templates at \`deploy/ciro-single-owner-api.service\` and \`deploy/ciro-single-owner-worker.service\` illustrate a restricted operator deployment. Adjust paths and Node binary to the actual host only after security review. Both services use \`StateDirectory=ciro\`, \`UMask=0077\`, and the same \`CIRO_WORKSPACE_DATA_DIR\`.


## First-owner bootstrap (must happen BEFORE routing public traffic)

A fresh installation has no owner. Initial owner creation is protected by the **one-time** server-side \`CIRO_BOOTSTRAP_TOKEN\`; do not expose a new instance to the public reverse proxy before bootstrap. On a private loopback or restricted operator-only connection, bootstrap one real owner using a strong one-time token and password. The service account must write the private \`account-state.json\`; the operator should then **remove** the bootstrap token from the persistent systemd environment.

Only after the owner record is present and \`node scripts/verify-ciro-single-tenant.mjs\` reports PASS should the trusted TLS reverse proxy forward external traffic. Bootstrap credentials, cookies and OAuth secrets must never appear in shell history, tickets or GitHub.

## Preflight and start

Run from the checked-out exact candidate:

\`\`\`bash
npm install --no-audit --no-fund --ignore-scripts
npm test
npm run build
npm run test:e2e
node scripts/verify-ciro-single-tenant.mjs
\`\`\`

The preflight is deliberately **fail-closed** on missing private state, OAuth app configuration, stable encryption key, HTTPS origin, model endpoint, Linux isolation and unsafe permissions. It prints *only* sanitized failure codes and warnings.

Start the API and dedicated plugin reader worker with the appropriate supervised systemd units. During local operator testing, \`npm start\` and \`npm run worker:plugins\` are separate processes. The worker cannot accept inbound HTTP connections and can only auto-process read-only jobs. If it dies mid-write, write outcome is \`uncertain\`, not replayed.

## External live acceptance (mandatory for any paying pilot)

1. **GitHub:** install in the market -> user clicks OAuth connect -> verify the actual signed-in identity -> read disposable repository -> request a write -> explicit human approval -> confirm resulting commit -> disconnect and confirm provider grant revocation -> reject subsequent attempts. Verify cross-account, wrong repo, token expiry and callback replay.
2. **Supabase (only if advertised):** deploy the example MCP/RLS implementation to a user-approved project, run the two-user \`scripts/verify-ciro-supabase-mcp.mjs\` test with separately consenting accounts, then independently audit RLS, expiry and revoke behavior.
3. **Recovery:** restart both services and verify installed plugins, encrypted grants, approvals and read job queue. Simulate an uncertain write and reconcile it from the real provider state rather than rerunning it.
4. **Independent reviewer:** sign the exact commit SHA, live provider evidence, reverse proxy/TLS checklist, restore test, secrets audit and incident runbook.

**A PASS from \`verify-ciro-single-tenant.mjs\` is not a provider or penetration-test PASS.** It only confirms that basic operator configuration passes prerequisite checks.

## Commercial edition decision

- **Dedicated Enterprise Pilot:** can be evaluated independently after all live, security, operational and contract gates pass for one named customer.
- **Shared CIRO Plugin Marketplace GA:** remains blocked. A genuine shared multi-tenant identity boundary, tenant-scoped Workbench/Studio and permission graph, audited distributed job execution, third-party isolated plugin runtime and independent red-team sign-off are required.
- **Do not sell non-operational GitHub/Supabase connectivity or arbitrary downloadable executable plugins** until each capability has its own completed acceptance evidence.

This dedicated topology can reduce time-to-first-customer without weakening the public release standard. No customer identity, OAuth key, database password or private data belongs in GitHub issues/PR comments.

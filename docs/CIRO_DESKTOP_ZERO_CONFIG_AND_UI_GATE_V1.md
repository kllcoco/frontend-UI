# CIRO Desktop v0.8 · Zero Configuration + All-Page UI Quality Gate

**Product directive (2026-10-12).** Windows installer must launch directly into a usable local client: no manual `.env`, bootstrap token, terminal, API key paste, or hidden setup instructions. Before asking the owner to rebuild, consolidate every page's styles and establish explicit visual/e2e coverage.

## UX acceptance contract

1. The installed Windows app derives its own **per-Windows-user** data directory; stable random AES-256 data key, API key pepper and bootstrap secret are created on first start. Existing records must never be reset on upgrade.
2. Electron alone starts the local child on `127.0.0.1:0`, never on all interfaces. The child provisions one local owner with a random non-disclosed password hash, then returns a one-time session token over **private Electron parent/child IPC**, not an HTTP bootstrap route.
3. Electron installs the session as an `HttpOnly`, `SameSite=Strict`, loopback-only cookie **before** first renderer navigation. A missing session must fail closed instead of displaying a useless manual onboarding form.
4. Account pages identify this as a **local-only owner**; do not show a fabricated cloud email, a change-password screen requiring an unknown random password, or a sign-out flow that strands a desktop user. Existing manually registered account identity remains unchanged.
5. Model inference is independent. If no verified NCPA runtime/model exists, desktop UI must say so; do **not** fake Ciro model responses. GitHub/Supabase plugin installation, permission scopes and any writes still require explicit user authorization.
6. Windows install/reboot/relaunch/uninstall must not delete user data or require the owner to use a command line. A native fresh-install smoke test must observe both the credential file and a real `owner.desktopLocal===true` persisted account state.

## Cross-page UI design standard

- Production main entrypoint must import `studio.css`: all ten Studio modules previously lacked their stylesheet due to an omitted import.
- Final shared `ui-foundation.css` applies responsive sizing, overflow-safe cards/forms/tables, dark-mode contrast for plugin marketplace, coherent action targets, keyboard focus indicators, and reduced-motion behavior.
- Scope covers Chat/welcome, Studio dashboard and its 9 special areas, Workbench, Settings, Account & Security, Memory, Notifications, Sync, Billing, Official Apps, Skills, Plugin Center, and small-screen layouts.
- Automated browser audit takes screenshots and checks viewport overflow and loaded Studio computed layout across major pages. **Screenshots are evidence to inspect, not automated aesthetic approval.**
- No arbitrary permission changes, arbitrary plugin code execution, silent NCPA model download, unexpected charges or claims about an unverified native inference backend.

## Evidence and release gates

| Gate | Engineering evidence | As of this commit |
| --- | --- | --- |
| Account automatic provisioning | `server/account.mjs`, `server/index.mjs`, `desktop/runtime.cjs` | Source candidate modified, validation NOT RUN |
| Native HttpOnly login | `desktop/main.cjs` and `tests/desktop-shell-contract.test.mjs` | Source candidate modified, validation NOT RUN |
| Local account persistence/migration | `tests/desktop-auto-provision.test.mjs` | Test added, NOT RUN |
| Studio root styling and responsive consistency | `src/main.tsx`, `src/studio.css`, `src/ui-foundation.css` | Source candidate modified, visual QA NOT RUN |
| Per-page screenshot/overflow regression | `tests/e2e/ui-coverage.spec.ts` | Test added, NOT RUN |
| Windows installer smoke | `scripts/accept-ciro-windows.ps1 -InstallInDisposableSession` (disposable Windows user ONLY) | Existing original smoke plus new owner assertion; NOT RUN |
| GitHub and native NCPA live integrations | Independent consent/evidence | NOT RUN |
| Public commercial release | Signed installer, independent security/UX review, real integration | NOT QUALIFIED |

**Historical evidence is not transferable.** The previous Windows `51378925ec9fe885563073070845890654593d4c` package (SHA256 `121ca1e54ada4004523548a69d3f516cad3e95463e69f87baba6fc167703cd3a`) passed Node/build/29 browser tests/NSIS packaging, but was **unsigned, not installed, and predates all of the above new source changes**.

The current source candidate must pass full Node + TypeScript/Vite + Playwright (including added coverage) and actual Windows first-run UI/installation before any equivalent PASS can be claimed. No paid CI/cloud build is authorized. Keep PR in Draft and do not silently merge.

## Architecture and rollback

- Desktop-only behavior uses a native launch gate; normal web/bootstrap/account flows stay explicitly authorized.
- Owner and encryption data on disk are not migrated or overwritten; existing web single-owner accounts retain their credentials.
- If automatic provisioning fails, native startup fails with a visible error; do not fall back to displaying its bootstrap token or disabling authentication.
- Rollback modifies app code, never deletes `userData` or original account records. The same credential schema is retained.

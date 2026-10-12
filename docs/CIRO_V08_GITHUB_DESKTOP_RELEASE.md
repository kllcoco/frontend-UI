# CIRO V0.8 — GitHub self-repair + Windows Desktop release candidate

**2026-10-12 | Scoped client application, not model-foundation graduation**

## Product decisions (accepted)

1. Priority: GitHub built-in plugin must be usable with CIRO's **own** account for internal engineering acceptance without waiting for customer onboarding.
2. In a **single-owner, loopback-only desktop** installation, offer a manually entered **fine-grained GitHub PAT** instead of requiring a GitHub OAuth App. Users create the token at GitHub, set short expiry and repository-only permissions. This is NOT using or exporting ChatGPT's GitHub connector credentials.
3. The CIRO model/Agent may **propose** scoped repository changes, but cannot install plugins or authorize its own account. Only the user can install, authorize, approve GitHub branches/files/PRs, and review/merge.
4. CIRO may read its own repository, create a `ciro/*`, `feature/*` or `repair/*` branch, write candidate files there, and open a **draft PR** in the exact designated self-repair repository, with a fresh one-shot approval for each side effect. No direct default-branch commits, auto-merge, force-push, secret access or blanket administrator access.
5. Desktop runs the existing CIRO React + Express client under an Electron shell with a loopback-only server, random port, isolated preload, blocked navigation, per-user encrypted state and a one-time owner bootstrap. Not an independent model or new inference backend.
6. Windows NSIS and portable packaging are source-supported, but **signed installer graduation requires a verified built artifact and actual Windows install/start/uninstall tests**. Installing Electron packages or running Windows Actions could use bandwidth/minutes, so an opt-in manual workflow is supplied but has NOT been executed.

## Internal GitHub self-repair acceptance (no OAuth App)

In a trusted CIRO Desktop installation:

- On first launch, open the local Ciro user-data directory and read `desktop-secrets.json`. Enter only its `bootstrapToken` into **账户中心 → 初始化管理员账户**. Preserve the entire key file securely: its `accountDataKey` encrypts persisted credentials and data. Do not share or commit it.
- The desktop creates a separate local `.env` with **no allowed GitHub repositories by default**. For our internal test, the owner explicitly sets `CIRO_GITHUB_REPOS=kllcoco/frontend-UI` and `CIRO_GITHUB_SELF_REPO=kllcoco/frontend-UI`. No installer grants access to our company repository automatically.
- Review the local `.env` and set `CIRO_GITHUB_WRITES=true`, `CIRO_GITHUB_SELF_REPAIR_ENABLED=true`, `CIRO_GITHUB_SELF_REPO=kllcoco/frontend-UI`; restart the app. Any write still requires separate human approval.
- At [GitHub Fine-grained PAT settings](https://github.com/settings/personal-access-tokens), issue a short-lived personal token for **only** `kllcoco/frontend-UI`, granting repository **Contents: Read/Write** and **Pull requests: Read/Write**, with no Administration/Actions/Secrets permissions. Never paste the token into ChatGPT, Git, logs, screenshots or a public server.
- In CIRO Plugin Center: install GitHub → select `kllcoco/frontend-UI` → enter the PAT in the **local password field** → verify reading `README.md`. The API checks real GitHub `GET /user` and `GET /repos/{owner}/{repo}` before encrypting it.
- Install the updated **GitHub v0.8.1** manifest explicitly. Old installs cannot inherit new directory/PR tools; uninstall and reinstall after reviewing the new tool list. Read-only `ciro_github_list_directory` can browse approved repository folders; `ciro_github_read_file` can read `main` or a safe explicit ref such as `feat/ciro-chat-client-v1`. The UI also has a read-branch box.
- Ask CIRO to read a bounded file, suggest a patch and create `ciro/qa-repair-...` from the **selected existing source branch** (`base` parameter) **only after explicit approval**; write the file into that branch **only after a separate approval**; open a **draft PR** through `ciro_github_open_pull_request` **only after another approval**. Review the complete diff, test outputs and permissions before manually merging.
- Disconnect the plugin and confirm subsequent requests fail. PAT connections remove the token **locally** on disconnect; unlike the app-managed OAuth grant, **GitHub cannot be forced to revoke this PAT by CIRO**: revoke it at the GitHub token settings as a separate manual step.

**Important:** The GitHub account currently connected to ChatGPT is sufficient for real GitHub repository actions in this conversation but **does not become a CIRO application token**. The new in-app PAT path requires the owner to authorize it inside CIRO; until that happens, it is coded/testable but **not live-provider accepted**.

## Desktop build and acceptance

Supported candidate: **Windows 64-bit**, Electron `44.7.0`, electron-builder `26.17.0`, per-user NSIS installer.

On a trusted Windows machine (not in an untrusted repository or customer environment):

```powershell
npm install --no-audit --no-fund
npm test
npm run desktop:win
```

Output location: `release/Ciro-Desktop-*-x64-Setup.exe` (only after a successful Windows build). No binary is committed to this repo. There is an additional opt-in manual workflow `.github/workflows/ciro-desktop-windows-manual.yml`, but do not run it before checking that GitHub Actions minutes are free for this account.

Acceptance checklist: NSIS installation on clean Windows → first boot and owner bootstrap → restart and key consistency → GitHub PAT auth in local UI → scoped read and one-shot write/PR approval → disable/uninstall/revoke → model backend configured and real inference stream (preview mode is **not** inference) → Windows app close kills backend → no LAN listener, no remote navigation/Node.js renderer access → NSIS uninstall preserves intentionally retained user data unless owner requests deletion → installer file SHA256 → code-signing/SmartScreen/AV review.

Source contract notes:

- `desktop/runtime.cjs`: securely generated, stable, owner-local secrets; no raw keys in Git. The desktop `.env` lives under Electron's user-data directory.
- `desktop/main.cjs`: Electron main process, per-launch random loopback port, child-process health handshake, restricted WebContents and notifications-only native bridge.
- `desktop/preload.cjs`: only fixed `ciro-native-shell.v1` handshake/notification methods; never forwards arbitrary filesystem or command execution.
- `server/index.mjs`: sends the selected loopback port to the native parent process.
- `server/plugin-gateway.mjs`: local-only, authenticated fine-grained GitHub PAT connection and one-shot draft-PR approval path.
- The backend still uses one-owner durable SQLite and account JSON; **not** public multitenant-ready.

## Pending GitHub approval preview — additional candidate patch

Branch: `ciro/approval-preview-gate-20261012` (kept separate for review).
An authenticated owner-session can request `GET /api/plugins/approvals/:id/preview`.
For file replacements this returns the whole proposed file, repository, branch,
path, prior file SHA (when provided), and a SHA256 binding of the immutable queued request.
Draft PR previews return full title, body, head and base.
Approval of write-file or draft-PR effects now requires the matching `reviewSha256`;
missing or mismatched values fail before claiming the one-shot approval.
The UI requires the operator to open the preview and explicitly acknowledge it.
This preview is **not** a diff or test evidence: it does not replace independent
tests, Windows installer verification, or live CIRO model acceptance.

Exact GitHub-blob-matched desktop/runtime, Electron main shell (with mocked Electron),
GitHub read-ref policy, draft-PR policy, and approval-preview sources and test files
were all checked and executed locally with Node 22, **12/12 PASS**. The checked-out
blob of `tests/desktop-shell-contract.test.mjs` was also verified against the
repository SHA. Run `npm run test:desktop-core` from the repository root to
reproduce these no-dependency smoke tests without installing packages.
This is an isolated/offline core smoke test: Electron itself is mocked for
the shell integration checks and real Windows installation is not exercised.
Full `npm test`, `npm run build`, browser E2E, Electron installation,
live CIRO GitHub PAT authentication and NCPA inference **remain unverified**.
No GitHub Actions run has been requested.

## 2026-10-12 follow-up: desktop launch/config isolation + fail-fast packaging

**Additional candidate patch in PR #5 (not merged):**

- `desktop/runtime.cjs` now removes inherited `CIRO_*`, `NODE_OPTIONS`,
  `NODE_PATH`, and `DOTENV_CONFIG_*` before launching CIRO's local backend.
  Security-fixed child flags remain explicitly set; optional application settings
  must come from the owner's desktop-local `.env`, not the parent shell.
- New `scripts/desktop-package-preflight.mjs` blocks an incomplete Electron package:
  it checks Electron startup resources, required bundled directories, ASAR,
  per-user NSIS scope, and (after build) `dist/index.html` plus production
  `express`/`dotenv` dependencies. Windows installer commands also require a
  Windows build host before starting compilation.
- `npm run test:desktop-core` now includes packaging preflight tests and the
  environment inheritance-denial test. **16/16 isolated tests PASS locally on
  Node 22.16.0, 0 failures.** Exact GitHub blob SHA verified for the four
  new/changed module/test files before recording the result.
- This is **not** a Windows exe or Electron integration test. No real GitHub
  CI, PAT-in-CIRO account login, complete npm test/build, or native NCPA model
  inference acceptance has been run for this branch.

Updated offline acceptance receipt:
`docs/CIRO_V08_DESKTOP_CORE_LOCAL_RECEIPT_2026-10-12.json`.

## Qualification state

| Gate | State |
| --- | --- |
| GitHub connector via ChatGPT operator account | Real GitHub repo read/write via connected connector has occurred, **not** CIRO in-app OAuth acceptance |
| CIRO GitHub repo read/branch/write source | Existing source and mocked integration tests were previously qualified |
| CIRO local fine-grained PAT + GitHub v0.8.1 read/PR source | Implemented on candidate branch; **16/16 scoped offline security/preflight tests PASS**, full Node suite/live CIRO login not yet verified |
| Electron shell / bootstrap / packaging configuration | Implemented in source, Windows-built installer **NOT RUN** |
| Native client signed installer / Windows E2E | **NOT RUN**, do not call graduated |
| CIRO inference backed by actual NCPA GEN1 runtime | **NOT VERIFIED**; preview UI isn't model inference |
| Supabase SQL policy role simulation | PASS on existing free test project; real OAuth-client/session path remains **NOT RUN** |
| Public shared SaaS commercial launch | **NOT GRADUATED** |

No new paid services, accounts or cloud projects have been created for this candidate. Do not upgrade Free services or trigger billable CI until the owner explicitly approves that cost.

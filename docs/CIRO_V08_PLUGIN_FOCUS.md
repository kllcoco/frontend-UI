# CIRO V0.8 — Plugin system focus (product decision 2026-10-11)

This document supersedes the previous tendency to treat **whole-platform public SaaS graduation**
as a prerequisite for finishing the V0.8 plugin center.

## Accepted product contract

The v0.8 deliverable is **CIRO's install-and-use plugin system**, not a new LLM architecture,
a general-purpose public multi-tenant SaaS platform or a Supabase product.

1. A user must open **Plugin Center** to discover and explicitly install an available plugin.
   A chat message or Agent cannot install, enable or authorize a plugin.
2. Installed plugins appear on the left; browse/search the marketplace on the right.
   The user can review requested permissions, confirm installation, suspend use, disconnect
   third-party accounts and uninstall.
3. Installation, OAuth authorization, repository/resource selection and high-risk
   execution approval remain separate steps.
4. A model or Agent can only discover and invoke installed, enabled, connected tools
   through the server tool gateway. OAuth secrets never enter model instructions.
5. Local revocation, approval replay rejection, scoped repository access and tool-call
   audit are required for plugin qualification.
6. GitHub is the first end-to-end sample; Supabase is a separately gated adapter.
   The presence of Gmail/Drive/Calendar placeholders is not a shipping claim.
7. No automatic paid infrastructure creation or billing-plan upgrades. The product owner authorized GitHub CI runs on 2026-10-11; keep CI targeted and evidence-driven.

## Scope of this focused slice

- The plugin catalog now returns the server-side **GitHub allowlisted repository choices,
  current selection, permission mode and whether writes are enabled**, without a user token.
- Signed-in users can pick an allowed repository inside Plugin Center. The UI calls the
  existing Workbench permissions endpoint, which pauses active work on policy changes.
  Switching a repository intentionally resets execution mode to **request per action**.
- Users no longer have to discover the V0.7 global server-token GitHub panel to activate
  a V0.8 per-user plugin.
- For authenticated clients, that old GitHub tab now redirects users to Plugin Center.
  The old screen remains only for explicitly unauthenticated V0.7 development/preview.
- Authorized Supabase users can see the discovered MCP tool catalog in Plugin Center;
  this action is **read-only discovery**, not permission to execute arbitrary tools.
- A new integration test reproduces the full GitHub sequence with a fake provider:
  manual marketplace install -> select allowlisted repository -> OAuth state and callback ->
  encrypted user grant -> direct/model read -> human-approved write once -> disable ->
  revoke and uninstall -> immediate denial.
- A browser test checks repository selection and the authenticated legacy-tab redirect.

## Test/evidence rules

The new lifecycle test uses **mocked GitHub/CIRO endpoints only** and cannot substitute
for a real external GitHub OAuth app. Do not call provider OAuth live without the
user's explicit action and a configured provider application.

**Plugin-center V0.8 code qualification is PASS** at exact tested commit
`a56a453c6c94d5b61a58bf38d35d74315cb4947d`.
GitHub Actions: https://github.com/kllcoco/frontend-UI/actions/runs/38158772169
**101/101 Node tests PASS, TypeScript + production build PASS, 29/29 Playwright PASS.**

The focus branch was fast-forwarded into existing draft PR #2
(https://github.com/kllcoco/frontend-UI/pull/2), based on
`feat/ciro-chat-client-v1`. The candidate code is not merged.
Real provider OAuth and public SaaS multi-tenant hosting are separate gates
and are not claimed by mocked automated test success.

The CI found and fixed two product defects: the installation-confirmation button
wrongly required the repository and OAuth configuration *before* install;
and the Workbench tab state diverged from the outer App route, preventing
navigation back to the plugin center. Both fixes passed the full browser suite.

## Graduation vocabulary

- **Plugin-engineering candidate:** implementation, automated tests and source docs exist.
- **Plugin V0.8 code qualification:** exact candidate passes tests, production build and E2E.
- **GitHub live integration:** a real connected OAuth account has performed an authorized
  read/write/revoke against a disposable repository under an operator-approved domain.
- **Public multi-tenant platform GA:** separate future program; not a criterion for the
  V0.8 plugin-center *engineering* qualification.

Safety boundaries for multi-user hosted products remain in place. Deferring those
requirements never means changing FAILED/NOT-RUN evidence into PASS.

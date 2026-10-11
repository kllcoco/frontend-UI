# CIRO V0.9 — Windows native installer (scope 1 only)

Deliver a double-click Windows NSIS setup executable containing the React/Vite frontend and Express API backend. No Node, npm, terminal, development server or CIRO model runtime is needed to launch the UI.

## Functional contracts

- Electron 44 and the application's production assets are bundled in one Ciro.exe, with Windows setup and uninstall, Start-menu/desktop shortcuts.
- Backend binds to a deterministic per-user loopback port and requires a freshly generated secret on every HTTP request. This preserves browser localStorage/cookies on restart while refusing unrelated local HTTP clients.
- Renderer sandbox, context isolation, no Node integration, no preload IPC or webviews; disallow untrusted navigation and open only approved HTTPS sites in external browser.
- Single-instance behavior and window maximize/restore, bounded saved window positions, native edit/zoom shortcuts and clean shutdown.
- App state in %APPDATA%\Ciro\state; settings and browser sessions in per-user profile. Uninstall never removes user private data.
- Optional private %APPDATA%\Ciro\ciro.config.env is read at launch; a harmless example file is generated in the same directory. Secrets are not bundled in the app.
- A separately supervised plugin read-only worker can start if the owner account system is explicitly configured.
- Browser PWA cache/service worker registration is disabled in the Electron user agent to ensure upgraded bundled JS is loaded.
- If the inference backend is not configured, the UI correctly says preview mode; neither live model nor real Agent connectivity is claimed here.

## Build from source (developer only)

Run on Windows with Node 22+: npm install, then npm run desktop:win.
Expected installer: release/Ciro-Setup-0.9.0-x64.exe. End users download and double-click the EXE; they do not run developer commands.

## Windows acceptance

1. All Node/security tests and production TypeScript/Vite build PASS.
2. Electron/NSIS produces a real Windows setup executable and unpacked Ciro.exe.
3. Unpacked Windows EXE starts embedded backend, checks static UI/status, denies API without token, and loads the renderer in a hidden BrowserWindow.
4. Silent NSIS install, execute installed Ciro.exe with the same smoke, uninstall, and verify private user state remains.
5. Publish installer + SHA256 in a downloadable GitHub Actions artifact. Verify exact source commit and job.

## Limits and release governance

- Real model inference, GitHub OAuth session, Supabase real user accounts and native Agent are separate tasks. Do not hide preview states.
- Windows developer preview is UNSIGNED; Microsoft SmartScreen can show warnings. Public signed release requires authentic publisher signing and real user-machine review.
- No auto-updater or macOS installer in this Windows-specific slice.
- Do not merge to main until Windows installer acceptance succeeds; do not equate a web CI PASS with Windows installer PASS.

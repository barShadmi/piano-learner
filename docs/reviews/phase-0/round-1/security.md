# Security and privacy · phase 0 · round 1
Score: 7/10. No Blocking items.

Held up: contextIsolation/nodeIntegration off/sandbox, minimal preload, window.open denied, no remote content, CSP in built html, no secrets in history, all versions pinned, lockfile from npm registry with integrity, CI read-only token, no pull_request_target, `npm audit --omit=dev` 0.

Polish:
1. `src/main/index.ts:4,19,49-50` · Read ELECTRON_RENDERER_URL, PIANO_SCREEN, PIANO_THEME only when `!app.isPackaged`.
2. `src/main/index.ts:20,42-44` · isAppUrl accepts any file: URL; compare against the exact app index.html file URL; guard will-redirect too. Later: app:// scheme.
3. `src/main/index.ts:58-60` · Deny all permissions (request, check, device handlers) so the screen cannot open Web MIDI etc.
4. `src/main/index.ts:42-47` · Move guards to `web-contents-created`; block will-attach-webview; `app.enableSandbox()`.
5. `electron-builder.yml` · Electron fuses (runAsNode off, NODE_OPTIONS off, inspect off, asar integrity, onlyLoadAppFromAsar, cookie encryption). Keep grantFileProtocolExtraPrivileges default.
6. `src/main/index.ts:33-39` · `devTools: !app.isPackaged`; no default menu when packaged.
7. `src/renderer/index.html:7` · Add object-src/base-uri/form-action/frame-src 'none'; drop style 'unsafe-inline' in production builds.
8. `ci.yml:19,34` · checkout `persist-credentials: false`.
9. `ci.yml` · Pin actions by SHA; add dependabot for npm and actions.
10. `.gitignore` · Add *.pfx *.p12 *.pem *.key *.cer and .claude/settings.local.json; optional gitleaks.
11. `e2e/app.spec.ts:4`, `scripts/screens.ts:36` · --no-sandbox only for Linux root; e2e test asserting hardening (no require/process, window.open null, preload keys).
12. `package.json:30` · 6 moderate build-only minimatch advisories via electron-builder; log, do not `audit fix --force`.
13. `electron-builder.yml` · Unsigned installer; sign before a real release with cert only in Actions secrets.

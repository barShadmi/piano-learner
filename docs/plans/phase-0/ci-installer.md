# Phase 0 · Task 5 · GitHub Actions: lint, tests, Windows installer on every PR

Goal: every push and PR runs lint, typecheck and tests, and builds a Windows installer (.exe) that Bar can download from the run's artifacts.

## Step 1 · electron-builder config (builder-plus)
Files: `package.json` (dev dep `electron-builder` pinned; script `dist:win` = `npm run build && electron-builder --win nsis --publish never`), `electron-builder.yml`, `build/icon.png` (simple 512x512 placeholder generated with a script; plain accent-coloured square with a white music note shape is fine).

`electron-builder.yml`: appId `com.barshadmi.pianolearner`, productName `PianoLearner`, directories output `release`, files `out/**` and `package.json`, win target nsis x64, nsis oneClick false, allowToChangeInstallationDirectory true, createDesktopShortcut true, artifactName `PianoLearner-Setup-${version}.exe`, asar true.

## Step 2 · Workflow (builder-plus)
File: `.github/workflows/ci.yml`.
- Triggers: pull_request, push to main.
- Job `check` on ubuntu-latest: checkout, setup-node 22 with npm cache, `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, then `xvfb-run -a npm run test:e2e`.
- Job `windows-installer` on windows-latest, needs `check`: checkout, setup-node 22, `npm ci`, `npm run dist:win`, upload `release/*.exe` as artifact `PianoLearner-Setup` (retention 14 days).
- Concurrency group per ref, cancel in progress.
- Pin action major versions (actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4).

Acceptance:
1. `npx electron-builder --help` works; `electron-builder.yml` is valid YAML (`node -e "require('yaml')"` not needed: verifier parses it with python `yaml` or `js-yaml` from node_modules).
2. `.github/workflows/ci.yml` passes `npx --yes @action-validator/cli .github/workflows/ci.yml` or, if that tool cannot be fetched, a careful read against the list above.
3. On Linux, `npx electron-builder --win nsis --dir --publish never` either builds the unpacked Windows app or fails only for lack of Wine; the verifier records which. The real installer is proven by the first CI run on GitHub.
4. lint, typecheck and tests still pass.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |

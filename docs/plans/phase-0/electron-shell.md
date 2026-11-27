# Phase 0 · Task 2 · Electron + TypeScript + React + Vite shell

Goal: `npm run dev` opens one PianoLearner window; `npm run build` builds it; the window shows an empty song library screen. Uses electron-vite, which gives the standard `src/main`, `src/preload`, `src/renderer` layout.

## Step 1 · Project and app shell (builder)
Files to create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/screens/Library.tsx`, `.gitignore`, `eslint.config.mjs`, `.nvmrc` (22).

Build:
- Dependencies: `react`, `react-dom`. Dev: `electron`, `electron-vite`, `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`, `eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`. Pin exact versions in `package.json` (no `^`).
- `package.json` scripts: `dev` (electron-vite dev), `build` (typecheck then electron-vite build), `typecheck` (tsc --noEmit for node and web configs), `lint` (eslint .), `start` (electron-vite preview). `"main": "./out/main/index.js"`, `"name": "piano-learner"`, `"productName": "PianoLearner"`, `"private": true`.
- `src/main/index.ts`: create one `BrowserWindow` 1280 x 800, min 1024 x 640, title "PianoLearner", `webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true }`. Block navigation to any other URL (`will-navigate` prevent) and deny `window.open` (`setWindowOpenHandler` returns deny). Quit when all windows close.
- `src/preload/index.ts`: expose `window.pianoLearner = { version: string }` via `contextBridge` (the app version from `process.versions` is not needed; use a constant `'0.0.1'` read from package.json at build time or just hard-code `'0.0.1'`). Type it in `index.d.ts`.
- `src/renderer/index.html`: a strict Content-Security-Policy meta: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`.
- `App.tsx` renders `<Library />`. `Library.tsx` shows a heading "Your songs", an empty-state line "No songs yet. Import sheet music (a photo or PDF), a MIDI or MusicXML file, or a falling-notes video to start playing.", and a disabled button "Import file" (changed in phase 0 review round 1). No styling beyond plain CSS in the component for now (tokens arrive in task 7).
- `.gitignore`: node_modules, out, dist, release, .env*, *.log, test-results, playwright-report.

Test first: none in this step (test tooling is task 3); acceptance is by commands.

Acceptance (verifier proves each):
1. `npm install` succeeds; `package.json` has no `^` or `~` versions.
2. `npm run typecheck`, `npm run lint` and `npm run build` all exit 0; `out/main/index.js`, `out/preload/index.js` (or `.mjs`), `out/renderer/index.html` exist.
3. `src/main/index.ts` has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, a `will-navigate` guard and a deny-all `setWindowOpenHandler`.
4. The app starts headless: `xvfb-run -a npx electron . --no-sandbox` (or the Playwright launch in task 3) shows the window titled "PianoLearner" with the text "Your songs" (verifier may use a one-off Playwright `_electron.launch` script and a screenshot).
5. No files outside the list were created.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 1 | PASS |

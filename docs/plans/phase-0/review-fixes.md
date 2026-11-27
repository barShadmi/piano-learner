# Phase 0 · Review round 1 fixes

From `docs/reviews/phase-0/round-1/fixes.md`. Each step goes builder, then verifier, then commit.

## Step 1 · Library screen, routes and base styles (builder)
Files: `src/renderer/src/screens/Library.tsx`, `src/renderer/src/screens/Library.module.css` (new), `src/renderer/src/App.tsx`, `src/renderer/src/routes.ts` (new), `src/renderer/src/routes.test.ts` (new), `src/renderer/src/screens/NotFound.tsx` (new), `src/renderer/styles/base.css`, `scripts/screens.ts`, `e2e/app.spec.ts`, `docs/plans/phase-0/electron-shell.md` (line 14 wording only).

Build:
- `routes.ts`: `screenFor(hash: string): 'library' | 'not-found'`. `''`, `'#'`, `'#/'` give `'library'`; anything else gives `'not-found'`. Test first in `routes.test.ts` (those three, plus `'#/nope'`).
- `App.tsx`: keep the hash in state, update on `hashchange` (remove the listener on unmount), render `Library` or `NotFound`. `NotFound` is a `<main>` with `<h1>Screen not found</h1>`.
- `scripts/screens.ts`: after the page loads, if the text "Screen not found" is visible, throw an error naming the screen and stop with a non-zero exit.
- `base.css` adds:
  - `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`
  - `.button`: `font: inherit; min-width: 44px; padding: var(--space-2) var(--space-5); border-radius: var(--radius-2); background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); cursor: pointer; transition: background-color var(--dur-fast) var(--ease), transform var(--dur-fast) var(--ease);`
  - `.button:active { transform: scale(0.97); }`
  - `.button[aria-disabled='true'] { background: var(--surface-raised); color: var(--text-muted); border-color: var(--border); cursor: not-allowed; transform: none; }`
  - `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 1ms !important; animation-iteration-count: 1 !important; transition-duration: 1ms !important; scroll-behavior: auto !important; } }`
- `Library.module.css` (tokens only): `.screen` padding `--space-6`, and `--space-7` at `min-width: 1600px`. `.header` flex row, space-between, centred vertically, gap `--space-4`. `.title` `--text-2xl`, margin 0. `.panel` margin-top `--space-6`, background `--surface`, `1px solid var(--border)`, radius `--radius-4`, padding `--space-7`, text centred. `.empty` `--text-lg`, margin `0 0 var(--space-2)`. `.hint` `--text-sm`, `--text-muted`, margin 0.
- `Library.tsx` (no inline styles, no `canImport` constant):
  ```
  <main class=screen>
    <div class=header>
      <h1 class=title>Your songs</h1>
      <button type=button class="button" aria-disabled="true" aria-describedby="import-soon" onClick={() => {}}>Import file</button>
    </div>
    <section class=panel aria-label="Song list">
      <p class=empty>No songs yet. Import sheet music (a photo or PDF), a MIDI or MusicXML file, or a falling-notes video to start playing.</p>
      <p class=hint id="import-soon">Importing arrives in a later update.</p>
    </section>
  </main>
  ```
  One comment above the button: import is wired up in phase 2; then drop `aria-disabled`, the no-op click and the hint.
- `e2e/app.spec.ts`: also assert the button named "Import file" is visible with `aria-disabled="true"`, and that one Tab press focuses it.
- `electron-shell.md` line 14: change the quoted texts to the new ones and add "(changed in phase 0 review round 1)".

Acceptance: `npm test`, `npm run typecheck`, `npm run lint`, `xvfb-run -a npm run test:e2e`, `xvfb-run -a npm run screens -- --out /tmp/shots` pass; the colour grep from design-tokens.md finds nothing; no `style=` in `Library.tsx`; only the listed files change.

## Step 2 · Token meaning fixes (builder)
Files: `src/renderer/styles/tokens.css` only. Bar approved both colour changes (2026-11-27).
- `:root`: `--accent: var(--text); --on-accent: var(--surface);`. Delete the dark `--accent` and `--on-accent` lines so dark inherits.
- `--wrong` light `#9f1239`, `--wrong-soft` light `#fbe1e7`; dark `--wrong` `#fb7185`, `--wrong-soft` `#3a1c26`.
- Reduced motion: `--dur-fast` and `--dur` become `1ms` (not `0ms`).
Acceptance: verifier's contrast script shows every pair from design-tokens.md at least 4.5:1 in both themes, plus `--wrong` on `--bg`; all checks pass; screenshots show the ink-filled look for an enabled-style button (the disabled one is unchanged).

## Step 3 · Electron hardening (builder-plus)
Files: `src/main/index.ts`, `src/renderer/index.html`, `.github/workflows/ci.yml`, `.gitignore`, `electron-builder.yml`, `e2e/app.spec.ts`.
- Read `ELECTRON_RENDERER_URL`, `PIANO_SCREEN`, `PIANO_THEME` only when `!app.isPackaged`.
- `isAppUrl` for files: equal to `pathToFileURL(join(__dirname, '../renderer/index.html')).href` once the `#…` part is removed. Same guard on `will-redirect`.
- `app.enableSandbox()` before ready. Move the navigation, redirect and window-open guards into `app.on('web-contents-created')`, and block `will-attach-webview`.
- In `whenReady`, before the window: deny all permissions (`setPermissionRequestHandler` → false, `setPermissionCheckHandler` → false, `setDevicePermissionHandler` → false).
- `app.requestSingleInstanceLock()`: quit if not granted; on `second-instance` restore and focus the window.
- `.catch` on `whenReady` and on `loadURL` / `loadFile`: log and quit. `render-process-gone`: log the reason.
- When packaged: `Menu.setApplicationMenu(null)` and `devTools: false` in `webPreferences`.
- CSP: add `object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`.
- `ci.yml`: `persist-credentials: false` on both checkouts.
- `.gitignore`: `*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.cer`, `.claude/settings.local.json`.
- `electron-builder.yml`: keep `artifactName` only under `nsis`.
- `e2e/app.spec.ts`: new test: in the window, `typeof require` and `typeof process` are `'undefined'`, `window.open('https://example.com')` returns `null`, and `Object.keys(window.pianoLearner).sort()` is `['forcedTheme', 'version']` or `['version']`.
Acceptance: all checks and e2e pass; `npm run dev` path untouched; screens script still writes 4 PNGs.

## Step 4 · Type and validator gaps (builder)
Files: `tsconfig.web.json`, `vitest.config.mts`, `src/shared/sanity.test.ts` → `scripts/package.test.ts`, `src/shared/song/validate.ts`, `src/shared/song/validate.test.ts`.
- `tsconfig.web.json`: `"types": []`. Move the sanity test to `scripts/package.test.ts`; add `scripts/**/*.test.ts` to Vitest's include. Proof: a scratch renderer file importing `node:fs` fails typecheck (verifier tries it, does not commit it).
- Measures: each measure after the first must start where the previous one ends: `measures[i].start: must start where measure i-1 ends (beat X)`. Tests first: one gap, one overlap.
- One `it.each` table of accepted edge values (pitch 21 and 108, bpm 20 and 300, finger 1 and 5, velocity 1 and 127, confidence 0 and 1, keyFifths -7 and 7), each giving no errors. Rejection tests for: empty song `id`, `timeSignature.beats` 0, `notes` not an array, a measure that is not an object.
Acceptance: all tests pass, typecheck, lint; only the listed files change.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 1 | PASS |
| 2 | builder (Haiku) | 1 | PASS (lead added a comment on how accent follows the theme) |

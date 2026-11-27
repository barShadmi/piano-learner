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
| 3 | builder-plus (Sonnet) | 1 | PASS (enableSandbox skipped only for dev runs with --no-sandbox; packaged always sandboxed) |
| 4 | builder (Haiku) | 1 | PASS |

## Step 5 · Quick Polish from round 2 before the gate (builder-plus)
The board passed in round 2. These small items are done before Bar's gate because they touch what he will see or would make CI flaky.
Files: `src/main/index.ts`, `src/main/appUrl.ts` (new), `src/main/appUrl.test.ts` (new), `src/preload/index.ts`, `src/renderer/src/screens/Library.tsx`, `src/renderer/src/screens/Library.module.css`, `src/renderer/src/screens/NotFound.tsx`, `src/renderer/styles/base.css`, `src/renderer/styles/tokens.css`, `src/shared/song/validate.ts`, `src/shared/song/validate.test.ts`, `e2e/app.spec.ts`, `scripts/screens.ts`, `docs/plans/phase-0/electron-shell.md` (line 14 wording).
1. Zoom keys without a menu: in `createWindow`, `before-input-event` handles Ctrl+= / Ctrl++ (zoom in 0.5, max 3), Ctrl+- (out 0.5, min -1), Ctrl+0 (reset), keyDown only, preventDefault.
2. `isAppUrl` moves to pure `src/main/appUrl.ts` as `isAppUrl(url, { rendererUrl, rendererFileUrl })`, test first in `appUrl.test.ts`: own file with `#/route` allowed; same file with `?x` refused; other `file://` refused; `https://` refused; malformed refused; dev origin allowed only when `rendererUrl` is set.
3. Deny device pickers in `web-contents-created`: `select-bluetooth-device`, `select-serial-port`, `select-usb-device` → preventDefault, `callback('')`; `select-hid-device` → preventDefault, `callback()`.
4. Preload: add `forcedTheme` to the bridge only when it is set. e2e bridge check becomes `toEqual(['version'])` for a normal launch.
5. Library: put the hint under the button in the header (`.action` column, align end, gap `--space-1`), remove it from the panel. Panel: `<p class=emptyTitle>No songs yet.</p>` at `--text-xl` in `--text`, then `<p class=empty>You'll be able to import sheet music (a photo or PDF), a MIDI or MusicXML file, or a falling-note video.</p>` at `--text-md` in `--text-muted`, `--space-2` between. h1 gets `id="songs-title"`; the section uses `aria-labelledby="songs-title"` instead of `aria-label`. Drop the no-op `onClick`. Comment above the button: in phase 2 drop `aria-disabled` and the hint, and change the second line to "Import sheet music (a photo or PDF), a MIDI or MusicXML file, or a falling-note video to start playing." Update `electron-shell.md` line 14.
6. NotFound: same screen padding as Library (`--space-6`), keep the h1 text exactly, add `<p>This screen doesn't exist yet.</p>` and `<a href="#/" class="button">Back to your songs</a>`; `.button` links get `display:inline-flex; align-items:center; text-decoration:none; min-height:44px`.
7. base.css: `@media (forced-colors: active) { .button[aria-disabled='true'] { color: GrayText; border-color: GrayText; } }`. Transition only `transform`. Reduced motion is owned by the base.css rule only: scope it to `*:not([data-motion='content'])` (and pseudo-elements), comment that falling notes are drawn on the PixiJS canvas and CSS content motion opts out with `data-motion="content"`; tokens.css goes back to `--dur-fast: 120ms; --dur: 200ms` with no reduced-motion block. Also repeat `--accent: var(--text); --on-accent: var(--surface);` in the dark block and shorten the comment.
8. Validator: after a measure start mismatch, continue from the expected start, so only the wrong measure is reported. Gap and overlap tests use `toEqual([...one error])`. Rename the "validateSong new rejections" describe to "validateSong rejects missing or empty parts".
9. e2e and screens: each launch gets its own `--user-data-dir` from `fs.mkdtempSync(path.join(os.tmpdir(), 'pl-'))`. Hardening test also checks that `location.href = 'https://example.com'` leaves the page on `file:` and that `navigator.requestMIDIAccess()` is denied. New e2e test: `#/nope` shows "Back to your songs" and following it shows "Your songs".
Acceptance: npm test, typecheck, lint, `xvfb-run -a npm run test:e2e`, screens (4 PNGs) pass; colour grep finds nothing; only the listed files change.

# Phase 0 · Task 6 · Screenshot script

Goal: `npm run screens -- --out <folder>` launches the built app and saves a screenshot of every screen in light and dark at 1280 x 800 and 1920 x 1080. Used by the verifier and the review board.

## Step 1 · Screens script (builder)
Files: `scripts/screens.ts`, `scripts/screens.config.ts`, `package.json` (script `screens` = `npm run build && tsx scripts/screens.ts`; dev dep `tsx` pinned), `src/main/index.ts` (only: read env `PIANO_SCREEN` and, when set, load the renderer with `#/<screen>` so a screen can be opened directly; and env `PIANO_THEME` to force `light` or `dark` by passing it to the renderer through the preload as `window.pianoLearner.forcedTheme`), `src/preload/index.ts` and `index.d.ts` (add `forcedTheme?: 'light' | 'dark'`), `src/renderer/src/main.tsx` (forcedTheme wins over stored and system).

`screens.config.ts` exports `screens: { name: string; hash: string }[]`, starting with `{ name: 'library', hash: '' }`. Later phases add entries.

`screens.ts`: parse `--out` (default `screens-out`), for each screen × theme × size, launch the app with `_electron.launch` (args `.` and `--no-sandbox`, env PIANO_SCREEN and PIANO_THEME), set the window size with `browserWindow.setContentSize` through `electronApp.evaluate`, wait for network idle and fonts, save `<out>/<screen>-<theme>-<w>x<h>.png`, close. Print the list of files.

Test first: none (it is a tool); acceptance by running it.

Acceptance:
1. `xvfb-run -a npm run screens -- --out /tmp/shots` writes 4 PNGs for the library screen; verifier opens two of them (light and dark) and confirms the theme actually differs.
2. lint, typecheck, tests and e2e still pass.
3. Only the listed files changed.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 1 | PASS (lead then limited PIANO_SCREEN to a-z0-9/-, typechecked scripts/, ignored screens-out) |

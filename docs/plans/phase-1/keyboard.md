# Phase 1 · Task 7 · 88-key virtual keyboard that lights the keys you press

Goal: Bar sees a full 88-key piano on screen, and every key he presses on the P-121 lights up at once. Later tasks reuse the same keyboard: falling notes land on it (task 8), Listen mode lights the song's keys in the hand colours (task 9), and phase 2 adds right/wrong marks.

Decisions (lead):
- A new **Play** screen (`#/play`, title "Play"), opened from the library with a "Play the piano" link next to "Sound". Header: title and "Back to your songs". Under it, one status line about the piano ("Piano connected." / the existing not-found words from soundText). The keyboard sits at the bottom of the screen, full width. Space above it stays empty for now (falling notes go there in task 8).
- Keys: MIDI 21 (A0) to 108 (C8): 52 white, 36 black. Drawn as DOM elements (one `div` per key, absolutely positioned from a pure layout function), not canvas, so they are easy to test and theme. Width fills the screen; height is about 5.5 × the white key width, capped so the keyboard is never taller than 30% of the window.
- A pressed key has three signals, not colour alone: its fill changes to `--text-muted` on both white and black keys, it moves down 2 px (`translateY`), and a round dot (`--on-accent`: white on the grey in light theme, dark on the grey in dark theme) shows near its bottom edge. Hand colours are NOT used for keys Bar presses (blue and orange mean the song's hands only).
- The component takes `lit: ReadonlyMap<number, 'pressed' | 'right' | 'left'>`. 'right' and 'left' fill with `--hand-right-soft` / `--hand-left-soft` plus a bottom bar in `--hand-right` / `--hand-left` and an "R" / "L" letter on white keys. Only 'pressed' is used in this task; the others are built and unit tested now for task 9.
- Labels: every C gets its name under the keyboard (C1 … C8), and middle C (C4, MIDI 60) also gets a small "Middle C" label. Text uses `--text-muted`, `--text-sm`.
- Pedal: a short line above the keyboard: "Pedal: down" / "Pedal: up", with a filled or empty circle glyph.
- Accessibility (phase 0 review notes): add `--border-strong` as an alias of an existing colour (light and dark: `var(--text-muted)`; no new colour value) and use it for key edges. The keyboard itself is `role="img"` with `aria-label="Piano keyboard"`; a visible line under it says "Keys down: C4, E4, G4" (or "No keys down."), not a live region. `@media (forced-colors: active)`: keys use `Canvas`/`CanvasText` with `ButtonBorder` edges and the pressed key uses `Highlight`. No animation except the 2 px move with `--dur-fast`, which is removed under `prefers-reduced-motion`.
- Key state comes from `pianoLearner.midi.onEvents` batches: 'on' adds, 'off' removes, 'allOff' clears, 'sustain' sets the pedal. When the piano is reported not connected, all keys clear. Nothing here touches the sound path.

## Step 1 · Keyboard logic (builder)
Files: `src/renderer/src/keyboard/layout.ts` + test (`isBlack(note)`, `noteName(note)` e.g. 60 → "C4", 61 → "C♯4", `keyboardLayout(first=21, last=108)` → for each note `{ note, black, x, width }` in white-key units: white keys at whole numbers, width 1; black keys width 0.6, centred on the boundary between their neighbours with the usual small offsets (C♯/F♯ shifted left 0.1, D♯/A♯ shifted right 0.1, G♯ centred); total width 52), `src/renderer/src/keyboard/keysDown.ts` + test (`type KeysState = { down: ReadonlySet<number>; pedal: boolean }`, `applyEvents(state, events): KeysState` returns a new state and the same object when nothing changed; notes outside 21–108 are ignored; `keysDownLine(state)` → "Keys down: C4, E4, G4" in pitch order, or "No keys down.").
Tests first: 88 keys, 52 white, 36 black; A0 at x 0, C8 at x 51; black keys never overlap each other and sit inside the white range; noteName for 21, 60, 61, 108; on/off/allOff/sustain; repeated on is harmless; off for a key not down is harmless; out-of-range notes ignored; unchanged state keeps identity.
Acceptance: npm test, lint, typecheck pass.

## Step 2 · Keyboard component and Play screen (builder) [frontend-design]
Files: `src/renderer/src/keyboard/Keyboard.tsx` + `.module.css` + `Keyboard.test.tsx` (jsdom, react-dom `act`, as in SoundSettings.test.tsx), `src/renderer/src/screens/Play.tsx` + `.module.css`, `src/renderer/src/routes.ts` + test (`#/play` → 'play'), `src/renderer/src/App.tsx`, `src/renderer/src/screens/Library.tsx` (+ css if needed; "Play the piano" link), `src/renderer/styles/tokens.css` (`--border-strong` alias only), `e2e/app.spec.ts`.
Keyboard.test: renders 88 keys; a 'pressed' note has `data-state="pressed"` and the dot; 'right'/'left' show the R/L letter; C labels and "Middle C" exist.
e2e: from the library, "Play the piano" opens the Play screen; the keyboard image is there with 88 keys; the "No keys down." line shows; keyboard-only: Tab reaches "Back to your songs" and Enter goes back. Screenshots light and dark of the Play screen with three keys pressed (render-only: a test-only query string is NOT allowed; take the pressed screenshot from the Keyboard component test or a Playwright page that sets state through the real component's props in a scratch harness, not in the app).
Rules: tokens only, 44 px targets for links/buttons, plain words.
Acceptance: npm test, lint, typecheck, build, e2e pass; screenshots light and dark.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 1 | PASS. allOff keeps the pedal (MIDI CC 123 does not release sustain). |
| 2 | builder (Haiku) | 1 | PASS (lead changed the pressed colour after the first screenshots; forced-colours edges, bar and dot fixed by the lead from the verifier notes). |

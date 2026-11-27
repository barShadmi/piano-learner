# Accessibility · phase 1 · round 2
Score: 9/10

What I checked: the renderer diff from e844821 to HEAD, token contrast in both themes (calculated), the round-2 screenshots including the states, forced-colours and stripe zooms, and the built app under xvfb with a throwaway Playwright probe. The probe tabbed through #/, #/sound, #/latency and #/play in light and dark, took aria snapshots of Play before and after Watch, Listen and Pause, and of the Delay test. I deleted the probe afterwards and edited no repo files.

What works:
- Every Tab stop is reachable, in a logical order, with no traps.
- Every button and link is 44 px tall.
- The focus ring is 2 px and about 15:1 in both themes.
- On every route change the window title is set ("Sound · PianoLearner" and so on) and focus moves to the h1, which has no outline.
- Listen and Watch report `aria-pressed` and show a ● glyph when on.
- Pause has `aria-disabled` and is announced as disabled before the first press and after Pause.
- The Play status slot is a `role="status"` that is always present, and it reads "Playing with sound." / "Playing without sound." / "Paused."
- Falling-note labels say R1/L3, R or L at `--text-sm` or larger, or show an edge stripe on the hand's side. The unit test proves the hand is never shown by colour alone.
- Lit black keys now carry R/L. The bar uses `--on-accent`: 5.18 to 8.55:1 on the hand fills.
- Selects use `--border-strong`.
- Words on `--correct-soft` are in `--text` (14.7:1).
- The Delay test progress is announced every 5 keys.
- The muted hint text is 6.32:1 in light and 8.02:1 in dark.
- Reduced motion covers the new `scaleX` progress fill.

## Must fix to reach 10
1. **Polish** · `src/renderer/src/screens/Latency.tsx:182` and `:185` · The result and the verdict are two `role="status"` elements that are added to the page with their text already in them (inside `{summary && words ? … : null}`). NVDA and JAWS on Chrome often do not read a live region that appears together with its content, so the verdict may never be spoken. Only the progress region's "All 20 keys timed." is reliable. Good looks like: one `role="status"` element that is always on the screen, for example right after the progressbar, empty until 20 keys are timed and then filled with `resultLine(...)` plus `words.text` (for example "Typical key: about 8.0 ms. Almost every key sounds in under 10 ms. Good."). Drop `role="status"` from the visible `.big` and `.verdict` paragraphs so nothing is read twice.
2. **Polish** · `src/renderer/src/screens/Play.tsx:81-87` (`Dot`), used at `:279` and `:289` · The ● appears only when a button is on, so the button widens: Watch goes from 176 to 197 px and Listen from 92 to 114 px. Pause and Restart song then move sideways by about 21 px right after a press. A pointer aimed at Pause can land on the wrong control, and screen magnifier users lose their place. Good looks like: keep the glyph's space at all times. Render the span always, with `visibility: hidden` when off, still `aria-hidden="true"`, so the buttons never move. The pressed border, fill and `aria-pressed` stay as they are.

Already in `later.md`, not counted against this round: axe in e2e with a focus screenshot per theme; a lit black key in forced colours looks like a white key (the letter still marks it); the thin edge stripe at 1x; the skipped announcement when a poll jumps past a multiple of 5. A side note: `states/note-stripes-zoom-*.png` were not re-shot after commit 53c7a05, so they still show the old legend. The code is right; the screenshot is out of date.

## Fixed since last round
- 1 (Blocking) Falling notes: hand plus finger on every note ("R3"/"L3"). The hand letter stays when the finger does not fit, and an edge stripe on the hand's side appears when no text fits (`falling/label.ts`, `label.test.ts`). Hand is no longer colour only.
- 2 (Blocking) Lit black keys show R/L. The bar uses `--on-accent` (≥5.18:1). In forced colours the letter tells the hands apart (`Keyboard.tsx:32-33`, `Keyboard.module.css:56-76`, tests added).
- 3 Select edges use `--border-strong` (`SoundSettings.module.css:51`).
- 4 Words on `--correct-soft` are in `--text`, with `--correct` kept for the edge and glyph (`Sound.module.css`, `Latency.module.css`).
- 5 Note labels take their size from `--text-md` / `--text-sm`, with `--text-sm` as the floor and the inset from `--space-1`.
- 6 Play has a visible, announced status (Playing with sound / Playing without sound / Paused / Song finished / engine reason with the Open Sound link) and pressed state on the mode buttons.
- 7 The title is set and focus moves to the h1 on every route change (`App.tsx`, `routes.ts`, tested).
- 8 Mostly fixed: the progress is announced every 5 keys and at 20, and the buttons are `aria-disabled` with a "Play a key first." hint. Making sure the verdict itself is read out is item 1 above.
- 9 Moved to `later.md` by the lead (axe in e2e).

Files referenced:
- /home/user/piano-learner/src/renderer/src/screens/Latency.tsx
- /home/user/piano-learner/src/renderer/src/screens/Play.tsx
- /home/user/piano-learner/docs/reviews/phase-1/round-2/shots/states/note-stripes-zoom-light.png

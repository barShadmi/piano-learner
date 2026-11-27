# Design · phase 1 · round 2
Score: 8/10

Both round 1 Blocking items are fixed and I found no new Blocking items. What is left is Polish: button hierarchy on four screens, the legend, and two small Play and keyboard details.

## Must fix to reach 10
1. **Polish** · Play, Watch running (`states/falling-*.png`, `states/play-1024x640-*.png`) · Mode buttons at `src/renderer/src/screens/Play.tsx:272-291`, pressed style at `src/renderer/styles/base.css:38-42`. While Watch is running, Listen keeps the filled ink look and the running Watch button gets the lighter pressed look (`--surface-raised`). The button that is not running is the strongest thing on screen. The ● and the status line make it clear enough that this does not block, but the eye reads the wrong button first. **Good:** the primary look follows the state, worked out in `playState.ts`. Before any press, Listen is `.button` and Watch is `.button-secondary`. While a mode runs, the running button is `.button` (filled ink) with ● and `aria-pressed="true"`, and the other mode button is `.button-secondary`. The `[aria-pressed]` rule in base.css then only adds the ●-glyph spacing, not a lighter fill.
2. **Polish** · Every screen header, Sound and Delay test (round 1 item 8, only partly done) · Back links are still filled primaries: `Play.tsx:61`, `Sound.tsx:161`, `Latency.tsx:134`, `NotFound.tsx:8`. The Sound screen has five filled buttons stacked down one page (`Sound.tsx:161, 186/200/207, 237, 275, 297`). The Delay test has two (`Latency.tsx:134, 148`). **Good:** every "Back to …" link gets `button button-secondary`. On Sound, only Try again / Start sound (186/200/207) stay filled. Reconnect piano (237), Play test sound (275) and Test the delay (297) become `button-secondary`. On Delay test, only Reconnect piano (148) stays filled; Start over (222) is secondary.
3. **Polish** · Play legend (round 1 item 14, not fixed and not in later.md) · `Play.tsx:323`, `Play.module.css:81-85`. The legend is one 110-character `--text-sm` muted sentence with "=" and "·". Bar has to read it to learn the most important code on screen. **Good:** two items at `--text-md` in `--text`. Each starts with a small chip (`--space-5` square, `--radius-1`, filled with `--hand-right` / `--hand-left`) holding the letter R / L in `--on-accent`, followed by "Right hand" / "Left hand". The stripe explanation goes after them in `--text-sm` muted, or into the hint.
4. **Polish** · Lit white keys in light theme (`states/falling-light.png`, `states/keys-lit-light.png`) · `src/renderer/src/keyboard/Keyboard.module.css:56-63`. The `--on-accent` bar is white in light theme, so on a white key it merges with the bottoms of the keys next to it. The lit key looks shorter than its neighbours, not marked. In dark theme it reads fine. **Good:** an inset mark that reads as a shape in both themes: `left: var(--space-1); right: var(--space-1); bottom: var(--space-1); height: var(--space-1); border-radius: var(--radius-full)`, still `--on-accent`, so the hand colour shows on all sides of it.
5. **Polish** · Play before the first press (`play-*-1280x800.png`, `play-*-1920x1080.png`) · `Play.tsx:307-310`, `Play.module.css:108-114`. Because the status row keeps its fixed 44 px height, it shows as an empty band between the buttons and the legend, and the screen looks unfinished. **Good:** keep the fixed height, and in `playState.ts` give the idle state a line in `--text-muted`, e.g. "Press Listen to hear the song." Then the row always says something, and the hint next to the buttons can be shortened or dropped (wording is for the Words reviewer).

## Fixed since last round
- 1 (Blocking) Play controls: fixed order; Listen is the primary; "Watch (no sound)"; the running mode shows a ● and `aria-pressed`; Pause is `aria-disabled` with a muted style; the status is spoken. The remaining hierarchy issue is item 1 above.
- 2 (Blocking) Falling-note labels: sizes come from `--text-md` / `--text-sm` / `--space-1` through `cssValue()`, pure `label.ts` with tests, R/L on every note, and an edge stripe when there is no room. Readable in both themes.
- 3 Re-shoots: state shots are from HEAD (falling mid-song, lit and pressed keys, forced colours, stripe zoom, 1024x640).
- 4 Bar on lit keys now uses `--on-accent`; R/L letters on lit black keys too. Item 4 above is a follow-up for light theme.
- 6 The status row has a fixed height, so the falling area no longer jumps.
- 7 At 1024x640: the title is the h1, piano and pedal share one line, and the falling area is about 242 px in the shot (target was at least 240).
- 9, 10 Library: "Play the piano" removed; "Sample" is a muted tag; the empty-state sentence sits under the list after a separator; one primary (Import file).
- 11 Piano card headline split.
- 13 Start over / Save report are `aria-disabled` with "Play a key first."
- 5 Closed: the 2 px key press move is kept as a plan decision (one of the three press signals; off under reduced motion). I accept that.
- 12 Panel widths at 1920: moved to later.md, not judged here.

Still good: CSS is token-only, the label size floor holds, there is a `.button:active` scale(0.97) with the custom ease, 44 px targets, both themes complete, forced colours keep R/L, notes line up with keys, Middle C is labelled.

Files referenced:
- /home/user/piano-learner/src/renderer/src/screens/Play.tsx
- /home/user/piano-learner/src/renderer/src/screens/Play.module.css
- /home/user/piano-learner/src/renderer/styles/base.css
- /home/user/piano-learner/src/renderer/src/screens/Sound.tsx
- /home/user/piano-learner/src/renderer/src/screens/Latency.tsx
- /home/user/piano-learner/src/renderer/src/screens/NotFound.tsx
- /home/user/piano-learner/src/renderer/src/keyboard/Keyboard.module.css
- /home/user/piano-learner/docs/reviews/phase-1/round-2/shots/

# Accessibility · phase 1 · round 1
Score: 6/10

Checked: every renderer file in 7ddce18..HEAD, token contrast in both themes, screenshots, and the built app under xvfb with Playwright (Tab through #/, #/sound, #/latency, #/play in light and dark; aria snapshot).

Works: all Tab stops reachable in order, no traps; every control ≥44 px (checkbox row 44 px); visible focus (~15:1); lang="en"; every field labelled; badges and delay verdict use symbol + word; reduced motion handled, falling notes keep moving; pressed keys have three signals.

## Must fix to reach 10
1. **Blocking** · `FallingNotes.tsx:269` · A note with a finger number shows only the number, so the hand is shown by colour alone (fingers 1–5 exist on both hands; MusicXML imports keep printed fingerings). Show "R1"/"L3" when wide enough; when narrower add a per-hand shape (e.g. notch/stripe on the right edge for right hand, left edge for left). Unit test that same-finger notes of each hand differ apart from colour.
2. **Blocking** · `Keyboard.tsx:32-33`, `Keyboard.module.css:55-62` · Song-lit black keys get no R/L letter and the bottom bar is the same for both hands, so the hand is colour only. The bar (`--text-muted` on the hand fill) is ~1.03–1.33:1, useless as a signal. Light lit blue black key vs unlit black key is 2.57:1. In forced colours right and left are identical on black keys. Fix: bar in `--on-accent` (≥5.18:1); R/L on black keys too (`--text-sm`), or a per-hand bar shape if it won't fit; extend Keyboard.test.tsx.
3. **Polish** · `SoundSettings.module.css:51` · Select edges use `--border` (1.35–1.59:1), failing 1.4.11. Use `--border-strong`.
4. **Polish** · `Sound.module.css:84-88`, `Latency.module.css:105-109` · `--correct` on `--correct-soft` is 4.29:1 in light. Keep `--correct` for border and glyph; word in `--text`.
5. **Polish** · `FallingNotes.tsx:19,193,271` · Label 12 px, down to ~7.7 px. Use at least `--text-sm` where it fits; read the size from the token.
6. **Polish** · `Play.tsx:245-256` · No visible or announced Playing/Paused state. Add a role=status line: Playing / Paused / Listening… / Finished.
7. **Polish** · `App.tsx:18` · Route change leaves focus on body and the title unchanged. Set document.title "<Screen> · PianoLearner" and move focus to the h1 (tabIndex -1, no outline).
8. **Polish** · `Latency.tsx:149,170` · Progress and verdict not announced. aria-live polite progress every 5 keys and at 20; result and verdict in role=status.
9. **Polish** · `e2e/app.spec.ts` · Phase 0 later item: axe check in e2e (`@axe-core/playwright`, exact version) on all four screens in both themes, failing on serious/critical; one focus-state screenshot per theme.

## Fixed since last round
- First round.

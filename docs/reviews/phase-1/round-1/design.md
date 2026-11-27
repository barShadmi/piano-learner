# Design · phase 1 · round 1
Score: 6/10

Note: some state shots were stale (`states/keys-*`, `states/falling-*`, `states/play-1024x640-*` predate the full-colour lit keys and the Listen button). Judged against the code and the main `play-*` shots.

## Must fix to reach 10
1. **Blocking** · Play (`Play.tsx:244-256`) · Controls don't say what they do or show what is running. "Start" plays silently, "Listen" with sound; a beginner presses Start, hears nothing, thinks sound is broken. All four buttons always enabled and identical. Fix: rename Start to "Watch (no sound)", make Listen the primary; show the running mode with `aria-pressed` + visible pressed style (`--surface-raised`, `--text` border, ● glyph); Pause `aria-disabled` when not playing; fixed order.
2. **Blocking** · Falling notes (`FallingNotes.tsx:19-20, 193, 273`) · Label uses non-token values (`fontSize: 12`, `MIN_LABEL_PX = 9`, `FULL_LABEL_PX = 14`, `y = h - 2`) and is too small to read from the bench (9-12 px). Fix: read `--text-sm` (and `--text-md` when wide) via `cssValue()`, `--text-sm` as the floor, inset by `--space-1`.
3. **Polish** · Re-shoot the stale state shots from HEAD (falling notes mid-song with Listen on; a song-lit key next to a pressed key; light and dark).
4. **Polish** · `Keyboard.module.css:55-62` · Bar on a hand-lit key uses `--text-muted`, the pressed-key grey; use `--on-accent` or remove it.
5. **Polish** · `Keyboard.module.css:20, 41` · Remove the 120 ms transform transition on key press; use `var(--space-1)` instead of `translateY(2px)` or document 2px.
6. **Polish** · `Play.tsx:259-282` · Listening / error / too-long lines are inserted above the stage and shrink the falling area mid-song (notes jump and change speed). Reserve one fixed-height slot (min-height 44px).
7. **Polish** · Play at 1024x640 · ~165 px of falling area. Move song title into the header, piano status as the Sound screen's pill, pedal + legend on one line; aim for ≥240 px at 640 tall.
8. **Polish** · `base.css:19-29` · Every action is the same filled ink button. Add token-only `.button-secondary`; one primary per screen (Library: Import file; Play: Listen; Sound: Try again / Reconnect; back links secondary).
9. **Polish** · `Library.tsx:8, 63-69` · "Play the piano" and the sample's "Play" both open `#/play` (Canon). Remove "Play the piano" until free play exists, or point it at a song-less free-play screen.
10. **Polish** · `Library.tsx:96-101` · Empty-state sentence reads like a description of the sample; " · sample" glued to the title. Move the text after the list with a separator; show "Sample" as a muted tag.
11. **Polish** · `soundText.ts:60` · Piano card headline is a 75-char sentence at `--text-xl`. Split: "No piano found." headline, the rest at `--text-md` muted.
12. **Polish** · Sound/Latency/Library at 1920 · Panels stretch to 1824 px with content capped at 60ch. Cap the panel column; `--space-6` padding on every panel.
13. **Polish** · `Latency.tsx:204-210` · "Test again" and "Save report" enabled at 0 keys with no piano. `aria-disabled` until a key is timed.
14. **Polish** · `Play.tsx:288` · Legend at `--text-sm` muted; make it `--text-md` with hand-colour chips holding R / L.

## Fixed since last round
- First round.

What works: tokens everywhere in CSS, 44 px targets, visible focus, reduced motion handled, complete dark mode, pressed keys with three signals, notes line up with keys, Middle C labelled.

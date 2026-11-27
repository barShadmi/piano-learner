# Phase 1 · round 1 · fixes

Every Blocking item, plus the quick Polish items. De-duplicated. Each fix is one builder step, checked by the verifier, one commit each. Longer Polish items go to `../later.md`.

## Fix 1 · Play controls say what they do (Blocking: design 1, student 1, words 1, code 1; Polish: design 6, 8, student 2, words 10, 11, a11y 6)
Files: `Play.tsx`, `Play.module.css`, `styles/base.css`, a small pure helper `src/renderer/src/screens/playState.ts` + test, `e2e/app.spec.ts`.
- Buttons in a fixed order: **Listen** (primary, `.button`), **Watch (no sound)**, **Pause**, **Restart song** (secondary). Add a token-only `.button-secondary` in base.css (`--surface` fill, `--text` text, `--border-strong` edge, same size and focus as `.button`).
- The running mode shows on its button: `aria-pressed="true"` plus a visible pressed style (`--surface-raised` fill, `--text` border, a ● glyph before the word). Pause is `aria-disabled="true"` when nothing is playing (clicks do nothing).
- After Pause, the button of the mode that was running reads "Continue with sound" / "Continue without sound" is NOT needed: pressing the same mode button continues from where it stopped (both already resume from the clock position). Keep it simple.
- One `role="status"` line under the buttons, in a slot that always has the same height (min-height 44px, so the falling area never jumps): "Playing with sound." / "Playing without sound." / "Paused." / "Song finished. Press Listen to hear it again." / the engine's plain reason with the "Open Sound settings" link / empty before the first press. The too-long note goes in the same slot area as a second fixed line only when `plan.cut`: "Listen plays only the first part of this long song." Piano status stays where it is.
- Under the buttons, a hint in `--text-muted`: "Listen plays the song with sound. Watch shows the notes only."
- First note bug: when the lead-in timer fires, `clock.seek(0)` and send `fromMs = 0` in the same callback. Pull the start-time choice into a pure helper (e.g. `engineStartMs(clockNowS)`: `fromS < 0` → wait; at the lead-in end → 0) with a test that fails today.
- The state rules (which status, which button pressed, Pause enabled) come from the pure helper so they are unit tested.
- e2e: update button names; Listen in CI shows the plain reason and the notes still fall; Pause is aria-disabled before any press.

## Fix 2 · Falling-note labels: token sizes and hand on every note (Blocking: design 2, a11y 1; Polish: a11y 5)
Files: `falling/FallingNotes.tsx`, `falling/colors.ts` or a new pure `falling/label.ts` + test.
- Label text: finger number notes show "R1" / "L3"; notes without a finger show "R" / "L". When "R1" does not fit, show the hand letter alone (hand is never colour only; the finger can drop).
- Size from tokens read with `cssValue()`: `--text-md` when the note is wide enough, else `--text-sm`; `--text-sm` is the floor — a note narrower than that shows no label (its key below is lit with R/L, see Fix 3). No hard-coded 9/12/14/2 values; inset from the note's bottom by `--space-1`.
- Unit test of the pure label chooser: same finger, two hands → different text; narrow → letter only; too narrow → none.
- Keep the per-frame no-allocation rule (pre-make the label strings).

## Fix 3 · Lit keys show the hand without colour (Blocking: a11y 2; Polish: design 4)
Files: `keyboard/Keyboard.tsx`, `Keyboard.module.css`, `Keyboard.test.tsx`.
- Black keys lit by the song also get the "R" / "L" letter (`--text-sm`, `--on-accent`), like white keys.
- The bottom bar on a song-lit key uses `--on-accent` (not `--text-muted`), on white and black keys.
- Forced colours: right and left must differ by the letter (already) — check it shows there.
- Tests: a lit black key shows its letter; bar class present.
- Not changed (plan decision, task 7): the 2 px press move with `--dur-fast`, removed under reduced motion. Design 5 asks to remove it; the keyboard plan chose it as one of the three press signals.

## Fix 4 · Delay and Sound words (Blocking: words 2; Polish: words 3–8, 12, 14, student 6, 7, design 11, 13, a11y 3, 4, 8, perf 3)
Files: `shared/latency.ts` + test, `screens/Latency.tsx` + css, `screens/soundText.ts` + test, `SoundSettings.tsx` + css, `Sound.tsx` + css, native error strings in `native/audio-engine/src/output/cpal_out.rs` and `output/mod.rs` (words only).
- Verdict names what it judges, and the big number says it is the typical key: "Typical key: about 8.0 ms." Verdicts: "Almost every key sounds in under 10 ms. Good." / "Most keys are fast, but some take over 10 ms." / "Some keys take over 15 ms. Too slow." (match the existing p95 thresholds).
- One name per setting: the Sound screen field is "Mode"; options as now; tips say "On the Sound screen, set Mode to Fastest (exclusive) or ASIO driver." Links say "Sound" to match the library button.
- Buffer hint under the field: "Smaller is faster. If you hear crackles, pick a bigger one."
- Details labels: "Typical key", "Almost every key (95 in 100)", "Sound gaps".
- "Test again" → "Start over"; Start over and Save report `aria-disabled` until one key is timed, with "Play a key first." After saving: "Report saved." and a "Show report" button.
- SOUND_OFF_LINE: "Sound is off. Go back to Sound and press Start sound or Try again." Sound.tsx:281 "Turn sound on first. Use Try again or Start sound above."
- Progress line `aria-live="polite"` (only changes every 5 keys and at 20); result and verdict in `role="status"`.
- Progress fill animates `transform: scaleX()` not `width`.
- Report text: the sound card figure "reported by the sound driver" for WASAPI, "measured" for the others; one correct doc comment on `latency_ms`.
- Piano card headline: "No piano found." at `--text-xl`, the rest at `--text-md` muted.
- `--correct` word on `--correct-soft`: word in `--text`, keep `--correct` for border and glyph. Selects use `--border-strong`.
- Native errors: "PianoLearner" (not "Piano Learner"), no raw hex code in the words, "sound format" not "sample format", no "backend".

## Fix 5 · Library, routes and import words (Polish: design 9, 10, student 3, 4, 5, words 9, 13, 15, a11y 7)
Files: `Library.tsx` + css, `App.tsx`, `src/main/import/*` error strings + tests, `FallingNotes.tsx:373` text only, e2e.
- Remove "Play the piano" (the sample's Play opens the same screen; free play comes later). Import file is the one primary button; Sound becomes `.button-secondary`.
- Sample row: title, then a muted "Sample" tag. Empty-state sentence moves under the list, after a separator: "You have no songs of your own yet. Press Import file to add a MIDI or MusicXML file. Sheet music photos and videos come later."
- Long titles: `.rowTitle { min-width: 0 }`, Play button `flex-shrink: 0`.
- Route change: `document.title` = "<Screen> · PianoLearner"; focus moves to the screen's h1 (`tabIndex={-1}`, no visible outline on that h1 only).
- Import errors with next steps: "too big. Pick a file under 20 MB."; "could not be turned into a song. Try another copy of the song."; "Importing took too long. Try a smaller file."; "This file has no notes. Pick another file."
- Falling-notes failure line adds "Restart the app. You can still play and hear the piano."

## Fix 6 · Quick code clean-ups (Polish: code 6, 8, perf 7, 9, code 2 partly)
Files: `api.rs`, `ipc.ts`, `audioController.ts`, `songEvents.ts` + test, `songStore.ts` + test, `song/mod.rs`.
- Remove unused `latencySamples` export and `songEventsFor`. `ipc.ts:57` returns a full `AudioState` (with `piano` from `audio.state()`).
- `listSongs` with `fs.promises`, files read in parallel; handler async.
- Song thread spin: about 500 µs when the high-resolution timer exists, 3 ms on the fallback. Timing tests stay green.

## Not fixed now (to `../later.md`)
Typed IPC map (code 2), song/live voices by source (code 3), file splits (code 4, 5), audioController older-addon branches (code 6, last part), Windows cargo test + clippy in CI (code 7), WASAPI late-buffer underrun count (perf 1), instant steal (perf 2), locked sample memory (perf 4), render-time budget test (perf 5), long-frame e2e on a dense song (perf 6), axe in e2e (a11y 9), Play layout at 1024x640 (design 7), panel widths at 1920 (design 12).
Re-shoot of the state screenshots (design 3, student 9) happens before round 2.

# Phase 1 · Task 5 · Latency test and report, target under 10 ms

Goal: Bar can see, in plain numbers, how long it takes from pressing a key on the P-121 to hearing it in his headphones, and that it is under 10 ms.

How we measure (lead): there is no microphone loopback, so the engine measures every step it owns and adds the parts the driver reports:
1. `midi_us`: when the MIDI message reached the app (stamped in the MIDI callback, task 2).
2. `picked_us`: when the audio thread picked that key up (start of the callback that handled it). `picked - midi` is the wait for the next audio buffer.
3. `output_ms`: how long until that buffer leaves the speakers: the buffer length plus the device latency the driver reports (WASAPI `GetStreamLatency`, or cpal's measured playback delay). From task 1's `outputLatencyMs`.
4. USB MIDI transport from the piano (about 1 ms for USB full-speed MIDI; we add a fixed 1.0 ms and say so in the report).
Key-to-sound = (picked − midi) + output + 1.0 ms. This is an honest upper-side estimate; it does not include the headphone cable (0 ms) or the piano's own key scanning (a fraction of a ms, unknown).

## Step 1 · Timing in the engine (builder-plus, hard: true)
Files: `native/audio-engine/src/core/command.rs` (`NoteOn` gains `midi_us: u64`; still `Copy`), `src/core/midi_msg.rs` / `src/midi/mod.rs` (fill it from the callback's stamp; screen-path events keep `timeUs`), `src/core/mod.rs` (at the start of `process`, read the clock once; for each NoteOn popped from the MIDI ring, push `LatencySample { note, midi_us, picked_us }` into a latency ring owned by the audio thread — a failed push is just dropped, never blocks), `src/core/clock.rs` (new: one monotonic microsecond clock shared by the MIDI thread and the audio thread, `Instant`-based from a single `OnceLock` epoch), `src/output/mod.rs` (each session's latency consumer; the engine drains it on the control side into a fixed-size history of the last 200 samples), `src/api.rs` (`latencySamples(): { note, waitMs, outputMs, totalMs }[]` drains and returns new samples; `latencySummary(): { count, medianMs, p95Ms, maxMs, outputMs, bufferFrames, sampleRate, backend, underruns }` over the history; `clearLatency()`), `index.d.ts`, `tests/no_alloc.rs`.
Tests first: the clock never goes backwards across threads; a NoteOn with `midi_us` popped in `process` produces exactly one sample with `picked_us >= midi_us`; a full latency ring drops without blocking or allocating; summary maths (median, 95th percentile, max) on a known list; total = wait + output + 1.0; no allocation in `process` with latency samples.
Acceptance: cargo test, clippy (plain + all-targets), Windows check, `npm run build` in the crate, node check that `latencySummary()` returns zeros and count 0 here.

## Step 2 · The latency test screen and report (builder)
Notes from step 1: `latencySummary().backend` is "" when no output is running. Call `clearLatency()` when the Delay test screen opens and on Test again, and whenever sound restarts, so a report never mixes two settings. The output part is the value measured when sound started; the report says so ("measured when sound started").
Files: `src/main/ipc.ts`, `src/main/audioController.ts` + test (`latency:summary`, `latency:clear`, `latency:save` writes `latency-report.txt` and `.json` to the app's user data folder and returns the path; `latency:open-folder` uses `shell.showItemInFolder`), `src/preload/*` (`pianoLearner.latency.{summary,clear,save,showFile}`), `src/shared/latency.ts` + test (pure: `verdict(summary)` → `'good'` when p95 < 10 ms, `'close'` 10–15, `'slow'` above; report text builder), `src/renderer/src/routes.ts` (+ `latency`), `src/renderer/src/screens/Latency.tsx` + `.module.css`, a "Test the delay" link on the Sound screen, `scripts/screens.config.ts`, `e2e/app.spec.ts`.
Screen (plain words, tokens only, ≥ 44 px, symbol + word):
- Heading "Delay test". One line: "Play any key on the piano 20 times, at any speed. The app measures how long each key takes to sound."
- Progress "7 of 20 keys" with a progress bar (role progressbar, aria-valuenow).
- When 20 are in: big result "About 4.2 ms from key to sound" and a verdict: "✓ Great. Under 10 ms, you will not feel any delay." / "▲ Close to the limit…" / "✗ Too slow…" with what to try ("Choose exclusive mode or ASIO in Sound settings", "Use a smaller buffer").
- Details table: typical (median), slowest of most (95%), slowest, of which waiting for the sound card, sound card and driver, USB from the piano (1 ms, estimated); output mode, buffer, sample rate, sound gaps (underruns).
- Buttons: "Test again", "Save report" (then "Saved. Show file").
- No piano connected: "Connect the piano to run the test." and the Reconnect piano button.
e2e: the Delay test screen opens from Sound, shows the no-piano message here, Save report writes a file (call the bridge in the test, check the returned path exists).
Acceptance: npm test, lint, build, e2e pass; screenshots light and dark of the Delay test (empty state).

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder-plus (Sonnet) | 1 | PASS. The estimate errs high (WASAPI exclusive: buffer + stream latency; cpal: measured delay). |
| 2 | builder (Haiku) | 2 | FAIL (timings cleared before restart, flaky Tab e2e), then PASS. Flaky Tab tests now wait for window focus. |

# Code · phase 1 · round 2
Score: 8/10

What I checked: commits e844821..HEAD, with the round 1 fixes read line by line. All local checks pass. Vitest ran 33 files and 476 tests. `cargo test` ran 242 unit tests plus 6 in `no_alloc`. `cargo clippy --all-targets -D warnings`, `eslint .` and `tsc` on both tsconfigs found nothing.

I traced the Play state rules through every path, and none of them is a real bug for Bar. The paths were:
- idle, Listen, then the lead-in timer fires;
- paused in the lead-in, then Listen again;
- Pause while the engine reply is still on its way (the session guard drops the late reply);
- an engine refusal (the screen goes to Watch with the reason);
- finished, then Listen or Watch (both go back to the lead-in);
- the drift check during the lead-in (the engine reports no position, so the clock is left alone).

There are no Blocking items left. Items already in `later.md` are not repeated.

## Must fix to reach 10
1. **Polish** · `src/renderer/src/screens/playState.ts:17-19` and `playState.test.ts:15-19` · **The first-note test cannot fail.**
   - `leadInEnd()` returns a constant, and its test only checks that constant. If `Play.tsx:174-176` went back to `send(clock.nowSeconds() * 1000)`, every test would still pass. The fix itself, in `Play.tsx:171-177`, is correct.
   - Good looks like: a `Play.test.tsx`, in the same style as `Keyboard.test.tsx`. It mocks `FallingNotes`, stubs `window.pianoLearner` (`song.play`, `song.stop`, `song.position`, `midi.status`, `midi.onEvents`) and uses `vi.useFakeTimers()`. It clicks Listen, advances the timers by 2005 ms, and checks `song.play` was called once with `fromMs === 0`. A second case: after Pause in the lead-in and Listen again, the engine still starts at 0.
2. **Polish** · `src/renderer/src/screens/Play.tsx:142` with `playState.ts:36` · **"Playing with sound." shows during the whole 2 s lead-in even when sound is off.**
   - The engine is only asked at the end of the lead-in. So with no sound running, Bar reads "Playing with sound." for 2 seconds before it changes to "Sound is not on yet."
   - The e2e test at `e2e/app.spec.ts:313` locks this in: it expects "Playing with sound." in a container with no sound card.
   - Good looks like: add an activity `'starting'` (status "Starting the sound…", Listen still pressed) until the engine's first answer. Even better, also check sound is on when Listen is pressed (for example with `audio.state()`), so the reason shows at once. Then the e2e test expects the reason, not "Playing with sound."
3. **Polish** · `src/renderer/src/screens/Latency.tsx:97-108, 234` · **"Show report" can open an old report.**
   - `saved` goes back to false only in `startOver`. If Bar saves after 5 keys and then plays 15 more, the button says "Show report" and opens the file with the 5-key numbers.
   - Good looks like: `setSaved(false)` (and clear "Report saved.") whenever `summary.count` changes after a save. Add a test with a stubbed `latency.summary` that grows after the save.
4. **Polish** · `native/audio-engine/src/song/mod.rs:121-127` · **The new 0.5 ms spin is only tested through a fake clock.**
   - `PreciseClock` in `song/tests.rs:199-226` checks how the trait is used. Nothing checks that `RealClock` on Windows really picks 500 µs after `thread_begin`.
   - This joins the known later item for Windows `cargo test` in CI. When that job is added, include a Windows-only test: `thread_begin()`, then `spin_us() == 500` when `has_high_res_timer()` is true, and `3000` after `thread_end()`.

## Fixed since last round
- **Blocking 1, first note silent in Listen:** fixed. At the end of the lead-in, `Play.tsx:174-176` seeks the clock to 0 and sends `fromMs = 0` in the same callback, so `partition_point(time_ms < 0)` keeps the events at 0 ms. The test of the fix is weak; see item 1.
- **Polish 2 (part), `audio:start` reply missing `piano`:** fixed at `src/main/ipc.ts:265`, with a real handler test in `src/main/ipc.test.ts`. The typed IPC map itself is in `later.md`.
- **Polish 6 (part), dead code:** fixed. The `latencySamples` export and `songEventsFor` are removed. The `audio:start` config branch now has a test, and the old-addon branches are in `later.md`.
- **Polish 8, song list blocked the main process:** fixed. `listSongs` uses `fs/promises`, reads the files in parallel, and the handler is async. Single-file `getSong` stays synchronous, which is fine.
- **Falling-note labels:** correct. `falling/label.ts` is pure and tested. It takes its sizes from the `--text-md`, `--text-sm` and `--space-1` tokens, and its label strings are made in advance, so nothing new is created each frame. The hand is always in the label or shown by an edge stripe.
- **Lit black keys:** now show R/L, and the bar uses `--on-accent`. Both are tested in `Keyboard.test.tsx`.
- **Delay test words:** the verdict is judged on the figure as shown, so 9.96 shows as 10.0 and is never called good. The words now agree with the typical key, all three verdicts are tested, and `shared/modes.ts` gives the Sound screen, the delay test and the report one name per mode.
- **Spin change:** `spin_us()` is read once per song, after `thread_begin`. It is 500 µs only when the high-resolution timer exists, otherwise 3 ms. A late wake-up can only make an event late, never early. The timing tests pass.
- **Route titles and focus:** `routes.ts` and `App.tsx` set the window title for each screen, and route changes move focus to the screen's h1, but not when focus is already inside the screen.

Files cited:
- /home/user/piano-learner/src/renderer/src/screens/playState.ts
- /home/user/piano-learner/src/renderer/src/screens/playState.test.ts
- /home/user/piano-learner/src/renderer/src/screens/Play.tsx
- /home/user/piano-learner/e2e/app.spec.ts
- /home/user/piano-learner/src/renderer/src/screens/Latency.tsx
- /home/user/piano-learner/native/audio-engine/src/song/mod.rs
- /home/user/piano-learner/native/audio-engine/src/song/tests.rs
- /home/user/piano-learner/src/main/ipc.ts
- /home/user/piano-learner/src/main/ipc.test.ts
- /home/user/piano-learner/src/main/songStore.ts
- /home/user/piano-learner/src/renderer/src/falling/label.ts
- /home/user/piano-learner/src/renderer/src/falling/FallingNotes.tsx

# Code · phase 1 · round 1
Score: 7/10

What I checked: git range 7ddce18..HEAD, excluding `.claude`. Locally, Vitest passed (29 files, 430 tests), and `cargo test` passed (240 unit tests plus 6 in `no_alloc`). `tsc` on both tsconfigs and `eslint .` found nothing. The code is split cleanly into main, preload, renderer, shared and native. The live-key path (midir callback, then `MidiSink` with `try_lock`, then the rtrb ring, then `EngineCore::process`) never touches the screen code or Web Audio. Every `unsafe` block in `song/win.rs` and `output/wasapi_exclusive.rs` has a `// SAFETY:` comment. There is a no-allocation test on the audio callback.

## Must fix to reach 10
1. **Blocking** · Play screen, Listen · **The first note of a song is never heard when Listen starts from the beginning.**
   - Where: `src/renderer/src/screens/Play.tsx:155-165` (line 162 sends `Math.max(0, clock.nowSeconds() * 1000)`), together with `native/audio-engine/src/song/mod.rs:187` (`partition_point(|e| e.time_ms < from_ms)`).
   - Why: the lead-in timer fires at or after 2000 ms, so the clock is already a few ms past 0 and `fromMs` comes out at about 1 to 16. The engine then skips every event at 0 ms.
   - Effect: the bundled sample's first note (pitch 50 at start 0, in `canon-opening.json`), and any imported MIDI or MusicXML that starts on beat 1, falls and lights on the keyboard but makes no sound. That misleads Bar in Listen mode.
   - Good looks like: when the lead-in ends, the timer sends `fromMs = 0` and seeks the clock to 0 in the same callback, for example `clock.seek(0); send(0)`. The existing drift correction handles the rest. Add a test that fails today: either a Vitest test of a small `listenStart(fromS)` helper pulled out of `listen`, or an e2e test with a stub engine, checking that a Listen started in the lead-in sends `fromMs === 0`.
2. **Polish** · IPC · **The IPC is typed only by a hand-written `.d.ts`, not checked against the handlers.**
   - Where: `src/preload/index.ts:13-62` returns untyped `ipcRenderer.invoke('…')` with the channel names as bare strings. Those strings are repeated in `src/main/ipc.ts:27-120`. `src/preload/index.d.ts` declares the reply types by hand.
   - A real mismatch already exists: `src/main/ipc.ts:57` returns `{ phase: 'failed', error }` without the required `piano` field, while the d.ts promises `Promise<AudioState>`.
   - Good looks like: one `src/shared/ipc.ts` map from each channel to its argument and reply types (for example `'audio:start': { arg: StartConfig | undefined; reply: AudioState }`). Add a typed `handle()` wrapper in main and a typed `invoke()` in preload so `tsc` catches a wrong reply. Then `ipc.ts:57` returns `{ phase: 'failed', error, piano: … }` taken from `audio.state()`.
3. **Polish** · Engine mixer · **Song notes and Bar's own keys share the same voices and key-off.**
   - Where: `native/audio-engine/src/core/mixer.rs:212` (`retrigger`) and `:219-222` (`key_off`), reached from `core/mod.rs:129-135`.
   - Effect: a song NoteOff, including the releases when Listen stops (`song/mod.rs:246-256`), cuts a key Bar is holding at the same pitch. A song NoteOn fades it out. A dense song can also steal his voice.
   - Good looks like: the mixer tags each voice with its source (live or song). Key-off and retrigger for a song command only touch song voices, and voice stealing prefers song voices. Add a mixer test: hold note 60 live, send a song NoteOff 60, and the live voice must still be key-down.
4. **Polish** · `native/audio-engine/src/output/mod.rs:1-795` · **One file holds about 800 lines of non-test code with three jobs:** sample format conversion (67-137), latency history and summary (373-475), and engine lifecycle and piano loading (491-795).
   - Good looks like: split into `output/convert.rs`, `output/latency.rs` and `output/engine.rs`. Each test group moves with its code.
5. **Polish** · `src/renderer/src/falling/FallingNotes.tsx:125-369` · **One `useEffect` closure is about 245 lines.** It covers Pixi start-up, the note pool, resize and density watching, the theme observer, drawing and the fps counter.
   - Good looks like: move the pool and `restyle`/`draw` into `falling/noteLayer.ts` (a plain class with `draw(nowS)` and `destroy()`). The component keeps only start-up, observers and the frame loop. Likewise, move the Listen logic in `src/renderer/src/screens/Play.tsx:98-208` into a `useListen(clock, songEvents, startS, endS)` hook.
6. **Polish** · Dead code. Remove each of these, or wire it up if it is meant to be used.
   - `native/audio-engine/src/api.rs:245-253`: the `latencySamples` napi export is never called from JS.
   - `src/main/ipc.ts:55-58` with `parseStartConfig` in `src/main/audioValidate.ts`: the `audio:start` config branch is never used, because the renderer only calls `audio.start()` with no argument (`Sound.tsx:123`). Settings go through `settings:set`.
   - `src/renderer/src/falling/songEvents.ts:75-78`: `songEventsFor` is only used by its own test.
   - `src/main/audioController.ts:40-80`: the `Partial<…>` "older addon" parts and their `typeof … !== 'function'` branches. The addon ships inside the installer, so it can never be older than the app. Either check every function in `loadEngine` (`src/main/audio.ts:39`) and drop the branches, or keep only the ones the tests really need, with a comment saying why.
7. **Polish** · `.github/workflows/ci.yml:50-79` · **Bar's real sound path is built in CI but never tested or linted.** The Windows job only builds the installer, so `output/wasapi_exclusive.rs` and `song/win.rs` (the `#[cfg(windows)]` code) are never tested or clippy-checked. The Linux job cannot compile them.
   - Good looks like: add `cargo clippy --all-targets -- -D warnings` and `cargo test` (working directory `native/audio-engine`) to the `windows-installer` job before `dist:win`. Add one Windows-only test of `win::Sleeper`: `sleep(2000)` returns in under 5 ms, and `wake()` cuts a `sleep(1_000_000)` short.
8. **Polish** · `src/main/songStore.ts:24-40` · **The song list reads every file synchronously.** `songs:list` runs `readFileSync` plus a full `validateSong` on every song file, every time the library opens, on the Electron main thread. That is fine for a handful of songs, but it blocks the main process as the library grows.
   - Good looks like: use `fs/promises` and make the handler `async`, or keep a small `index.json` of summaries that `saveSong` updates.

## Fixed since last round
- First round.

Main files cited:
- /home/user/piano-learner/src/renderer/src/screens/Play.tsx
- /home/user/piano-learner/native/audio-engine/src/song/mod.rs
- /home/user/piano-learner/native/audio-engine/src/core/mixer.rs
- /home/user/piano-learner/src/main/ipc.ts
- /home/user/piano-learner/src/preload/index.ts
- /home/user/piano-learner/native/audio-engine/src/output/mod.rs
- /home/user/piano-learner/src/renderer/src/falling/FallingNotes.tsx
- /home/user/piano-learner/.github/workflows/ci.yml

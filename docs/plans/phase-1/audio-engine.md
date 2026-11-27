# Phase 1 · Task 1 · Rust audio engine, WASAPI exclusive output, test tone

Goal: a native Rust audio engine (`native/audio-engine`) loaded by the Electron main process as a Node addon (napi-rs). It opens the PC's audio output with the lowest latency Windows offers (WASAPI exclusive, event-driven) and plays a test tone. The screens never touch sound: they send small commands through the preload to the main process, which calls the engine.

Decisions (lead):
- WASAPI exclusive via the `wasapi` crate on Windows (cpal's WASAPI is shared mode only). cpal is the fallback: Windows shared mode if exclusive fails, and the only backend on Linux/macOS (CI and development).
- ASIO too (Bar chose "Add ASIO now" on 2026-11-27): through cpal's `asio` host, behind a cargo feature `asio` that only the Windows CI build turns on (asio-sys fetches the Steinberg SDK and runs bindgen with LLVM at build time). ASIO devices are listed only when an ASIO driver is installed. The default stays WASAPI exclusive; ASIO is chosen in Settings (task 6).
- Audio thread rules: no allocation, no locks, no I/O, no logging in the render callback. Commands reach it through an `rtrb` single-producer single-consumer ring. Status comes back through atomics.
- The addon is loaded only in the main process (the preload is sandboxed). If it fails to load, the app still opens and the Sound screen says so.
- Crate versions (latest on 2026-11-27): napi 3.16.3, napi-derive 3.7.2, napi-build 2.7.0, @napi-rs/cli 3.11.1, wasapi 0.27.0, cpal 0.18.2, rtrb 0.4.1.

## Step 1 · Engine core, platform-free (builder-plus, hard: true)
Files: `native/audio-engine/Cargo.toml`, `native/audio-engine/build.rs`, `native/audio-engine/src/lib.rs` (only `mod` lines for now plus a stub), `native/audio-engine/src/core/mod.rs`, `native/audio-engine/src/core/command.rs`, `native/audio-engine/src/core/mixer.rs`, `native/audio-engine/src/core/tone.rs`, `.gitignore` (add `native/audio-engine/target/`, `*.node`).
- Crate `audio-engine`, `crate-type = ["cdylib", "rlib"]`, edition 2021, release profile `opt-level = 3`, `lto = "thin"`, `codegen-units = 1`.
- `Command` enum (Copy, no heap data): `PlayTestTone { frequency_hz: f32, seconds: f32, gain: f32 }`, `StopAll`, `SetMasterVolume(f32)`.
- `Mixer` owns a fixed array of 8 tone voices (preallocated, no `Vec` growth after `new`). `Mixer::new(sample_rate: u32, channels: u16)`. `Mixer::handle(cmd: Command)`. `Mixer::render(out: &mut [f32])` fills interleaved frames, mixes active voices, applies master volume, never allocates. Tone voice: sine with 5 ms linear attack and 20 ms release so it never clicks. Output is clamped to -1..1.
- `EngineCore` = `rtrb::Consumer<Command>` + `Mixer`; `EngineCore::process(out)` drains all pending commands then renders. `core::channel(capacity) -> (rtrb::Producer<Command>, Consumer)` helper.
- Shared status: `EngineStats` with `AtomicU64` callbacks count, `AtomicU32` last buffer frames, `AtomicU64` underrun count (set by backends later), `AtomicBool` running.
Tests first (`cargo test`, in each module):
1. Silence when no voice: render 512 frames, all zero.
2. A 440 Hz tone at 48 kHz: after the attack, zero crossings over 1 s ≈ 880 (±2); peak ≈ gain (±0.01).
3. Attack: the first sample is 0 and the first 5 ms rise monotonically in envelope.
4. Release: after `seconds` the voice ends within 20 ms and the following output is zero.
5. `StopAll` fades out within 20 ms (no jump bigger than 0.05 between neighbouring samples).
6. Stereo: both channels carry the same sample.
7. Master volume 0.5 halves the peak.
8. No allocation in `render`/`process`: a counting global allocator test (`#[global_allocator]` in a test-only binary, `tests/no_alloc.rs`) shows 0 allocations across 1000 `process` calls with commands pending.
Acceptance: `cd native/audio-engine && cargo test` passes all of the above; `cargo clippy -- -D warnings` clean; no `unsafe` outside the test allocator.

## Step 2 · Output backends and Node API (builder-plus, hard: true)
Also fix three things the step 1 verifier found, each with a test first: (a) a stolen voice fades out over about 2 ms before the new tone starts (no step bigger than 0.05 at gain 0.25 when the 9th tone arrives); (b) master volume ramps over about 10 ms instead of jumping; (c) tone phase wraps with `phase -= phase.floor()` and frequencies at or above Nyquist are ignored.

Files: `native/audio-engine/src/output/mod.rs`, `src/output/cpal_out.rs`, `src/output/wasapi_exclusive.rs` (`#[cfg(windows)]`), `src/api.rs`, `src/lib.rs`, `Cargo.toml`, `native/audio-engine/package.json`, `native/audio-engine/index.d.ts` (generated, committed).
- `OutputDevice { id: String, name: String, is_default: bool, backend: "wasapi-exclusive" | "wasapi-shared" | "asio" | "cpal" }`.
- `list_outputs()`: on Windows every render endpoint once as wasapi-exclusive and once as wasapi-shared, plus every ASIO driver when the `asio` feature is on; elsewhere cpal devices. `src/output/asio_out.rs` (`#[cfg(all(windows, feature = "asio"))]`) opens the ASIO device through cpal with a fixed buffer size (the requested frames, or the driver's nearest supported size).
- `start(config: { deviceId?: string, backend?: string, bufferFrames?: number })`: default device, default backend `wasapi-exclusive` on Windows (else `cpal`), default buffer 128 frames. WASAPI exclusive: event-driven, pick 48000 then 44100 Hz, f32 then i16 (converting from the f32 mix), period = buffer frames aligned with `IAudioClient` rules (use the device minimum if larger), MMCSS "Pro Audio" priority on the render thread. If exclusive fails (device busy, format refused), fall back to shared and report the reason. Returns `StartResult { backend, deviceName, sampleRate, bufferFrames, outputLatencyMs, fallbackReason? }`, where `outputLatencyMs` is buffer frames / sample rate plus the device latency the driver reports.
- `stop()`, `play_test_tone(frequencyHz?, seconds?)` (defaults 440, 1.0, gain 0.25), `set_volume(0..1)`, `status() -> { running, backend, sampleRate, bufferFrames, callbacks, underruns }`.
- The Node API holds the `Producer` behind a `Mutex` on the JS side only (never touched by the audio thread). The render thread owns `EngineCore`. Errors become JS errors with plain English messages.
- The cpal stream stays on its own thread (cpal `Stream` is not `Send` on every platform): a control thread owns it and takes start/stop requests over a std channel.
- `package.json` in the crate: `@napi-rs/cli` build script `napi build --platform --release --output-dir .` producing `audio-engine.<platform>.node`.
Tests first: unit tests for the buffer alignment helper (`align_period(frames, sample_rate, min_period_100ns)`), the i16 conversion (clamping, rounding), and `list_outputs` returning Ok in CI (may be empty). The Windows module must type-check: `cargo check --target x86_64-pc-windows-msvc` (lead runs it too).
Acceptance: `cargo test`, `cargo clippy -- -D warnings`, `cargo check --target x86_64-pc-windows-msvc` all pass; `npm run build` in the crate makes a `.node` file; `node -e "const e=require('./native/audio-engine/audio-engine.linux-x64-gnu.node'); console.log(Object.keys(e))"` lists the API.

## Step 3 · Electron wiring, Sound screen, CI (builder-plus)
Notes from step 2: `start()` and `listOutputs()` return Promises and can take a while (up to ~30 s worst case); a second `start` while one runs rejects with "Sound is already starting.", so the Sound screen shows "Starting sound…" and disables Try again meanwhile. Rust CI must run plain `cargo clippy -- -D warnings` (api.rs is cfg'd out under `--all-targets` because of the test-only `noop` feature) and `cargo test`; never `--all-features`. Windows CI builds the addon with `--features asio` (asio-sys downloads the Steinberg SDK and needs LLVM: set `LIBCLANG_PATH` to `C:\Program Files\LLVM\bin` on windows-latest). The addon file name is `audio-engine.<platform-triple>.node` (e.g. `audio-engine.win32-x64-msvc.node`, `audio-engine.linux-x64-gnu.node`).
Files: `package.json` (scripts `build:native`, run before `build`; dev dep `@napi-rs/cli`), `scripts/build-native.ts` or npm script, `electron-builder.yml` (`extraResources` copies the `.node` to `resources/native/`), `src/main/audio.ts` (loads the addon from `native/audio-engine` in development and `process.resourcesPath/native` when packaged; `loadEngine()` returns the engine or the load error), `src/main/ipc.ts` (`ipcMain.handle` for `audio:list-outputs`, `audio:start`, `audio:test-tone`, `audio:status`; each validates its input), `src/main/index.ts` (start the engine with defaults on ready, stop it before quit), `src/preload/index.ts` + `index.d.ts` (`pianoLearner.audio.{listOutputs,start,testTone,status}` only), `src/renderer/src/routes.ts` (+ `sound`), `src/renderer/src/App.tsx`, `src/renderer/src/screens/Sound.tsx` + `.module.css` (heading "Sound"; status line in plain words, e.g. "Sound is on: Headphones (Realtek), exclusive mode, 128 samples, 2.7 ms"; a "Play test sound" button; if the engine could not start, "Sound could not start" plus the reason and a "Try again" button), a link to Sound from the library header, `e2e/app.spec.ts` (bridge keys now `version` and `audio`; Sound screen opens; Play test sound is a button), `.github/workflows/ci.yml` (Linux: `sudo apt-get install -y libasound2-dev`, Rust cache; both jobs build the addon before tests/installer), `scripts/package.test.ts` if it checks packaged files.
- Tokens only; hit areas ≥ 44 px; the button is reachable by keyboard; words are short and plain.
Tests first: vitest for the IPC input validators (`parseStartConfig`, `parseToneArgs`) and `routes` (`#/sound` → `sound`); e2e as above.
Acceptance: `npm test`, `npm run lint`, `npm run build`, `xvfb-run -a npm run test:e2e` pass (the CI container has no sound card: the Sound screen must show the "could not start" state there without crashing); screenshots of the Sound screen light and dark; CI green on the PR, Windows installer built and contains `resources/native/*.node`.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder-plus (Sonnet) | 1 | PASS (voice-steal click, volume ramp, phase wrap moved to step 2) |
| 2 | builder-plus (Sonnet) | 2 | FAIL (ASIO buffer step, latency, sync start, 5 minor), then PASS. Lead: measured cpal/ASIO latency is used on its own (it already holds the buffer). ASIO uses the driver's preferred size if the requested one is refused (cpal hides the step). |
| 3 | builder-plus (Sonnet) | 1 | PASS. Lead approved the extra `audio.state()` call (it carries the device name and failure reason), Try again is hidden while starting, `@napi-rs/cli` lives in the native folder's package.json. Lead fixes: no build command in the missing-engine message, failed poll shows the failed state, CI checks the exact Windows engine file. Later: Sound screen watches `status().failed`; IPC sender check. |

# Fix: bad sound in Fastest (exclusive) mode on some headphones

## Problem (Bar's gate, 2026-11-28)
On Bar's HyperX Cloud III S Wireless (USB dongle), "Fastest (exclusive)" always
sounds bad (beep / buzzy bass), every time he picks it, at buffer 512. "Shared
with other apps" sounds fine. PR #12 (load piano first, stall recovery) did not
help, so this is not a start-up race.

Most likely cause: `open_exclusive` in `native/audio-engine/src/output/wasapi_exclusive.rs`
asks for 32-bit float first. Many USB audio drivers say yes to formats they do
not really play well in exclusive mode. Shared mode always plays the device's
own format (Windows converts for us), which is why it sounds right.

## Step (builder-plus, audio engine)

### 1. Exclusive mode tries the device's own format first
- In `open_exclusive`, before the fixed list, read `device.get_device_format()`
  (wasapi 0.27, the format Windows itself uses with the device). If it maps to
  one of our `Kind`s (F32 32/32 float, I16 16/16 int, I24In32 32/24 int,
  I32 32/32 int) and 2 channels, try that format and its sample rate first
  (same `is_supported_exclusive_with_quirks` + initialise + aligned-retry path).
  If it has more than 2 channels or is 24-bit packed (24/24), skip it and use
  the list.
- Then the fixed list, integer formats before float: I24In32, I16, I32, F32,
  at the device's own rate first, then 48 000, then 44 100 (no duplicates).
- Put the ordering in a pure function in `output/mod.rs` so it is unit tested
  on Linux, e.g. `exclusive_candidates(native: Option<(SampleKind, u32 rate)>) -> Vec<(SampleKind, u32)>`
  (move the `Kind` enum to mod.rs as a plain enum if needed). Tests: native
  first, no duplicates, ints before float, rates order.
- Refactor the per-format try into a helper so the code is not duplicated.

### 2. Shared mode uses the low-delay Windows path when it can
- In `open_shared`, try `IAudioClient3` first: format = `client.get_mixformat()`
  (must be used as-is, no autoconvert on this path; only take it when the mix
  format is 32-bit float, 2 channels, else skip to the old path).
  `get_shared_mode_engine_period(&mix)` gives `min`/`fundamental`; pick the
  smallest period that is `>= requested frames`'s nearest multiple of
  `fundamental` but never below `min`, as a pure tested function
  `shared_period(requested, default, fundamental, min, max) -> u32` in mod.rs.
  Then `initialize_shared_audio_stream(&mix, TimingMode::Events, period)`.
- If any of that fails, fall back to exactly today's `EventsShared` code.
- Shared mode renders whatever `get_available_space_in_frames` says (already
  so). Check the render loop still writes `available.min(buffer_frames)`.
- If the mix format has more than 2 channels the old path (autoconvert) is used.

### 3. Tell the screen which format is playing
- Add `sample_format: String` to `StartInfo` ("16-bit", "24-bit", "32-bit",
  "32-bit float"), through `api.rs` / `index.d.ts` as `sampleFormat`, to
  `StartResult` in `src/shared/audio.ts` (optional field), and show it on the
  Sound screen next to the sample rate, e.g. "48 kHz, 16-bit". cpal/asio fill
  what they know or leave it empty (then not shown).
- Fix any TS tests / fixtures that build a `StartResult`.

## Rules
- Render loop: still no allocation, locks or logging.
- Do not change the default backend or any UI words other than the format line.
- Design tokens only. No new colours.
- Run: `cargo test` and `cargo clippy -- -D warnings` in `native/audio-engine`
  (no `--all-features`), `npm run typecheck`, `npm test`, `npm run lint`.
  Windows-only code cannot compile here: keep it simple and type-careful, CI
  builds it on Windows.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01Sz5PwR9Bw2uyJRMfibJPkM`.

# Phase 1 · Task 6 · Settings: output device, driver, buffer size, volume; headphones by default

Goal: Bar can choose where the sound goes and how fast it is, and the app remembers. Out of the box it plays through his headphones (the PC's default output) in the fastest mode.

Decisions (lead):
- Defaults: the Windows default output device (Bar's headphones are plugged into the PC, so they are the default), WASAPI exclusive, 128 samples, volume 80%, piano speakers off. A device with "headphone" in its name is marked "(headphones)" in the list, nothing more.
- Choices shown in plain words: Output ("Headphones (Realtek)"…), Mode: "Fastest (exclusive)" = wasapi-exclusive, "Shared with other apps" = wasapi-shared, "ASIO driver" = asio (only listed when an ASIO driver exists); Buffer: 64, 128, 256, 512 samples, each with its time ("128 samples, about 2.7 ms"); Volume slider 0 to 100; "Let the piano's own speakers play too" checkbox (off by default).
- Settings live in `settings.json` in the app's user data folder (main process only). Every value is validated on load and on save; anything unknown falls back to the default. A missing or broken file means defaults. A saved device that is gone falls back to the default device, and the screen says so once.
- Applying: changing output, mode or buffer restarts sound with the new values (the engine already supports restart); volume and piano speakers apply at once without a restart. After a restart, the latency history is cleared.
- If a mode fails (device busy), the engine's fallback reason is shown: "Exclusive mode is busy, so the app is using shared mode. Close other apps that use sound and press Try again."

## Step 1 · Settings store in main (builder)
Files: `src/shared/settings.ts` + test (type `SoundSettings { deviceId?: string; backend: 'wasapi-exclusive'|'wasapi-shared'|'asio'|'cpal'; bufferFrames: 64|128|256|512; volume: number /*0..1*/; pianoSpeakers: boolean }`, `defaultSettings(platform)`, `parseSettings(unknown, platform)` → always a valid SoundSettings), `src/main/settingsStore.ts` + test (`loadSettings(dir)`, `saveSettings(dir, s)` atomic write via temp file + rename; uses `fs` only, tests use a temp dir), `src/main/index.ts` (load at start, start sound with them, apply volume and piano speakers), `src/main/audioController.ts` + test (`applySettings(next)`: restarts only when device/backend/buffer changed, clears latency after restart; `setVolume`; `setPianoSpeakers`), `src/main/ipc.ts` (`settings:get`, `settings:set` validated with `parseSettings`, `audio:list-outputs` already exists).
Tests first: defaults per platform (win32 → wasapi-exclusive, else cpal); parse fills defaults for missing/invalid fields, clamps volume, rejects unknown backend and buffer; store round trip; broken JSON → defaults; atomic write leaves no temp file; applySettings restarts only on the right changes.
Acceptance: npm test, lint, build, e2e pass.

## Step 2 · Sound settings on the Sound screen (builder) [frontend-design]
Files: `src/preload/*` (`pianoLearner.settings.{get,set}`), `src/renderer/src/screens/Sound.tsx` + css + `soundText.ts` + test, `src/renderer/src/screens/SoundSettings.tsx` + `.module.css` (a "Settings" section on the Sound screen: the four controls above, native `<select>`, `<input type="range">`, `<input type="checkbox">`, each with a visible label; changes save at once; a short "Saved." status with role=status), `e2e/app.spec.ts` (the controls exist and are labelled; changing the buffer to 256 saves and survives a restart of the app in the test).
Rules: tokens only, ≥ 44 px targets (the range and checkbox get a 44 px tall label area), keyboard reachable in a sensible order, plain words.
Acceptance: npm test, lint, build, e2e pass; screenshots light and dark.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 2 | FAIL (a settings change during a start was lost), then PASS. Also added: a missing saved output falls back to the default with a note; settings:set refuses non-objects. |
| 2 | builder (Haiku), then builder-plus (Sonnet) | 3 | FAIL (Try again ignored saved settings; busy-mode wording missing), FAIL (retry could replay old settings; save reply undid a volume drag), then PASS. Volume now sets live and saves on release. |

# Phase 1 · Task 4 · Local Control off on start, restored on exit

Goal: the P-121's own speakers stay quiet while the app is open (the PC plays the sound), and the piano works on its own again after the app closes.

Facts (Yamaha P-125/P-121 MIDI Reference v1.0, 2017): the P-121 receives Control Change 122 Local Control (0 = off, 127 = on). Default is on. From the panel: hold [METRONOME] and [RHYTHM] and press C5 to toggle. With Local off the keys still send MIDI over USB TO HOST. It also receives All Sound Off (120), Reset All Controllers (121), All Notes Off (123) and sends Active Sensing (0xFE). Source: https://ca.yamaha.com/files/download/other_assets/2/1209032/p125_p121_en_mr_a0.pdf

Decisions (lead):
- The engine opens the MIDI output port that matches the connected input (same `pick_port` rule; the P-121 shows one in and one out port with the same name) and sends `Bn 7A 00` on channel 1 (n = 0) right after each connect and reconnect. Then `Bn 7B 00` (All Notes Off) so nothing hangs.
- On exit (`stopMidi`, also called from before-quit) it sends `B0 7A 7F` and waits until the bytes are written (midir send is synchronous) before closing.
- If the app crashes, Local stays off until the next start (which sets it off again anyway) or until the piano is switched off and on (the P-121 does not keep Local off across power cycles). The Sound screen tells Bar this in one line, with the panel shortcut, only when he opens the help line.
- A setting `localControlOff` (default true) is kept for task 6 so Bar can let the piano's speakers play too.
- MIDI output never runs on the audio thread; it runs on the watcher thread.

## Step 1 · MIDI output and Local Control in the engine (builder-plus)
Files: `native/audio-engine/src/midi/watch.rs`, `src/midi/mod.rs`, `src/midi/local.rs` (new: message bytes, pure), `src/api.rs`, `index.d.ts`.
- `local::local_control(on: bool) -> [u8; 3]`, `local::all_notes_off() -> [u8; 3]`.
- `PortBackend` gains output: `open_output(name) -> Result<Box<dyn OutPort>>`; `OutPort::send(&[u8])`. midir `MidiOutput` on the real backend. The fake backend records sent bytes.
- After the input connects: open output by the same name (if none, record `localControl: 'unknown'` and keep going). Send Local off (when the setting is on) + All Notes Off. On disconnect drop the output. On `stopMidi`: Local on, then close. `setLocalControlOff(bool)` applies at once if connected.
- `midiStatus()` gains `localControl: 'off' | 'on' | 'unknown'`.
Tests first: byte values (B0 7A 00, B0 7A 7F, B0 7B 00); with the fake backend: connect sends [Local off, All Notes Off] in that order; reconnect sends them again; stopMidi sends Local on before closing; no output port → 'unknown' and input still works; setLocalControlOff(false) while connected sends Local on.
Acceptance: cargo test, clippy (plain, all-targets), Windows check; npm run build in the crate; node check that `midiStatus().localControl` exists.

## Step 2 · App wiring and words (builder)
Files: `src/main/audioController.ts` + test, `src/shared/audio.ts`, `src/renderer/src/screens/Sound.tsx`, `soundText.ts` + test.
- Piano panel line when connected: "The piano's own speakers are off, so you hear the PC." (localControl off) or "The piano's own speakers may still be on." (unknown) with the tip: "If you hear the sound twice, hold METRONOME and RHYTHM on the piano and press the C5 key."
- before-quit already calls stopMidi; make sure it runs before the window closes and is awaited if async.
Acceptance: npm test, lint, build, e2e pass; screenshots light and dark.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |

# Phase 1 · Task 2 · MIDI input: P-121 found, notes, velocity, sustain pedal

Goal: the engine reads the Yamaha P-121 over USB MIDI and sounds each key straight away, with the right loudness, and the sustain pedal holds notes. Key presses go MIDI thread -> lock-free ring -> audio thread. They never pass through JavaScript on the way to the speaker. A copy of each event goes to the screens (for the keyboard in task 7) on a separate path that can lag without harming sound.

Until task 3 brings the sampled piano, a simple stand-in voice plays (a soft decaying triangle tone), so this task can be heard on its own.

Decisions (lead):
- midir 0.11.2. On Windows its WinMM backend is used (the P-121 shows up as a USB-MIDI port, usually named "Digital Piano" or "P-121"; match `/p-?121|digital piano|yamaha/i`, else the first input port).
- No hot-plug events in midir, so a watcher thread looks at the port list every 2 s and connects or reconnects. Unplugging the piano never stops the sound engine.
- Velocity: MIDI 1..127 maps to gain with a curve `(v/127)^1.6` (tested; task 3 replaces the stand-in voice but keeps the curve module).
- Sustain: CC64 >= 64 is down. While down, note-offs are remembered and released when the pedal lifts. A key pressed again while sustained restarts cleanly.
- The P-121 sends Note On with velocity 0 for key up on some firmware: treat it as Note Off. Ignore Active Sensing (0xFE) and clock.

## Step 1 · Note events in the core (builder-plus, hard: true)
Files: `native/audio-engine/src/core/command.rs`, `src/core/mixer.rs`, `src/core/mod.rs`, new `src/core/midi_msg.rs`, new `src/core/voice.rs` (stand-in voice), new `src/core/velocity.rs`, `tests/no_alloc.rs`.
- `Command` gains `NoteOn { note: u8, velocity: u8 }`, `NoteOff { note: u8 }`, `Sustain(bool)`, `AllNotesOff`.
- `midi_msg::parse(bytes: &[u8]) -> Option<MidiEvent>` where `MidiEvent` is `NoteOn{note,velocity}`, `NoteOff{note}`, `Sustain(bool)`, `AllNotesOff` (CC123 / CC120). Any channel. Velocity 0 Note On = Note Off. Ignores everything else. `MidiEvent -> Command` conversion.
- Mixer: a fixed pool of 64 note voices (preallocated). Note on takes a free voice, else steals the oldest released, else the oldest, with a ~2 ms fade on the stolen voice. Same note pressed again: the old voice fades (~5 ms) and a new one starts. Sustain logic as above. Stand-in voice: triangle at the note's pitch (A4 = 440 Hz equal temperament), 2 ms attack, exponential decay to silence over ~4 s while held, 80 ms release on key up; gain from the velocity curve times 0.2.
- `EngineCore` drains two rings: the existing commands ring and a new `rtrb::Consumer<Command>` for MIDI (so the MIDI thread has its own single producer). `core::channel` stays; add `EngineCore::with_midi(commands, midi, mixer)`.
Tests first: parse table (note on, vel 0, note off 0x80, CC64 63/64/127, CC123, other channel, active sensing, short message); velocity curve monotonic, 1 > 0, 127 = 1.0; a note on makes sound at the right pitch (zero crossings for A4 and C4 ±2); note off fades within 100 ms; with sustain down the note keeps sounding after note off and stops within 100 ms of pedal up; repeated same note never has a jump > 0.05 at velocity 64; 65 notes at once → no panic, 64 voices, no jump > 0.1; no allocation with note commands from both rings (extend `tests/no_alloc.rs`).
Acceptance: `cargo test`, `cargo clippy -- -D warnings`, `cargo clippy --all-targets -- -D warnings`, `cargo check --target x86_64-pc-windows-msvc` pass.

## Step 2 · MIDI port, watcher and Node API (builder-plus, hard: true)
Files: new `native/audio-engine/src/midi/mod.rs`, `src/midi/watch.rs`, `src/output/mod.rs` (each output start creates the MIDI ring and hands the producer to the MIDI side), `src/api.rs`, `src/lib.rs`, `Cargo.toml` (midir 0.11.2), `index.d.ts` (built).
- `pick_port(names: &[String]) -> Option<usize>` (pure, tested) using the match above.
- The MIDI callback (midir's thread) parses with `midi_msg::parse`, pushes the command into the current MIDI producer (held in a `Mutex<Option<Producer>>` that only the MIDI thread and start/stop touch; the audio thread never sees it; use `try_lock` in the callback and count a dropped event if it is busy), and pushes a copy `{kind, note, velocity, timeUs}` into a second ring for JS. When no output is running, events still go to JS.
- The JS side: a `ThreadsafeFunction` set by `onMidiEvent(callback)`, fed by a small forwarder thread that drains the JS ring and calls the function non-blocking (batches allowed). Never called from the audio thread.
- Watcher thread: every 2 s lists ports, connects to `pick_port`, notices when the port disappears, reconnects when it returns. State in atomics + a short name string behind a lock only the watcher and `midiStatus()` use.
- API: `listMidiInputs(): string[]`, `midiStatus(): { connected: boolean, portName?: string, events: number, dropped: number }`, `onMidiEvent(cb)`, `startMidi()` (starts the watcher once; idempotent), `stopMidi()`.
- Exit: `stopMidi()` stops the watcher and closes the port; must not hang.
Tests first: `pick_port` table (["Microsoft GS Wavetable", "Digital Piano"] → 1; ["P-121"] → 0; ["USB Keystation"] → 0; [] → None); the JS-ring copy keeps order; the MIDI producer swap on output restart (unit test with fake producer: events after a restart reach the new consumer).
Acceptance: as step 1, plus `npm run build` in the crate and a node check: `startMidi()`, `listMidiInputs()` returns an array (may be empty here), `midiStatus()` says not connected, `stopMidi()` returns.

## Step 3 · Piano status in the app (builder)
Files: `src/main/audio.ts` / `src/main/audioController.ts` (start MIDI at launch, stop before quit), `src/main/ipc.ts` (`midi:status`; forward events to the window with `webContents.send('midi:event', batch)`), `src/preload/index.ts` + `index.d.ts` (`pianoLearner.midi.{status,onEvents}`, `onEvents` returns an unsubscribe function), `src/shared/audio.ts` (types), `src/renderer/src/screens/Sound.tsx` + css + `soundText.ts` (a "Piano" section: "Piano connected: Digital Piano" with ✓, or "No piano found. Check that the piano is on and the USB cable is plugged in." with ○; "Last key: C4, loudness 64 of 127" when a key is played), `e2e/app.spec.ts` (bridge now `audio, midi, version`; the Sound screen shows the no-piano state), tests for note names (`noteName(60) === 'C4'`, `noteName(61) === 'C#4'`, 21 → 'A0', 108 → 'C8').
Acceptance: `npm test`, `npm run lint`, `npm run build`, `xvfb-run -a npm run test:e2e` pass; screenshots light and dark of the Sound screen.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |

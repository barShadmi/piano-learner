# Phase 1 · Task 9 · Import MIDI and MusicXML files; Listen mode plays a song

Goal: Bar presses "Import file", picks a MIDI or MusicXML file, and the song appears in his library. He opens it, presses Listen, and hears it played by the piano sound in his headphones while the notes fall onto the keyboard in time.

Decisions (lead):
- File types now: `.mid`, `.midi`, `.musicxml`, `.xml`, `.mxl` (zipped MusicXML). Photos, PDFs and videos stay for later phases; the import dialog only offers the types above, and the library wording says what works today. Never name any website.
- Parsing runs in the main process (files never reach the renderer as raw bytes). Libraries, exact versions published at least two weeks ago: `@tonejs/midi` for MIDI, `fast-xml-parser` for MusicXML, `fflate` for `.mxl`. Every parsed song goes through `validateSong` before it is saved; a file that fails gives one plain reason ("This file has no notes." / "This file could not be read as MIDI." / …).
- Hands: MusicXML staff 1 = right, staff 2 = left (one staff: split at middle C, C4 and up = right). MIDI: two or more tracks with notes → the track with the higher average pitch is right, the next is left, any others are split at middle C; one track → split at middle C. Fingerings come from MusicXML `<fingering>` (fingerSource 'printed'); none for MIDI.
- Time: everything converts to quarter-note beats. MIDI uses its PPQ and tempo events; MusicXML uses `<divisions>`, `<backup>`/`<forward>`, chords, ties (a tied note becomes one longer note), `<sound tempo>` and `<metronome>` (default 100 bpm if none), time signatures and measures. Grace notes are skipped. Notes outside 21–108 are dropped.
- Library: songs are saved as JSON in `userData/songs/<id>.json` (id = random, never from the file name). The library lists songs by title (MusicXML `work-title`/`movement-title`, MIDI track/name, else the file name without extension), with a "Play" link to `#/play/<id>`. The bundled Canon sample stays available as "Canon in D (opening) · sample".
- Listen mode: the native engine plays the song so the sound never goes through the renderer (CLAUDE.md). A new song player in the Rust engine takes a list of timed note on/off events, runs on its own thread, and sends them to the audio core through its own lock-free ring (separate from the MIDI ring, so Bar's playing is never blocked and song notes are not counted in the latency report). Timing: sleep until about 2 ms before each event, then spin; target jitter under 1 ms. `stopSong` sends note-offs for every note the song still holds. The renderer's `SongClock` follows the engine: on Listen the screen starts its clock when the engine says it started, and every second it corrects itself from `songPosition()` if it drifted more than 20 ms.
- On the Play screen: "Start" (watch only, as now) and "Listen" (watch and hear). "Pause" and "Back to the start" stop the engine's song too. Leaving the screen stops it.

## Step 1 · Importers (builder-plus)
Files: `package.json` + lock (the three libraries, exact), `src/main/import/midi.ts` + test, `src/main/import/musicxml.ts` + test, `src/main/import/index.ts` + test (`importSongFile(path)` → `{ ok: true, song } | { ok: false, error }`, picks the parser by extension, then `validateSong`), test fixtures in `src/main/import/fixtures/` built small by hand (a two-track MIDI made in the test with @tonejs/midi's writer; a two-staff MusicXML with a chord, a tie, a backup, a tempo, fingering; the same zipped as .mxl).
Tests first: hands, beats, tempo, chord, tie, backup, fingering, out-of-range pitches dropped, empty file → "This file has no notes.", broken file → plain error, unknown extension refused.
Acceptance: npm test, lint, typecheck pass.

## Step 2 · Song library and import button (builder) [frontend-design]
Files: `src/main/songStore.ts` + test (list, get, save with atomic write, ids safe for file names), `src/main/ipc.ts` (`songs:list`, `songs:get`, `songs:import` which opens the file dialog in main with the file filters above, runs `importSongFile` in a `worker_thread` so a big file never freezes the window, and returns the new song's summary or a plain error), `src/preload/*` (`pianoLearner.songs`), `src/renderer/src/routes.ts` + test (`#/play/<id>`), `Library.tsx` + css (enable "Import file", list songs, empty state wording updated), `Play.tsx` (load the song by id, else the sample), `e2e/app.spec.ts` (import a fixture MIDI by stubbing the dialog in main for tests through an env var read only when `PIANO_LEARNER_E2E=1`; the song shows in the list and opens on Play).
Acceptance: npm test, lint, typecheck, build, e2e pass; screenshots light and dark of the library with two songs.

## Step 3 · Song player in the engine (builder-plus, hard)
Files: `native/audio-engine/src/song/mod.rs` (+ tests), `core/mod.rs` (a second command consumer for song events), `api.rs` (`playSong(events: {timeMs, note, velocity, on}[], fromMs)`, `stopSong()`, `songPosition()` → ms or null), `src/main/audioController.ts` + test, `src/main/ipc.ts` (`song:play`, `song:stop`, `song:position`, input validated), `src/preload/*`, `src/shared/audio.ts`.
Tests first (Rust): events come out in order and on time against a fake clock; stop releases held notes; play while playing replaces the song; the audio core reads both rings; no allocation in the audio callback (the song ring is preallocated). cargo test, cargo test --release, both clippy runs.
Acceptance: npm test, lint, typecheck, build, e2e; cargo test (debug and release); clippy (plain and all-targets).

## Step 4 · Listen mode on the Play screen (builder)
Files: `Play.tsx` + css, `src/renderer/src/falling/*` (song events from TimedNotes + test; clock follow logic + test), `e2e/app.spec.ts` (Listen button exists; pressing it with sound unavailable in CI shows a plain reason and still runs the falling notes).
Acceptance: npm test, lint, typecheck, build, e2e pass.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder-plus (Sonnet) | 2 | FAIL (a pickup bar left a silent gap), then PASS. Later: use implicit="yes" before the length check for pickups; tempos inside a pickup bar are not shifted. |
| 2 | builder (Haiku) | 2 | FAIL (identical "Play" link names; a notation program named in a test comment), then PASS. Imports run in a worker thread; Bar should try one import in the Windows installer. |
| 3 | builder-plus (Sonnet) | 3 | FAIL (Windows timer granularity, time overflow, unbounded song ring per callback), FAIL (stop event made release retries instant), then PASS. Real song timing on Windows is checked at Bar's gate. Later: song and Bar share one mixer by pitch. |
| 4 | builder (Haiku) | 3 | FAIL (Start during Listen kept playing), FAIL (same-start notes on one key lost the longer one; fixed by the lead with a test), then PASS. The success path needs sound, so Bar checks it at the gate. |

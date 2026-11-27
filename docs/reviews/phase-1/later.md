# Phase 1 · later

## From the build (verifier notes)
- Song notes and Bar's own playing share one mixer by pitch: a song note-off or retrigger can cut a key Bar holds; tag voices by source (also code round 1 item 3).
- MusicXML pickup detection should use implicit="yes" before the length check; tempos inside a pickup bar are not shifted.
- stop() during a settings pass at quit; bufferLabel assumes 48 kHz; no unit test for registerSettingsIpc; bank swap mid-play may click; MIDI quick unplug/replug; IPC sender check.
- Real song timing, the 0.5 ms spin and one real import on Windows are checked at Bar's gate.

## From round 1 (not fixed in phase 1)
- Code: typed IPC map shared by main and preload; split output/mod.rs (convert, latency, engine) and FallingNotes' big effect (noteLayer) and Play's Listen logic (useListen); drop the "older addon" branches in audioController; run cargo test and clippy on the Windows CI job with a Windows-only Sleeper test.
- Performance: count late buffers as underruns in exclusive mode; start a stolen voice at once (fade the old one separately) or count steals; lock the piano samples in memory on Windows; a release-only render-time budget test; long-frame count and a dense-song frame test in e2e; 100-song list speed test.
- Accessibility: axe check in e2e on all screens in both themes and a focus-state screenshot (carried from phase 0).
- Design: panel column width and padding at 1920; one primary per screen also for the rows' Play buttons; a lit black key in forced colours looks like a white key (the letter still marks it).
- Words: three import errors still lack a next step ("could not be read as MIDI/MusicXML", "could not be opened", "could not be imported"); "Piano Learner" in the MIDI client name.
- Falling notes: the edge stripe is thin at 1x (reads as a notch); "R" on an 11 px black-key note has no side margin.
- Delay test: a poll that jumps past a multiple of 5 skips that announcement; cpal "measured" wording when nothing was measured.

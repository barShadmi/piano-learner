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

## From round 2 (not fixed in phase 1)
- Code: a Play component test with fake timers that would catch the first-note bug coming back (leadInEnd's test cannot fail); "Show report" can open an older report if more keys are timed after saving; Windows-only test that RealClock picks the 500 µs spin.
- Performance: getSong still reads a whole song synchronously on the main thread (make it async); chooseLabel makes two small arrays per restyle; plus round 1 items above.
- Design: Back links and the extra buttons on Sound and Delay test should be `.button-secondary` (one primary per screen); legend as two hand chips holding R / L at `--text-md`; the `--on-accent` bar on a lit white key in light theme reads as a shorter key (use an inset rounded mark); an idle line in the Play status row ("Press Listen to hear the song.").
- Student: "Restart song" parks at the start instead of playing again (rename or restart in the running mode); importing the same file twice gives two identical rows.
- Words: Sound status line mixes buffer and sound card ms; sample rate on the Delay screen; `latency-report.*` file names vs "Delay"; "close" verdict ends without a judgement word; native reasons: exclusive turned off in Windows (use the Mode name, and don't advise closing apps), buffer refused (no next step), "no output port"/"output port is busy" jargon, piano sound file errors show paths; "No piano found." on Play with no next step; "Your songs could not be read." with no next step.

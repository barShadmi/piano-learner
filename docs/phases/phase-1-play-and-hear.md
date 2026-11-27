# Phase 1 · Play and hear (weeks 2 to 4)

Tags: (B) builder, (B+) builder-plus, (L) lead. `hard` steps go straight to builder-plus.

## Tasks
- [x] Rust audio engine loaded into the app, WASAPI exclusive and ASIO output, test tone (B+, hard)
- [x] MIDI input in the engine: P-121 found, notes, velocity, sustain pedal (B+, hard)
- [x] Sampled grand piano in memory, velocity layers, pedal (B+, hard)
- [ ] Local Control off on start, restored on exit (B+)
- [ ] Latency test and report, target under 10 ms (B+, hard)
- [ ] Settings: output device, driver, buffer size, volume; headphones by default (B) [frontend-design]
- [ ] 88-key virtual keyboard that lights the keys you press (B) [frontend-design]
- [ ] Falling notes view at 60 fps, a colour per hand (B+) [frontend-design, animate]
- [ ] Import MIDI and MusicXML files; Listen mode plays a song (B) [test-driven-development]

## Gate
- [ ] Review board passed (no Blocking item left)
- [ ] Bar: Play the P-121 and hear it in your headphones with no lag you can feel
- [ ] Bar: The latency report shows under 10 ms
- [ ] Bar: A song plays with falling notes

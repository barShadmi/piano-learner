# PianoLearner plan

The full plan, with reasons and sources, is the Claude Doc "PianoLearner: build plan" (https://claude.ai/artifact/PsMAGmfaePLw5BnYcSE6xR). This file keeps the decisions the code depends on.

## Decisions (27 Nov 2026)
- Windows desktop app built with Electron (Bar chose it over native C#). English only, just for Bar, a total beginner.
- Yamaha P-121 over USB. Local Control off so only the PC plays sound. Headphones on the PC are the default output.
- Real-time sound: key press to sound under 10 ms. A native Rust audio engine (MIDI in, sampled grand, WASAPI exclusive or ASIO, 64 to 128 sample buffers) owns sound. Phase 1 must hit the target before phase 2.
- Scanning is Claude, through Claude Code signed in to Bar's Claude Pro account (no API key). Pages are split into lines, Claude returns the song format as fixed JSON, the app checks bar sums, unsure notes are highlighted, and everything goes through a review screen.
- Falling-note YouTube videos are read from the pixels (calibrate keyboard, pick hand colours, scan frames), not the audio.
- Fingering: printed when present, otherwise suggested automatically and editable.
- Modes: beginner lessons, listen, wait for key, tempo 25 to 100%, one hand, loop, side-by-side replay, 2D animated hands (phase 5). Claude can make simplified versions of a song (melody, melody plus bass, full).
- Never name the score download website in the app.

## Test material
- Sheet: Canon in D (Pachelbel, arr. for piano), 6-page clean PDF, D major, 4/4, quarter = 100, no printed fingering.
- Videos: https://www.youtube.com/watch?v=CNRkEFvg9OI and https://www.youtube.com/watch?v=1_sjBajWXGQ

## Phases
See `docs/phases/README.md`.

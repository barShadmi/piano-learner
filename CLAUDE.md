# PianoLearner: rules for Claude

## The product
- A Windows desktop app that teaches Bar, a total beginner, to play piano. Just for Bar; English only.
- Bar plays a Yamaha P-121 connected by USB. The app reads it over MIDI, checks what he plays, and plays the sound itself through the PC (headphones by default). The P-121's own speakers are muted with Local Control off.
- Songs come from: photos and PDFs of sheet music (scanned by Claude through Bar's own Claude account, never an API key), MusicXML and MIDI files Bar imports by hand, and falling-note YouTube tutorials (read from the video's pixels).
- Never name the website Bar downloads scores from anywhere in the app. Import is just "Import file".
- Displays: sheet with a moving cursor, 88-key keyboard, falling notes (colour per hand, finger number on each note), hand zones, later 2D animated hands.
- Modes: beginner lessons, listen, wait for key, slow tempo, one hand, loop, side-by-side replay. Scores, progress and history.
- The full plan: `docs/plan.md`.

## Hard requirements
- **Real-time sound.** Key press to sound under 10 ms. Sound and MIDI run in the native Rust audio engine (`native/audio-engine`), never through the screen code. Nothing in the UI may block or delay the audio thread.
- Scanning is a must-have of the first version.
- Every scan and video import goes through the review screen before practice.

## The owner
- Bar is a beginner coder. Explain changes in plain words, keep steps small, and give him an installer to try at the end of each phase.

## How we work (full detail in `docs/workflow.md`)
1. Start every session by loading the `using-superpowers` skill.
2. The main session (Opus) is the lead: it plans and checks. Code is written by the `builder` subagent (Haiku), or `builder-plus` (Sonnet) for hard steps or after two failed tries.
3. Every builder step is checked by the `verifier` subagent (Opus) before it is committed. Never accept a builder's report without the verifier.
4. Bar never types a command. The lead runs the `build-task` procedure for each task in order, and the `phase-review` procedure when a phase's tasks are all ticked. Plans go in `docs/plans/phase-<N>/`.
5. One PR per task. Merge it when CI and the verifier pass.
6. After the review board passes, Bar does his gate check on his own PC with the P-121. Do not start the next phase until he says it works.
7. Tick tasks in the phase file in the same commit as the work.

## Stack
Electron + TypeScript + React + Vite for the screens. Rust audio engine (cpal for WASAPI/ASIO output, midir for MIDI) loaded as a Node addon with napi-rs. PixiJS for falling notes. OpenSheetMusicDisplay for the sheet. SQLite for history. Bundled Python helper (OpenCV, fingering) from phase 3. Vitest for unit tests, Playwright for Electron for app tests. electron-builder for the Windows installer, built by GitHub Actions on every PR.

## Design rules
- Use only the tokens in `src/renderer/styles/tokens.css`. No new colours, spacing or font values.
- Right hand and left hand each have one colour token; right and wrong notes have their own tokens. Colour is never the only signal: also use shape, label or position.
- Spacing scale: 4 8 12 16 24 32 48 64 96. Radii: 4 8 12 16 24 full.
- Hit areas at least 44 px. Respect `prefers-reduced-motion` for UI motion (falling notes keep moving; they are the content).
- Light and dark themes.

## Never
- Never put keys, tokens or passwords in the repo or in renderer code.
- Never route live playing sound through Web Audio or the renderer.
- Never mention the score download site in the app.

# Student · phase 1 · round 1
Score: 6/10

Tested the built app with Playwright for Electron under xvfb, no piano, no sound device, fresh profile; five bad imports and a very long title through the e2e import hook; Play (sample and imported), Listen, Pause then Start, a made-up song id, the Delay test with 0 keys including Save report, and Sound.

## Must fix to reach 10
1. **Blocking** · Play (`Play.tsx:245-256`, start at :171-177) · "Start" and "Listen": nothing says which makes sound. A beginner presses Start, sees notes fall in silence, thinks the app or headphones are broken — defeats the gate "A song plays with falling notes". After Pause in Listen, pressing Start continues silently. No on-screen state. Fix: Listen first and main; rename Start "Watch (no sound)"; after Pause one "Continue" that keeps the mode; a role=status "Playing with sound" / "Playing without sound" / "Paused".
2. **Polish** · `Play.tsx:187-190` · At the end the notes just stop. Show "Song finished. Listen again?" with Listen and Back to the start.
3. **Polish** · `Library.tsx:64-66` · "Play the piano" and the sample's "Play" open the same Canon song. Make "Play the piano" a song-less keyboard, or rename it.
4. **Polish** · `Library.tsx:92-97` · The empty-state sentence sits in the sample's card and reads like its description. Move it out, with Import file next to it.
5. **Polish** · `Library.module.css:50-66` · A long title squeezes the row's Play button. `flex-shrink: 0` on the button, `min-width: 0` on `.rowTitle`.
6. **Polish** · `Latency.tsx:204-210` · With 0 keys, Save report writes an empty report ("Saved. Show file"); Test again is active before any test. Disable both until a key is timed; hint "Play 20 keys first".
7. **Polish** · `SoundSettings.tsx:201-215` · Buffer has no explanation. Add "Smaller is faster. If you hear crackles, pick a bigger one."
8. **Polish** · `NotFound.tsx:7` · Wording for a missing song. (Note from the lead: `#/play/<id>` already says "This song could not be found."; the student hit a non-UUID id, which routes to Not found.)
9. **Polish** · Retake the stale state screenshots from HEAD.

## What held up
Bad files give one plain sentence and the library stays usable; a cancelled import is silent; "Import file" only and no website named; no-piano and no-sound states explain themselves; hands by colour + R/L + legend; C1–C8 and Middle C labels; Play fits at 1024x640; long titles wrap on Play.

## Fixed since last round
- First round.

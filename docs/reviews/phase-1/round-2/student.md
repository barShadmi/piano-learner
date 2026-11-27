# Student · phase 1 · round 2
Score: 8/10

I used the built app (`npm run build`, then Playwright for Electron under xvfb) as a total beginner, with a fresh profile, no piano and no sound device. I checked:
- **Library:** the empty state, and the sample's Play.
- **Play screen:** Listen with sound down, then Pause, Watch, Restart song, and letting the song run to the end.
- **Sound screen and the Delay test:** with 0 keys played, I tried Start over and Save report.
- **Imports, through the e2e hook:** a good MIDI, the same file imported twice, a real-world long title, a MIDI with no notes, a broken MIDI, a bad MusicXML, a PDF and a missing file.
- **Long title at the smallest window (1024x640).**

Nothing left stops Bar from playing a song and hearing it. The round 1 Blocking item is fixed. What is left is Polish.

## Must fix to reach 10
1. **Polish** · Play, Listen with sound off · `src/renderer/src/screens/Play.tsx:142` and `:168-177`.
   - **What happens:** pressing Listen right away shows "Playing with sound." with the dot on Listen. The engine is only asked after the 2 s lead-in, so for about 2 seconds the app claims sound that does not exist. Only then does it flip to "Sound is not on yet." with the dot on Watch.
   - **Wording:** "Sound is not on yet." (`src/main/audioController.ts:322`, `:399`) sounds like Bar should wait. The Sound screen says the real thing: "Sound could not start. The sound device is not available."
   - **What good looks like:** check `audio.state()` when Listen is pressed. If sound is not on, go straight to the reason. Reword it as "Sound could not start. Open Sound to fix it." (the "Open Sound" button is already next to it).
2. **Polish** · Play, long song title at 1024x640 · `src/renderer/src/screens/Play.module.css:15-25` (`.header`, `.title`).
   - **What happens:** I imported a MIDI whose track name is a normal download-style title ("Ludwig van Beethoven - Sonata No. 14 in C-sharp minor "Quasi una fantasia", Op. 27 No. 2 (Moonlight) - 1st Movement Adagio sostenuto - easy version for beginners"). The h1 takes 4 lines and squeezes "Back to your songs" into a 4-line button. The falling area drops to **102 px** (the target is 240 px), so the notes appear just before they hit the keys.
   - At 1280x800 it is about 255 px, which is fine.
   - **What good looks like:** `.title { min-width: 0; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden }` with the full title in a `title` attribute. On the back link, `white-space: nowrap; flex-shrink: 0`. Run the existing 240 px e2e check with a long-title import as well.
3. **Polish** · Play · `Play.tsx:199-204` and `:300-302`.
   - **What happens:** "Restart song" stops the song and parks it at the start with an empty status. A beginner expects the song to start again.
   - **What good looks like:** either restart in the mode that was running (Listen or Watch) from the lead-in, or rename it "Back to the start" and set the status to "Ready. Press Listen or Watch."
4. **Polish** · Library, importing the same file twice · `src/main/import/*` (song store save) and `Library.tsx`.
   - **What happens:** importing the same file twice gives two identical rows ("Twinkle" / "Twinkle"). Both have the same link name, "Play Twinkle", and there is no way to remove one in phase 1.
   - **What good looks like:** spot the same source file or content and say "“Twinkle” is already in your songs." Or, if it is still added, give the second copy a "(2)" suffix.
5. **Polish** · Play, Listen failed · `Play.tsx:272-291` with `styles/base.css` `.button` / `.button-secondary`.
   - **What happens:** after Listen falls back to no sound, Watch has the light pressed fill and the dot. Listen is still the solid dark primary button, which looks like the stronger "on" state at a glance. The status line saves it, but the eye lands on Listen first.
   - **What good looks like:** make the pressed style clearly stronger than the resting primary, for example a thicker `--text` border plus the dot on both kinds of button. Or show the status line next to the buttons rather than below them.

## Fixed since last round
1. Fixed (was Blocking): Listen and Watch are now clearly named, and there is a hint line. The `role=status` reads "Playing with sound." / "Playing without sound." / "Paused." The pressed button shows a dot and `aria-pressed`. Pause is `aria-disabled` when nothing plays. Pressing the same mode button after Pause carries on from the same place.
2. Fixed: the end of the song says "Song finished. Press Listen to hear it again.", and Listen and Watch both start again from the lead-in.
3. Fixed: "Play the piano" is gone. Import file is the one primary button and Sound is secondary.
4. Fixed: the empty-state sentence sits under a separator, outside the sample row, and the sample has a "Sample" tag.
5. Fixed: long titles wrap in the library rows, and the Play button keeps its size.
6. Fixed: Delay test with 0 keys: Start over and Save report are `aria-disabled` with "Play a key first.", and "Connect the piano to run the test." explains why nothing happens.
7. Fixed: the buffer hint "Smaller is faster. If you hear crackles, pick a bigger one." is shown.
8. Unchanged, and fine as the lead explained: a real song id that is missing gives "This song could not be found."; only non-song routes show "Screen not found".
9. Fixed: the state screenshots were retaken from HEAD.

Still holding up:
- **Bad imports:** the empty, broken, PDF, bad MusicXML and missing files each give one plain sentence, and the library stays usable. "This file has no notes. Pick another file." and the PDF message now say what to do next. The other three are in `later.md`.
- **Wording:** no score website is named anywhere.
- **No piano and no sound:** both states explain themselves.
- **Hands:** shown by colour plus the R/L letters plus the legend.
- **Window titles:** each screen sets its own, such as "Play · PianoLearner".

My test scripts and screenshots are in the scratchpad, for example `/tmp/claude-0/-home-user/be46af74-8a57-5f44-b773-9bd7230da801/scratchpad/s/small-long.png`, `/tmp/claude-0/-home-user/be46af74-8a57-5f44-b773-9bd7230da801/scratchpad/s/listen-fail.png`, `/tmp/claude-0/-home-user/be46af74-8a57-5f44-b773-9bd7230da801/scratchpad/s/lib-long-twice.png` and `/tmp/claude-0/-home-user/be46af74-8a57-5f44-b773-9bd7230da801/scratchpad/s/walk.cjs`.

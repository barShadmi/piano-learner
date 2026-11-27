# Words · phase 1 · round 2
Score: 9/10

Nothing blocks Bar now. Both round 1 Blocking items are fixed:
- The Play buttons now say what they do.
- The delay verdict now agrees with the big number.

I searched `src/` and `native/audio-engine/src/` again and found no score site name anywhere. Import is still just "Import file".

## Must fix to reach 10
1. **Polish** · Sound screen · `src/renderer/src/screens/soundText.ts:16-18` · "Sound is on. Speakers, Standard mode, 128 samples, about 2.7 ms." uses the same "N samples, about X ms" shape as the Buffer list (`soundText.ts:121-124`), but the ms here means something else: it is the sound card delay, not the buffer time. A beginner will read both "about … ms" figures as the same thing. Better: "Sound is on: Speakers, Standard mode, Buffer 128 samples. Sound card delay: about 2.7 ms."
2. **Polish** · Delay test Details · `src/shared/latency.ts:137` · "Sample rate: 48000 Hz" is still on screen with no hint. This was the rest of round 1 item 5. Keep it in the report only: filter it out of `setupRows` on screen, or give `reportText` its own row.
3. **Polish** · Delay test report files · `src/main/ipc.ts:119-122` · "Show report" opens a folder showing `latency-report.txt` / `.json`. Everywhere else the app says "Delay" (round 1 item 8, still open). Rename the files to `delay-report.txt` / `delay-report.json`.
4. **Polish** · Delay verdict · `src/shared/latency.ts:59-61` · Every other verdict ends with a judgement ("Good.", "Too slow."), but the "close" one does not. Better: "Most keys sound in under 10 ms, but some take 10 ms or more. Close." and "Most keys take 10 to 15 ms. Close, but a little slow." (the second one is fine as it is).
5. **Polish** · Sound status, fallback · `native/audio-engine/src/output/mod.rs:141` together with `src/renderer/src/screens/soundText.ts:31`. There are two problems:
   - The reason "Exclusive mode is turned off for this sound device in Windows settings." does not use the Mode list's name.
   - The line above it tells Bar to "Close other apps that use sound and press Try again". That cannot fix this cause.
   Better reason: "Fastest (exclusive) is turned off for this sound device in Windows sound settings. Turn on 'Allow apps to take exclusive control' there, or keep this mode." The `fallbackLine` advice should only say "Close other apps…" when the reason is the busy device.
6. **Polish** · Buffer errors · `native/audio-engine/src/output/mod.rs:87` ("The sound device refused that buffer size.") and `:143` ("…does not allow that buffer size."). Neither gives a next step. Better: "The sound device cannot use that Buffer. Pick a bigger Buffer on the Sound screen."
7. **Polish** · Piano problem line · `native/audio-engine/src/midi/watch.rs:97, 100` · "The piano has no output port." and "The piano's output port is busy." are jargon with no next step. Better: "The app could not turn off the piano's own speakers. Unplug the USB cable, plug it in again, and press Reconnect piano."
8. **Polish** · Play screen after Listen with sound off · `src/main/audioController.ts:322, 399` · "Sound is not on yet." sits next to the "Open Sound" link but does not say what to do. Better: "Sound is off. Press Open Sound to turn it on."
9. **Polish** · Play screen piano line · `src/renderer/src/screens/Play.tsx:260` (uses `pianoLine`, `soundText.ts:46`) · "No piano found." gives no next step on the screen where Bar plays. Better on Play: "No piano found. Turn it on and plug in the USB cable."
10. **Polish** · Library · `src/renderer/src/screens/Library.tsx:20` · "Your songs could not be read." has no next step. Better: "Your songs could not be read. Restart the app to try again."
11. **Polish** · Piano sound reason · `native/audio-engine/src/piano/bank.rs:170, 179, 273` · These reasons show a full folder path and a raw system error under "Piano sound". Better: "The piano sound files are missing or damaged. Reinstall PianoLearner. You hear a simple tone until then." Keep the path in the log only.

Already in `later.md`, not counted here:
- the three import errors that still have no next step
- "Piano Learner" in the MIDI client name (`midi/watch.rs:32, 81, 99`)

## Fixed since last round
- 1 (Blocking): Fixed. Play buttons are "Listen", "Watch (no sound)", "Pause", "Restart song". The hint says "Listen plays the song with sound. Watch shows the notes only." The status line says "Playing with sound." / "Playing without sound." / "Paused." / "Song finished. Press Listen to hear it again."
- 2 (Blocking): Fixed. The big line is now "Typical key: about X ms.", and the verdict names what it judges and agrees with the typical key (`latency.ts:51-78`).
- 3: Fixed. The setting is called "Mode" everywhere, the tips say "On the Sound screen, set Mode to Fastest (exclusive) or ASIO driver.", and links say "Sound" / "Open Sound".
- 4: Fixed. The Buffer hint is in place and the tip says "Pick a smaller Buffer on the Sound screen."
- 5: Mostly fixed. "Typical key", "Almost every key (95 in 100)", "Sound gaps" and the waiting row are in place. Sample rate remains (item 2 above).
- 6: Fixed. "Start over" and "Save report" are unavailable until a key is timed, with "Play a key first."; saving shows "Report saved." and the button becomes "Show report".
- 7: Fixed. `SOUND_OFF_LINE` now names both buttons.
- 8: Not fixed (item 3 above).
- 9: Fixed. "Play the piano" is removed and the sample row has a "Sample" tag.
- 10: Fixed. "Restart song", and the song title is the h1.
- 11: Fixed. "Listen plays only the first part of this long song."
- 12: Fixed. "Turn sound on first. Use Try again or Start sound above."
- 13: Four errors fixed (too big, could not be turned into a song, took too long, no notes). Three moved to `later.md`.
- 14: Fixed. Native errors say "PianoLearner" and "sound format", with no hex code and no "backend". The MIDI client name moved to `later.md`.
- 15: Fixed. The falling-notes failure line now ends "Restart the app. You can still play and hear the piano."
- New empty-state sentence is good: "You have no songs of your own yet. Press Import file to add a MIDI or MusicXML file. Sheet music photos and videos come later."

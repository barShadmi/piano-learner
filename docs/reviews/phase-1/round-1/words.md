# Words · phase 1 · round 1
Score: 6/10

The score site is not named anywhere (searched src/ and native/audio-engine/src/); import is "Import file" everywhere.

## Must fix to reach 10
1. **Blocking** · `Play.tsx:245-250` · "Start" plays with no sound next to "Listen", and nothing says so. Rename "Watch" (or "Watch only" / "Watch and listen"); add a hint line "Watch shows the notes. Listen also plays them."
2. **Blocking** · `src/shared/latency.ts:37-55`, `Latency.tsx:169-174` · The big number is the median, the verdict is judged on p95, so they can contradict ("About 8.0 ms…" then "Too slow"). Bar's gate is read here. Make the verdict name what it judges ("Some keys take over 15 ms…", "Almost every key sounds in under 10 ms") or add "Most keys: under X ms".
3. **Polish** · Same setting, different names: "Mode" vs "Output mode" (`latency.ts:105`); options "Fastest (exclusive)", "ASIO driver", "Standard mode" vs tips "exclusive mode or ASIO in Sound settings" (`latency.ts:34`, `soundText.ts:41-54`); "Sound" vs "Sound settings" (`Play.tsx:270`). One name each; tip "On the Sound screen, set Mode to Fastest (exclusive) or ASIO driver."
4. **Polish** · `SoundSettings.tsx:200-216`, `soundText.ts:176-180, 68` · "Buffer"/"samples" jargon with no hint. Helper "Smaller is faster. If you hear crackles, pick a bigger one."; tip "Pick a smaller Buffer on the Sound screen."
5. **Polish** · `latency.ts:93-108` · Details labels: "Typical key", "Almost every key (95 in 100)", "Waiting for the next sound slot (typical key)", "Sound gaps"; sample rate in the report only.
6. **Polish** · `Latency.tsx:93, 205-210` · "Start over" instead of "Test again"; Save report unavailable until a key is timed ("Play a key first."); after saving "Show report" and "Report saved. Press Show report to see it."
7. **Polish** · `latency.ts:58` · SOUND_OFF_LINE says "press Try again" but sound-off shows "Start sound". "Sound is off. Go back to Sound and press Start sound or Try again."
8. **Polish** · "Delay" on screen vs `latency-report.*` files. Pick one word or hide file names.
9. **Polish** · `Library.tsx:66-68, 78` · "Play the piano" and "Play" go to the same place. Remove the header button until free play exists, or label "Free play".
10. **Polish** · `Play.tsx:57-62, 254-256` · "Back to your songs" vs "Back to the start". Rename rewind "Restart song"; optionally h1 = song title.
11. **Polish** · `Play.tsx:276` · "This song is too long to play to the end." → "Listen plays only the first part of this long song."
12. **Polish** · `Sound.tsx:281` · "Turn sound on first. Use Try again or Start sound above."
13. **Polish** · Import errors with next steps: "too big. Pick a file under 20 MB."; "could not be turned into a song. Try another copy of the song."; "Importing took too long. Try a smaller file."; "has no notes. Pick another file."
14. **Polish** · Native errors: "Piano Learner" → "PianoLearner" (`cpal_out.rs:84, 86, 155`, `output/mod.rs:140`); no raw hex code (`mod.rs:145`); "sample format" → "sound format"; no "backend" (`mod.rs:313`).
15. **Polish** · `FallingNotes.tsx:373` · Add "Restart the app. You can still play and hear the piano."

## Fixed since last round
- First round.

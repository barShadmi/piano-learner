# Phase 1 review · summary

Two rounds. The board (code, design, student, words, accessibility, performance) passed in round 2 with no Blocking item, and every score went up.

| Reviewer | Round 1 | Round 2 |
| --- | --- | --- |
| code | 7 | 8 |
| design | 6 | 8 |
| student | 6 | 8 |
| words | 6 | 9 |
| accessibility | 6 | 9 |
| performance | 8 | 9 |

## What changed
- Round 1 Blocking fixed:
  - Play buttons say what they do: Listen (with sound) is the main button, then "Watch (no sound)", Pause and "Restart song". A status line says "Playing with sound." / "Playing without sound." / "Paused." / "Song finished…", and a hint explains the two modes.
  - Listen no longer skips the first note of a song.
  - Every falling note shows its hand without colour: "R1"/"L3", "R"/"L", or an edge stripe on the hand's side when the note is too small; sizes come from the tokens.
  - Lit black keys show R/L too, and the bar on lit keys uses `--on-accent`.
  - The delay verdict always agrees with the big "Typical key" number.
- Round 1 Polish taken: one name per sound mode everywhere; Buffer hint; Delay test buttons wait for a key; screen-reader progress; library cleaned up ("Play the piano" removed, "Sample" tag, empty state under the list, long titles wrap); window title and focus on each screen; import errors with next steps; plainer native errors; dead code removed; song list read asynchronously; shorter song-player spin with the precise Windows timer; Play fits at 1024x640 with at least 240 px of falling notes (song title is the heading).
- After round 2 (quick polish before the gate): Listen with sound off says so at once ("Sound is off. Press Open Sound to turn it on."); the running mode button has the main look; buttons never shift; very long song titles stay on one line; the Delay result is read out once by screen readers.
- Not changed, by plan: the 2 px move of a pressed key (one of the three press signals from task 7).
- Everything left is in `later.md`.

Real sound, the P-121, the delay figure and Windows song timing cannot be tested in the cloud; Bar checks them at the gate.

Final screenshots: `final-shots/`.

# How the work gets done

Copied from MindLane: a strong model plans and checks, cheaper models type, an independent checker proves each step, a review board signs off each phase, and Bar does a gate check. One difference: Bar never types a command. The lead works through the phase files by itself.

| Role | Model | What it does |
| --- | --- | --- |
| Lead (the main session) | Opus | Reads the next task, writes the plan, splits it into small steps, hands them out, commits, opens and merges PRs, talks to Bar |
| `builder` | Haiku | Builds one small step, test first. Most steps go here |
| `builder-plus` | Sonnet | Steps marked hard (audio engine, MIDI timing, scanning, video, fingering), or steps Haiku failed twice |
| `verifier` | Opus | Checks every step it did not write: runs tests, reads the diff, looks at screenshots. PASS or FAIL, never fixes |
| Review board (`review-*`) | Opus | End-of-phase review. Who reviews which phase is in `docs/review-board.md` |

## A task (the `build-task` skill, run by the lead)

```
Lead (Opus) plans -> step -> builder (Haiku) -> verifier (Opus)
                                ^ FAIL, retry once      |
                                +-----------------------+
                       2nd FAIL -> builder-plus (Sonnet)|
                       3rd FAIL -> lead fixes it        |
                                             PASS -> commit -> next step
```

One branch and one PR per task. GitHub Actions runs lint, tests and builds the Windows installer on every PR. The lead merges when CI is green and every step has a verifier PASS. Plans are saved in `docs/plans/phase-<N>/`, with which model built each step and how many tries it took.

## End of a phase (the `phase-review` skill, run by the lead)

1. Screenshots of every screen the phase touched, light and dark, at 1280 x 800 and 1920 x 1080.
2. From phase 1 on, the audio latency report.
3. The reviewers for that phase score in parallel and mark each item Blocking or Polish.
4. The lead merges the lists into one fix list; builders fix; the verifier checks each fix.
5. One more round. The phase passes when no reviewer has a Blocking item left. After two rounds with a Blocking item open, the lead stops and asks Bar.

Each round is saved in `docs/reviews/phase-<N>/round-<R>/`. Leftover Polish items go in `docs/reviews/phase-<N>/later.md`.

Then the lead sends Bar the installer and the Gate list. Bar checks it on his PC with the P-121 and headphones.

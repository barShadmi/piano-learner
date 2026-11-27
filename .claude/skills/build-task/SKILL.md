---
name: build-task
description: Build the next open task (or a named one) from docs/phases/ with Opus planning and checking while cheaper subagents write the code. The lead runs this on its own for every task in order; Bar never has to type it.
argument-hint: "[phase number or task text]"
---

You are the lead (Opus). You plan, hand out small steps, and check. You do not write feature code yourself unless both builders failed.

Target: $ARGUMENTS (if empty, the first unticked task in the lowest-numbered phase file in `docs/phases/` whose Gate is not yet fully ticked).

## 1. Understand
- Read `CLAUDE.md`, `docs/plan.md`, the phase file and the task.
- If the task needs a decision from Bar that changes what he gets, ask him; otherwise choose the most likely reading, note it in the plan, and carry on.

## 2. Plan (writing-plans)
Write `docs/plans/phase-<N>/<task-slug>.md` with numbered steps. Each step must be small enough for Haiku:
- the exact files to create or change
- what to build, in plain words, with names of functions and components
- the test to write first
- acceptance checks the verifier can prove (command output, behaviour, screenshot)
- `hard: true` for the audio engine, MIDI timing, scanning, video, fingering, or anything on the audio thread

## 3. Build each step
Create a branch `task/<phase>-<task-slug>`. For each step in order:
1. Send it to **builder** (Haiku), or to **builder-plus** (Sonnet) when `hard: true`.
2. Send the step plus the builder's report to **verifier** (Opus). Do not trust the builder's report on its own.
3. FAIL: send the verifier's problems back to the same builder once. Second FAIL: **builder-plus**. Third FAIL: fix it yourself with systematic-debugging, then verify again.
4. PASS: commit that step with a clear message (and the attribution lines from the session).

Steps that touch different files and do not depend on each other may run in parallel.

## 4. Finish
- Run `npm test`, `npm run lint`, `npm run build` yourself and read the output.
- Tick the task in the phase file in the final commit. Log in the plan file which model built each step, how many tries, and the verifier verdicts.
- Push, open one PR for the task, and merge it once CI is green.
- Go straight on to the next task. When every task in the phase is ticked, run the `phase-review` skill for that phase.

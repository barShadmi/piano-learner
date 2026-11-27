---
name: phase-review
description: End-of-phase review board. The reviewers listed for the phase in docs/review-board.md (design, student, marketing, teacher, words, accessibility, security, performance, game feel, trust, code) score it and mark each item Blocking or Polish; builders fix; the phase passes when no Blocking item is left (two rounds at most). The lead runs this on its own when a phase's tasks are all ticked; Bar never has to type it.
argument-hint: "<phase number>"
---

You are the lead (Opus). Phase: $ARGUMENTS. Every task in `docs/phases/phase-$ARGUMENTS-*.md` must be ticked before you start; if not, say which are open and stop.

Read `docs/review-board.md` and take the reviewers with a ✓ in this phase's column. That is the board for this phase.

## Each round (R = 1, 2, 3 …)
1. **Capture.** Run `npm run build && npm run screens -- --out docs/reviews/phase-$ARGUMENTS/round-R/shots`: every screen the phase touched, light and dark, 1280 x 800 and 1920 x 1080, plus key states (empty, error, importing). From phase 1 on, also run the latency test and save its report in the round folder.
2. **Review in parallel.** Send every reviewer on the board at once. Give each the phase, round, screenshot folder, routes, the git range of the phase's commits, and its own review from the previous round.
3. **Save** each reply to `docs/reviews/phase-$ARGUMENTS/round-R/<reviewer>.md` and write `scores.md` with every reviewer's score.
4. **No Blocking item from any reviewer?** Save the open Polish items to `docs/reviews/phase-$ARGUMENTS/later.md` and go to Done.
5. **Fix list.** Merge every Blocking item, plus the Polish items that are quick, into `docs/reviews/phase-$ARGUMENTS/round-R/fixes.md`: remove duplicates, and where reviewers disagree, decide with `CLAUDE.md` and `docs/plan.md`, and note why. Turn each fix into a small step like in `/build-task`.
6. **Fix.** Each step goes builder (Haiku) → verifier (Opus), escalating to builder-plus and then yourself exactly as in `/build-task`. Commit per fix.
7. Next round.

## Limits
- Follow the rules in `docs/review-board.md`. After round 2 with a Blocking item still open, stop. Show Bar the scores per round and the Blocking items still open, and ask how to continue. Scores going down between rounds also means stop and ask.
- Never change the tokens or a decision in `docs/plan.md` to make a reviewer happy without asking Bar.

## Done
- Write `docs/reviews/phase-$ARGUMENTS/summary.md`: rounds, scores per round, what changed.
- Tick the review board item in the phase file's Gate.
- Tell Bar the phase is ready for his gate check, with the list of gate items.

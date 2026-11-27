# Review board

At the end of each phase the lead runs the `phase-review` skill with the reviewers marked for that phase. Each scores out of 10 and marks every item Blocking or Polish. The phase passes when no reviewer has a Blocking item left. All reviewers run on Opus with their own skills (`.claude/agents/review-*.md`).

| Reviewer | Looks at | 0 Foundations | 1 Play and hear | 2 Scanning | 3 Learn | 4 Video | 5 Progress |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `review-code` | Code Bar can keep changing; tests | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review-design` | Polish, layout, type, motion, both themes | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review-student` | A total beginner actually uses the app | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review-teacher` | Does it actually teach piano well |  |  | ✓ | ✓ | ✓ | ✓ |
| `review-words` | Every word on screen | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review-accessibility` | Keyboard, screen readers, contrast, colour | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review-performance` | Real-time sound and smooth screens |  | ✓ | ✓ | ✓ | ✓ | ✓ |
| `review-security` | Accounts, secrets, files, downloads | ✓ |  | ✓ |  | ✓ | ✓ |

## Rules for the lead
- When reviewers disagree, decide using `CLAUDE.md` and `docs/plan.md`, and write the reason in that round's `fixes.md`.
- A reviewer with no Blocking item in round 1 still reviews round 2.
- After round 2 with a Blocking item still open, or if any score drops between rounds, stop and ask Bar.
- Polish items not fixed go into `docs/reviews/phase-<N>/later.md`.

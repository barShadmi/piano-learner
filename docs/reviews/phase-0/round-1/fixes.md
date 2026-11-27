# Phase 0 · round 1 fix list

Steps are in `docs/plans/phase-0/review-fixes.md`.

## Blocking
1. Button says "Import"; CLAUDE.md says "Import file". (words, student, accessibility, design) → step 1.
2. Disabled Import button is a dead end with no reason. (words, student; accessibility and design as Polish) → step 1: hint line "Importing arrives in a later update." linked with `aria-describedby`, `aria-disabled` so it stays reachable by Tab.
3. `--accent` is the right-hand colour. (design) → step 2: accent becomes ink (`--text` on `--surface`). Uses existing values.
4. `--wrong` too close to `--hand-left`. (design) → step 2: rose red. This is a colour value change, so Bar is asked; the lead builds the recommended option meanwhile because it is easy to undo.

## Quick Polish taken now
- Empty-state copy (words 3, student 3). Words' wording chosen: it keeps "Import" consistent with the button and names what really works. Student's wish to drop "MIDI"/"MusicXML" is left: Bar will import those files by hand, so he needs to know they work.
- Designed empty state with a header row and a panel (design 8, student 4), without the decorative octave.
- Stylesheet instead of inline styles, focus ring, active state (code 9, design 5, accessibility 2).
- Hash router with "Screen not found" and the screenshot script failing on it (code 2).
- Reduced motion: global 1 ms rule, durations 1 ms (accessibility 7). Design 11 asked to keep fades; CLAUDE.md asks to respect reduced motion for UI motion, and the stricter rule is safer for now.
- Electron hardening (security 1, 2, 3, 4, 6, part of 7, 8, 10; student 5; code 12, 13).
- Renderer typecheck without Node types (code 1); contiguous measures and edge-value tests (code 3, 4); dead `canImport` code (code 8).

## Left for later (into `later.md`)
Design 6, 7 (font token changes, need Bar), 8 decorative octave, 9 theme switch, 10 Windows screenshots in CI. Security 5 fuses, 7 drop `'unsafe-inline'`, 9 SHA pins and Dependabot, 11 sandbox flag per platform, 12 build-only advisories, 13 signing. Code 5, 6, 7, 10, 11. Accessibility 4, 5, 6, 9 (phase 1 keyboard task), 8 axe in e2e.

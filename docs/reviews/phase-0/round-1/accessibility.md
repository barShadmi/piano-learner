# Accessibility · phase 0 · round 1
Score: 8/10. axe-core (wcag2a..22aa, best-practice) in built app, light/dark, ± reduced motion: 0 violations. lang, main, one h1, 96x44 button, 200% zoom OK. All text pairs pass.

1. **Blocking** · `Library.tsx:50` · Label "Import file" (CLAUDE.md); update plan line.
2. Polish · `base.css` · Own focus ring: `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`.
3. Polish · `Library.tsx` · Disabled button looks active, nothing says why, not reachable by Tab. Add hint with aria-describedby; aria-disabled instead of disabled (or hide).
4. Polish · `tokens.css:26,90` · `--border` 1.35-1.68:1; add `--border-strong` for control edges (light #85827a, dark #70707d). Token change.
5. Polish · `tokens.css` light · hand-left on hand-left-soft 4.20, correct on correct-soft 4.29; use --text on soft fills or darken (token change).
6. Polish · light key-border on key-white 2.01; dark key-black on bg 1.04. Phase 1 keyboard task.
7. Polish · Global reduced-motion rule in base.css; reduced durations 1ms not 0ms.
8. Polish · axe check in e2e for both themes; focus-state screenshot.
9. Polish · forced-colors check in phase 1 keyboard task.

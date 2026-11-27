# Design · phase 0 · round 2
Score: 8/10. No Blocking. All three round 1 Blocking items fixed (accent vs right hand ΔE 89.5/57.5; wrong vs left hand ΔE 39.5/43.7, deuteranopia 35.5/32.7).

Polish:
1. `Library.tsx:25-27`, `Library.module.css` · Move the hint next to the button (`.action` column, align end, gap --space-1).
2. `Library.tsx:21-24` · Split empty text: "No songs yet." at --text-xl in --text; the rest --text-md muted with a capped width (needs a `--measure` token, ask Bar).
3. `base.css:45-54` · Scope the global reduced-motion rule to `:not([data-motion='content'])`; one place owns reduced motion.
4. `tokens.css` · Repeat accent/on-accent in the dark block so it works on inner containers too.
5. `base.css:28-30` · Drop background-color from the transition until a hover exists.
6. Phase 1 feedback UI: correct vs wrong close under deuteranopia; every mark needs ✓/✗ plus position. Acceptance check in that task.

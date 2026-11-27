# Design · phase 0 · round 1
Score: 6/10

1. **Blocking** · `tokens.css:15-16,78-79` · `--accent` equals `--hand-right` (light identical, dark ΔE≈9). Fix: `--accent: var(--text); --on-accent: var(--surface)`; dark inherits.
2. **Blocking (token change)** · `tokens.css:20,27,82,88` · `--wrong` too close to `--hand-left` (light ΔE 16, deuteranopia 10.6). Fix: light `#9f1239`, dark `#fb7185`, retint `--wrong-soft`. Feedback UI must still carry ✓/✗.
3. **Blocking** · `Library.tsx:50` · "Import file".
4. Polish · `Library.tsx:43-51` · Hint line under the disabled button, aria-describedby.
5. Polish · `Library.tsx:4-36`, `base.css` · Inline styles; stylesheet with :focus-visible, :active, hover media query, motion tokens.
6. Polish (token change) · Weight and heading-leading tokens; semibold h1, leading 1.15.
7. Polish (token change) · `--text-md` 16px, `--text-sm` 14px (read from the bench).
8. Polish · Layout: header row (title left, Import file right), empty-state panel on --surface with --radius-4 and --space-7, small decorative octave in key tokens.
9. Polish · Theme switch (Light/Dark text toggle).
10. Polish · Screenshots on Windows in CI so the real Segoe UI type is reviewed.
11. Polish · Reduced motion: keep opacity/colour fades, drop transforms.
Note: review-animations skill not installed.

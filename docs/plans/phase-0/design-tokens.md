# Phase 0 · Task 7 · Design tokens

Goal: one token file for every colour, font, size, spacing and radius, light and dark, applied to the Library screen. Calm, focused practice look; the keys and notes are the stars.

## Step 1 · Tokens and theme (builder)
Files to create or change: `src/renderer/styles/tokens.css` (new), `src/renderer/styles/base.css` (new), `src/renderer/src/main.tsx` (import both), `src/renderer/src/screens/Library.tsx` (use tokens only), `src/renderer/src/theme.ts` (new), `src/renderer/src/theme.test.ts` (new).

`tokens.css` defines on `:root` (light) and `[data-theme='dark']` (dark):
- Surfaces and text: `--bg`, `--surface`, `--surface-raised`, `--border`, `--text`, `--text-muted`.
- Accent: `--accent`, `--on-accent`.
- Hands: `--hand-right` and `--hand-left` (blue family and orange family, distinguishable for colour-blind users), with `--hand-right-soft`, `--hand-left-soft`.
- Feedback: `--correct`, `--correct-soft`, `--wrong`, `--wrong-soft`.
- Keyboard: `--key-white`, `--key-black`, `--key-border`.
- Spacing `--space-1`..`--space-9` = 4 8 12 16 24 32 48 64 96 px. Radii `--radius-1`..`--radius-5` = 4 8 12 16 24 px and `--radius-full`.
- Type: `--font-sans` (system UI stack: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif), sizes `--text-sm` 13px, `--text-md` 15px, `--text-lg` 18px, `--text-xl` 24px, `--text-2xl` 32px; `--leading` 1.45.
- Motion: `--ease` cubic-bezier(.22,1,.36,1), `--dur-fast` 120ms, `--dur` 200ms; under `@media (prefers-reduced-motion: reduce)` both durations become 0ms.
Every text/background pair used must meet WCAG AA 4.5:1 in both themes (text, text-muted on bg and surface; on-accent on accent).

`theme.ts`: `getInitialTheme(stored: string | null, prefersDark: boolean): 'light' | 'dark'` (stored value wins, else system) and `applyTheme(theme)` sets `document.documentElement.dataset.theme`. `main.tsx` applies it before render, reading `localStorage['theme']` in a try/catch.

`base.css`: body uses `--bg`, `--text`, `--font-sans`, `--text-md`, `--leading`; margin 0; buttons min-height 44px.

`Library.tsx`: layout and colours from tokens only (padding `--space-6`, heading `--text-2xl`, empty-state text `--text-muted`, Import button styled with `--accent` and `--on-accent`, radius `--radius-2`, disabled state visibly muted).

Test first (`theme.test.ts`): stored 'dark' wins over system light; stored null follows system; an invalid stored value falls back to the system.

Acceptance:
1. `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` pass.
2. `grep -rnE '#[0-9a-fA-F]{3,8}|rgb\(|hsl\(' src/renderer --include=*.tsx --include=*.ts` finds nothing; colours appear only in `tokens.css`.
3. A small node script (verifier writes it, not committed) computes contrast for the pairs listed above in both themes from `tokens.css`; all are at least 4.5:1.
4. Screenshots of the Library screen in light and dark (via the task 6 script if present, else a one-off Playwright script) look clean and readable.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |

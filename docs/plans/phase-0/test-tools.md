# Phase 0 · Task 3 · Vitest and Playwright for Electron

Goal: `npm test` runs unit tests with Vitest; `npm run test:e2e` launches the built app with Playwright's Electron support and checks the first screen.

## Step 1 · Test tooling (builder)
Files to create or change: `package.json` (dev deps and scripts), `vitest.config.mts`, `playwright.config.ts`, `src/shared/sanity.test.ts`, `e2e/app.spec.ts`, `.gitignore` (already ignores test-results and playwright-report).

Build:
- Dev deps pinned exactly: `vitest`, `@playwright/test` (use the version that matches the preinstalled Playwright in this machine if `npm ls -g playwright` or `node -e "require('playwright/package.json').version"` shows one; otherwise latest), `jsdom`.
- Scripts: `test` = `vitest run`, `test:watch` = `vitest`, `test:e2e` = `npm run build && playwright test --trace off`.
- `vitest.config.mts`: include `src/**/*.test.ts` and `src/**/*.test.tsx`; environment `node` by default (renderer tests can opt into jsdom per file with a `// @vitest-environment jsdom` comment).
- `src/shared/sanity.test.ts`: one test that `1 + 1 === 2` style check is replaced by something real: assert that `package.json` `productName` is `PianoLearner`.
- `playwright.config.ts`: testDir `e2e`, one worker, timeout 30 s.
- `e2e/app.spec.ts`: uses `_electron.launch({ args: ['.', '--no-sandbox'] })` from `@playwright/test`, waits for the first window, asserts the title is "PianoLearner" and the text "Your songs" is visible, then closes the app. On Linux CI without a display, the spec must still work under `xvfb-run`.

Test first: write both tests before changing config, run them and see them fail, then add config until they pass.

Acceptance:
1. `npm test` passes (1+ test). Paste output.
2. `xvfb-run -a npm run test:e2e` passes on this Linux machine. Paste output.
3. `npm run lint` and `npm run typecheck` pass.
4. Only the listed files changed (plus package-lock.json).

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 1 | PASS (lead renamed config to .mts) |

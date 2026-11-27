# Code quality · phase 0 · round 1
Score: 8/10. No Blocking items. lint, typecheck, 47 tests pass; prod audit 0.

Polish (1-4 worth doing before phase 1):
1. `tsconfig.web.json` · Node types leak into renderer typecheck; add `"types": []`; move `src/shared/sanity.test.ts` (uses node:fs) to `scripts/package.test.ts` and include `scripts/**/*.test.ts` in vitest.
2. `App.tsx:4`, `scripts/screens.config.ts` · No hash router; screenshot script would save Library under a new name. Add a small routes map + "Screen not found", fail screens.ts on it; pure lookup with a unit test.
3. `validate.ts:91-95` · Measures may overlap/gap; require each start = previous measure end; tests for gap and overlap.
4. `validate.test.ts` · Add accepted edge values (pitch 21/108, bpm 20/300, finger 1/5, velocity 1/127, confidence 0/1, keyFifths ±7) and missing rejections (empty id, beats 0, notes not array, measure not object).
5. `types.ts`/`validate.ts` · Allowed values written twice; export `as const` arrays and derive types.
6. `validate.ts:34-207` · Split long function; shared increasing-start helper; "must be a number" message.
7. `validate.test.ts:203-204` · Rename step-named describe and misleading test; use Song type.
8. `Library.tsx:2,18-29` · Dead `canImport` branch.
9. `Library.tsx:4-36` · Inline styles; move to CSS module, `.button` in base.css, `--hit-min` token.
10. `preload/index.ts:9`, package.json · Unused `version`, unused jsdom.
11. Theme check in 3 places; shared `isTheme`.
12. `main/index.ts:50-60` · No .catch on startup, no render-process-gone log, no single-instance lock (MIDI/audio in phase 1).
13. `electron-builder.yml:14,19` · artifactName twice.
Also flagged: "Import" vs "Import file" (words lane).

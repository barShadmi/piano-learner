# Phase 0 · later

- Song validator: the "tempo start must be 0 or more" check has no test that isolates it; a non-object entry clears the previous start so a following duplicate is not compared; a tempo may start after the song ends; one test name says "before" but tests "same start".

## From round 1 (not fixed in phase 0)
- Design: heading weight and tight-leading tokens; body 16 px and small 14 px for reading from the bench (font token changes, ask Bar); decorative one-octave keyboard in the empty state; Light/Dark switch; screenshots taken on Windows in CI so Segoe UI is what gets reviewed; keep opacity fades under reduced motion.
- Security: Electron fuses (runAsNode, NODE_OPTIONS, inspect off, asar integrity); drop style 'unsafe-inline' in production; pin actions by SHA and add Dependabot; --no-sandbox only for Linux root in tests; 6 moderate build-only minimatch advisories via electron-builder (do not `audit fix --force`); sign the installer before a real release (certificate only in Actions secrets); exact file URL check may need case-insensitive drive letter on Windows, smoke-test in the gate.
- Code: derive allowed values from `as const` arrays; split `validateSong`; rename the step-named describe and the "starts before the first" test; unused preload `version` and jsdom; shared `isTheme`; move the `vite/client` reference to `env.d.ts`; rename "rejects measure starts that do not strictly increase".
- Accessibility (phase 1 keyboard task): `--border-strong` for control edges; text on soft fills or darker light hand-left/correct; light key-border and dark black keys on bg; forced-colors check; axe check in e2e and a focus-state screenshot.

## From round 2 (not fixed in phase 0)
- Design: cap the empty-state line width (needs a `--measure` token, ask Bar); phase 1 feedback UI: correct vs wrong differ mostly by hue, so every mark carries ✓/✗ and position, with a test.
- Security: quit a packaged app started with --remote-debugging-port (with the fuses item); drop style 'unsafe-inline' and fail e2e on CSP console messages; assert the enable-sandbox switch when tests run as non-root.
- Accessibility: zoom keys can only be tested with `webContents.sendInputEvent`, not Playwright keyboard; add "Ctrl + / Ctrl - / Ctrl 0 change text size" to Bar's gate list.

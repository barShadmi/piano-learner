# Security and privacy · phase 0 · round 2
Score: 9/10. No Blocking. Packaged app always sandboxed; prod audit 0; no risky APIs.

Polish:
1. `electron-builder.yml` · Electron fuses (deferred); quit when packaged with --remote-debugging-port.
2. `index.html:7` · Drop style 'unsafe-inline' now (no style= left); e2e fails on CSP console messages; strict policy in production only if dev needs it.
3. `src/main/index.ts:76-88` · Handle select-bluetooth/hid/serial/usb device events with deny.
4. e2e/screens · --no-sandbox only when root; assert enable-sandbox switch when not root (deferred).
5. e2e · Cover navigation guard and Web MIDI denial.
6. e2e/screens · Own --user-data-dir per launch; the single-instance lock made 2 of 3 fail while another copy was open.
7. ci.yml · SHA pins and Dependabot (deferred).
8-9. Build-only advisories; signing (deferred).

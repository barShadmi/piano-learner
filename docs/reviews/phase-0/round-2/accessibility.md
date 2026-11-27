# Accessibility · phase 0 · round 2
Score: 9/10. No Blocking. axe 0 violations / 0 incomplete in 6 runs (Library light/dark ± reduced motion, Not found light/dark). Tab, focus ring 15.8/16.4:1, 122x44, 200% and 400% zoom OK.

Polish:
1. `src/main/index.ts:108` · Regression: no menu in the installed app removes Ctrl+= / Ctrl+- / Ctrl+0 zoom. Handle them in `before-input-event`. Add to gate list.
2. `NotFound.tsx` · Dead end, no padding; add .screen padding, a line and a 44 px "Back to your songs" link.
3. `base.css:37-43` · forced-colors: off button uses GrayText.
4. Token pairs for phase 1 keyboard task (deferred); wrong vs correct differ by hue only, so wrong notes need ✕ + label, with a test.
5. axe in e2e (deferred).

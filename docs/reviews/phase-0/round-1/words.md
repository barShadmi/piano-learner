# Words (UX writing) · phase 0 · round 1
Score: 6/10

1. **Blocking** · `src/renderer/src/screens/Library.tsx:50` · Button label must be "Import file" (CLAUDE.md rule). Update tests and `docs/plans/phase-0/electron-shell.md:14`.
2. **Blocking** · `Library.tsx:45-51` · Disabled button with no reason is a dead end. Add a muted line "Importing is coming soon." with `id="import-soon"` and `aria-describedby="import-soon"` on the button, shown only while import is not live.
3. **Polish** · `Library.tsx:43` · Empty-state line: "No songs yet. Import sheet music (a photo or PDF), a MIDI or MusicXML file, or a falling-notes video to start playing."

No score-site names found in src/. Heading, window title and lang are fine.

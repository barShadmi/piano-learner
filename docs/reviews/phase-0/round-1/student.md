# Student · phase 0 · round 1
Score: 6/10

Tested by running the built app under xvfb as a beginner (click, Tab, menu, 1024x640 at 200% zoom).

1. **Blocking** · `Library.tsx:42-51,24-29` · "Import … to begin" above an off button with no reason; light-theme off button looks like a normal secondary button. Add a muted "coming soon" line linked by aria-describedby (or change the copy).
2. **Blocking** · `Library.tsx:50` · Label must be "Import file" (CLAUDE.md).
3. **Polish** · `Library.tsx:43` · Jargon ("a sheet", MIDI, MusicXML) for a first screen; plainer words.
4. **Polish** · `Library.tsx:4-6` · At 1920x1080 three items sit top-left; make a deliberate centred empty state with a welcome line, tokens only.
5. **Polish** · `src/main/index.ts:26-56` · Default Electron menu (Reload, Toggle DevTools) shown; hide it when `app.isPackaged`.

Held up: wraps cleanly at 1024x640 200%, both themes clear, no theme flash, 96x44 hit area, no score-site name.

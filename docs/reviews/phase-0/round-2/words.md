# Words · phase 0 · round 2
Score: 8/10. No Blocking. Both round 1 Blocking items fixed.

Polish:
1. `Library.tsx:22-23` · Split the empty line and make it describe the future: "No songs yet." / "You'll be able to import sheet music (a photo or PDF), a MIDI or MusicXML file, or a falling-note video." ("falling-note", not "falling-notes".) Restore the imperative in phase 2.
2. `NotFound.tsx:4` · Add "This screen doesn't exist yet." and a 44 px "Back to your songs" link to `#/` (dev-only screen).
3. `src/main/index.ts:64,112` · On start/load failure show `dialog.showErrorBox` before quitting.
4. `Library.tsx:20` · Use `aria-labelledby` the h1 instead of aria-label "Song list".

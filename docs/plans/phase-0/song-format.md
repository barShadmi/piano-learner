# Phase 0 · Task 4 · Internal song format

Goal: one song model that every importer writes and every mode reads, with a validator. Lives in `src/shared/song/` so main and renderer can both use it. Pure TypeScript, no dependencies.

## Step 1 · Types, validator, sample song (builder)
Files to create: `src/shared/song/types.ts`, `src/shared/song/validate.ts`, `src/shared/song/index.ts`, `src/shared/song/samples/canon-opening.json`, `src/shared/song/validate.test.ts`.

Types (`types.ts`):
- `Hand = 'left' | 'right'`; `Finger = 1 | 2 | 3 | 4 | 5`.
- `Note { id: string; pitch: number /* MIDI 21..108 */; start: number /* in beats from song start */; duration: number /* beats, > 0 */; hand: Hand; finger?: Finger; fingerSource?: 'printed' | 'auto' | 'user'; velocity?: number /* 1..127 */; confidence?: number /* 0..1, from scanning */ }`.
- `TimeSignature { beats: number; beatUnit: 1 | 2 | 4 | 8 | 16 }` (beatUnit 4 = quarter).
- `Measure { index: number /* 0-based */; start: number /* beats */; timeSignature: TimeSignature }`.
- `TempoChange { start: number; bpm: number /* quarter notes per minute */ }`.
- `SongSource = { kind: 'sheet'; fileName: string } | { kind: 'midi'; fileName: string } | { kind: 'musicxml'; fileName: string } | { kind: 'video'; url?: string; fileName?: string }`.
- `Song { formatVersion: 1; id: string; title: string; composer?: string; keyFifths: number /* -7..7, D major = 2 */; measures: Measure[]; tempos: TempoChange[]; notes: Note[]; source: SongSource; level?: 'melody' | 'melody-bass' | 'full' }`.

Validator (`validate.ts`): `validateSong(value: unknown): { ok: true; song: Song } | { ok: false; errors: string[] }`. It checks shape and these rules, collecting every error (not stopping at the first), each error naming the path, e.g. `notes[3].pitch: must be 21..108`:
- `formatVersion` is 1; `title` non-empty; `keyFifths` integer -7..7.
- at least one measure; measure indexes are 0,1,2… in order; starts strictly increase; first measure starts at 0.
- at least one tempo; first tempo starts at 0; bpm 20..300.
- note ids unique; pitch integer 21..108; start >= 0; duration > 0; hand valid; finger 1..5 when present; velocity 1..127 when present; confidence 0..1 when present.
- every note starts before the end of the last measure (last measure end = its start + beats × 4 / beatUnit).

Sample (`canon-opening.json`): Canon in D bars 1 to 8 (key 2, 4/4, quarter = 100). Left hand, eighth notes (duration 0.5) each bar: bar 1 D3 A3 D4 F#4 A2 E3 A3 C#4; bar 2 B2 F#3 B3 D4 F#2 C#3 F#3 A3; bar 3 G2 D3 G3 B3 D2 A2 D3 F#3; bar 4 G2 D3 G3 B3 A2 E3 A3 C#4; bars 5 to 8 repeat bars 1 to 4. Right hand, half notes (duration 2) in bars 5 to 8: F#5 E5 | D5 C#5 | B4 A4 | B4 C#5. Source `{ kind: 'sheet', fileName: 'canon-in-d-johann-pachelbel.pdf' }`. MIDI numbers: C4 = 60.

Test first (`validate.test.ts`, Vitest): the sample is valid and has 64 left-hand notes and 8 right-hand notes; and one failing case per rule above, each asserting the exact error path appears; and that several errors are all reported together.

Acceptance:
1. `npm test` passes, with at least 15 tests in `validate.test.ts`.
2. `npm run typecheck` and `npm run lint` pass.
3. The sample's notes match the bars listed above (verifier spot-checks bar 2 left hand and bar 7 right hand pitches).
4. No dependency added; only the listed files changed.

## Log
| Step | Built by | Tries | Verifier |
| --- | --- | --- | --- |
| 1 | builder (Haiku) | 1 | PASS (lead added src/shared to typecheck) |
| 2 | builder (Haiku) | 1 | PASS |

## Step 2 · Close validator gaps found by the verifier (builder)
Files: `src/shared/song/validate.ts`, `src/shared/song/validate.test.ts`.
Add checks, each with a failing test first that asserts the exact error path:
1. Every tempo: start finite and >= 0, starts strictly increasing, bpm 20..300 (not only the first).
2. `fingerSource`, when present, is 'printed' | 'auto' | 'user'.
3. `source`: sheet/midi/musicxml need a non-empty `fileName`; video needs at least one of a non-empty `url` or `fileName`.
4. `level`, when present, is 'melody' | 'melody-bass' | 'full'; `composer`, when present, is a non-empty string.
5. Iterate arrays with an index loop so holes are reported (`notes[1]: must be an object`).
6. Add tests for: pitch 20 (too low), an unknown `source.kind`, a bad `beatUnit`.
Acceptance: all old and new tests pass; typecheck and lint pass; only the two files change.

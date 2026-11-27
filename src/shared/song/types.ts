// The internal song format. Every importer writes this shape and every mode reads it.

export type Hand = 'left' | 'right'

export type Finger = 1 | 2 | 3 | 4 | 5

export interface Note {
  id: string
  /** MIDI note number, 21..108 (A0 to C8). C4 = 60. */
  pitch: number
  /** Start, in beats from the start of the song. */
  start: number
  /** Length in beats. Always > 0. */
  duration: number
  hand: Hand
  finger?: Finger
  fingerSource?: 'printed' | 'auto' | 'user'
  /** 1..127 */
  velocity?: number
  /** 0..1, from scanning */
  confidence?: number
}

export interface TimeSignature {
  beats: number
  /** 4 = quarter note */
  beatUnit: 1 | 2 | 4 | 8 | 16
}

export interface Measure {
  /** 0-based */
  index: number
  /** Start, in beats */
  start: number
  timeSignature: TimeSignature
}

export interface TempoChange {
  /** Start, in beats */
  start: number
  /** Quarter notes per minute */
  bpm: number
}

export type SongSource =
  | { kind: 'sheet'; fileName: string }
  | { kind: 'midi'; fileName: string }
  | { kind: 'musicxml'; fileName: string }
  | { kind: 'video'; url?: string; fileName?: string }

export interface Song {
  formatVersion: 1
  id: string
  title: string
  composer?: string
  /** -7..7. D major = 2. */
  keyFifths: number
  measures: Measure[]
  tempos: TempoChange[]
  notes: Note[]
  source: SongSource
  level?: 'melody' | 'melody-bass' | 'full'
}

import { describe, expect, it } from 'vitest'
import type { Song, TempoChange } from '../../../shared/song/types'
import { beatToSeconds, secondsToBeat, songLengthSeconds, songNotesInSeconds } from './songTime'

function makeSong(overrides: Partial<Song> = {}): Song {
  return {
    formatVersion: 1,
    id: 'test',
    title: 'Test',
    keyFifths: 0,
    measures: [],
    tempos: [{ start: 0, bpm: 120 }],
    notes: [],
    source: { kind: 'midi', fileName: 'test.mid' },
    ...overrides
  }
}

// Seeded PRNG (mulberry32) so random tests are the same on every run.
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('beatToSeconds and secondsToBeat with one tempo', () => {
  const tempos: TempoChange[] = [{ start: 0, bpm: 120 }]

  it('at 120 bpm one quarter note is half a second', () => {
    expect(beatToSeconds(tempos, 1)).toBeCloseTo(0.5, 10)
    expect(beatToSeconds(tempos, 4)).toBeCloseTo(2, 10)
  })

  it('converts seconds back to beats', () => {
    expect(secondsToBeat(tempos, 2)).toBeCloseTo(4, 10)
  })
})

describe('beatToSeconds and secondsToBeat with two tempos', () => {
  // 120 bpm from beat 0, then 60 bpm from beat 4.
  const tempos: TempoChange[] = [
    { start: 0, bpm: 120 },
    { start: 4, bpm: 60 }
  ]

  it('uses 120 bpm up to beat 4 (2 seconds)', () => {
    expect(beatToSeconds(tempos, 4)).toBeCloseTo(2, 10)
  })

  it('uses 60 bpm after beat 4 (one second per beat)', () => {
    expect(beatToSeconds(tempos, 5)).toBeCloseTo(3, 10)
    expect(beatToSeconds(tempos, 8)).toBeCloseTo(6, 10)
  })

  it('converts seconds back to beats across the tempo change', () => {
    expect(secondsToBeat(tempos, 2)).toBeCloseTo(4, 10)
    expect(secondsToBeat(tempos, 3)).toBeCloseTo(5, 10)
    expect(secondsToBeat(tempos, 6)).toBeCloseTo(8, 10)
  })

  it('round-trips seconds to beats to seconds', () => {
    const rand = prng(7)
    for (let i = 0; i < 200; i++) {
      const seconds = rand() * 20
      expect(beatToSeconds(tempos, secondsToBeat(tempos, seconds))).toBeCloseTo(seconds, 9)
    }
  })

  it('sorts unsorted tempos before using them', () => {
    const unsorted: TempoChange[] = [
      { start: 4, bpm: 60 },
      { start: 0, bpm: 120 }
    ]
    expect(beatToSeconds(unsorted, 8)).toBeCloseTo(6, 10)
  })

  it('uses the first tempo bpm from beat 0 when the first tempo starts after 0', () => {
    const late: TempoChange[] = [{ start: 4, bpm: 60 }]
    // From beat 0 at 60 bpm, so beat 4 is 4 seconds.
    expect(beatToSeconds(late, 4)).toBeCloseTo(4, 10)
    expect(beatToSeconds(late, 5)).toBeCloseTo(5, 10)
  })

  it('treats an empty tempo list as 120 bpm', () => {
    expect(beatToSeconds([], 4)).toBeCloseTo(2, 10)
    expect(secondsToBeat([], 2)).toBeCloseTo(4, 10)
  })
})

describe('songNotesInSeconds', () => {
  it('turns beats into start and end seconds using the tempo map', () => {
    const song = makeSong({
      tempos: [
        { start: 0, bpm: 120 },
        { start: 4, bpm: 60 }
      ],
      notes: [{ id: 'a', pitch: 60, start: 2, duration: 4, hand: 'right', finger: 1 }]
    })
    const [note] = songNotesInSeconds(song).notes
    expect(note.id).toBe('a')
    expect(note.pitch).toBe(60)
    expect(note.hand).toBe('right')
    expect(note.finger).toBe(1)
    expect(note.startS).toBeCloseTo(1, 10)
    // Beat 6 is 2 + 2 * 1 = 4 seconds.
    expect(note.endS).toBeCloseTo(4, 10)
  })

  it('sorts the notes by start time, even when the song lists them out of order', () => {
    const song = makeSong({
      notes: [
        { id: 'late', pitch: 62, start: 8, duration: 1, hand: 'right' },
        { id: 'early', pitch: 60, start: 0, duration: 1, hand: 'left' },
        { id: 'middle', pitch: 64, start: 4, duration: 1, hand: 'right' }
      ]
    })
    const { notes } = songNotesInSeconds(song)
    expect(notes.map((n) => n.id)).toEqual(['early', 'middle', 'late'])
    for (let i = 1; i < notes.length; i++) {
      expect(notes[i].startS).toBeGreaterThanOrEqual(notes[i - 1].startS)
    }
  })

  it('reports the longest note duration in seconds', () => {
    const song = makeSong({
      notes: [
        { id: 'short', pitch: 60, start: 0, duration: 0.5, hand: 'right' },
        { id: 'long', pitch: 62, start: 1, duration: 4, hand: 'right' }
      ]
    })
    expect(songNotesInSeconds(song).maxDurationS).toBeCloseTo(2, 10)
  })

  it('returns no notes and zero max duration for an empty song', () => {
    const timed = songNotesInSeconds(makeSong())
    expect(timed.notes).toEqual([])
    expect(timed.maxDurationS).toBe(0)
  })
})

describe('songLengthSeconds', () => {
  it('is the end time of the last note', () => {
    const song = makeSong({
      notes: [
        { id: 'a', pitch: 60, start: 0, duration: 1, hand: 'right' },
        { id: 'b', pitch: 62, start: 4, duration: 2, hand: 'right' }
      ]
    })
    // Beat 6 at 120 bpm is 3 seconds.
    expect(songLengthSeconds(song)).toBeCloseTo(3, 10)
  })

  it('is 0 for a song with no notes', () => {
    expect(songLengthSeconds(makeSong())).toBe(0)
  })
})

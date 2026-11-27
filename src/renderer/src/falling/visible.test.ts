import { describe, expect, it } from 'vitest'
import type { Song } from '../../../shared/song/types'
import { songNotesInSeconds, type NoteTiming, type TimedNotes } from './songTime'
import { noteRect, soundingNotes, visibleFrom, visibleRange, visibleTo, startedBy } from './visible'

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

function randomTimedSong(count: number, seed: number): TimedNotes {
  const rand = prng(seed)
  const notes = []
  for (let i = 0; i < count; i++) {
    notes.push({
      id: `n${i}`,
      pitch: 21 + Math.floor(rand() * 88),
      start: rand() * 400,
      duration: 0.05 + rand() * 6,
      hand: rand() < 0.5 ? ('right' as const) : ('left' as const)
    })
  }
  // A tempo change in the middle so the beat-to-seconds map is not flat.
  const song = makeSong({
    notes,
    tempos: [
      { start: 0, bpm: 90 },
      { start: 200, bpm: 150 }
    ]
  })
  return songNotesInSeconds(song)
}

function bruteVisible(notes: NoteTiming[], nowS: number, lookaheadS: number): NoteTiming[] {
  return notes.filter((n) => n.endS > nowS && n.startS < nowS + lookaheadS)
}

describe('visibleRange', () => {
  it('returns [0, 0) for an empty song', () => {
    const timed = songNotesInSeconds(makeSong())
    expect(visibleRange(timed, 0, 3)).toEqual([0, 0])
  })

  it('finds a note that is falling in the window', () => {
    const song = makeSong({
      notes: [{ id: 'a', pitch: 60, start: 4, duration: 1, hand: 'right' }]
    })
    // Note starts at 2 s. At now = 1 s it is inside the 3 s window.
    const timed = songNotesInSeconds(song)
    expect(visibleRange(timed, 1, 3)).toEqual([0, 1])
  })

  it('keeps a note that started before now while it is still sounding', () => {
    const song = makeSong({
      notes: [{ id: 'a', pitch: 60, start: 0, duration: 4, hand: 'right' }]
    })
    // Starts at 0 s, lasts 2 s. At now = 1 s it is still sounding.
    const timed = songNotesInSeconds(song)
    expect(visibleRange(timed, 1, 3)).toEqual([0, 1])
  })

  it('drops a note once it has ended', () => {
    const song = makeSong({
      notes: [{ id: 'a', pitch: 60, start: 0, duration: 1, hand: 'right' }]
    })
    const timed = songNotesInSeconds(song)
    const [from, to] = visibleRange(timed, 1, 3)
    expect(to - from).toBe(0)
  })

  it('matches a brute-force filter on 2,000 random notes for 200 random times', () => {
    const timed = randomTimedSong(2000, 12345)
    const rand = prng(999)
    for (let i = 0; i < 200; i++) {
      const nowS = -3 + rand() * 420
      const lookaheadS = 3
      const [from, to] = visibleRange(timed, nowS, lookaheadS)
      expect(from).toBeGreaterThanOrEqual(0)
      expect(to).toBeLessThanOrEqual(timed.notes.length)
      expect(from).toBeLessThanOrEqual(to)
      // Every visible note must be inside the range. The range may hold a few
      // extra notes that already ended, so filter those out inside the range.
      const got = timed.notes.slice(from, to).filter((n) => n.endS > nowS && n.startS < nowS + lookaheadS)
      expect(got).toEqual(bruteVisible(timed.notes, nowS, lookaheadS))
    }
  })

  it('handles a 2,000-note song: 10,000 calls take under 50 ms', () => {
    const timed = randomTimedSong(2000, 4242)
    const rand = prng(31)
    const times: number[] = []
    for (let i = 0; i < 10000; i++) times.push(rand() * 420)
    const started = performance.now()
    let sink = 0
    for (const nowS of times) {
      const [from, to] = visibleRange(timed, nowS, 3)
      sink += to - from
    }
    const elapsed = performance.now() - started
    expect(sink).toBeGreaterThanOrEqual(0)
    expect(elapsed).toBeLessThan(50)
  })
})

describe('soundingNotes', () => {
  it('returns the notes whose start is at or before now and whose end is after now', () => {
    // At 120 bpm a beat is 0.5 s. 'a' sounds 0 to 2 s, 'b' sounds 2 to 3 s.
    const song = makeSong({
      notes: [
        { id: 'a', pitch: 60, start: 0, duration: 4, hand: 'right' },
        { id: 'b', pitch: 62, start: 4, duration: 2, hand: 'left' }
      ]
    })
    const timed = songNotesInSeconds(song)
    expect(soundingNotes(timed, 0).map((n) => n.id)).toEqual(['a'])
    expect(soundingNotes(timed, 1).map((n) => n.id)).toEqual(['a'])
    expect(soundingNotes(timed, 2).map((n) => n.id)).toEqual(['b'])
    expect(soundingNotes(timed, 3).map((n) => n.id)).toEqual([])
  })

  it('matches a brute-force filter on random times', () => {
    const timed = randomTimedSong(2000, 777)
    const rand = prng(55)
    for (let i = 0; i < 200; i++) {
      const nowS = rand() * 420
      const expected = timed.notes.filter((n) => n.startS <= nowS && n.endS > nowS)
      expect(soundingNotes(timed, nowS)).toEqual(expected)
    }
  })
})

describe('noteRect', () => {
  // 52 white keys across 520 px, so one white key is 10 px wide.
  const widthPx = 520
  const heightPx = 300
  const lookaheadS = 3

  function timedFor(pitch: number, start: number, duration: number): NoteTiming {
    const timed = songNotesInSeconds(
      makeSong({ notes: [{ id: 'x', pitch, start, duration, hand: 'right' }] })
    )
    return timed.notes[0]
  }

  it('puts a note that starts now with its bottom edge at heightPx', () => {
    const note = timedFor(60, 2, 1)
    const rect = noteRect(note, note.startS, lookaheadS, widthPx, heightPx)
    expect(rect.y + rect.h).toBeCloseTo(heightPx, 10)
  })

  it('puts a note that starts in 3 s just above the top of the canvas', () => {
    const note = timedFor(60, 6, 1)
    const rect = noteRect(note, note.startS - 3, lookaheadS, widthPx, heightPx)
    expect(rect.y + rect.h).toBeCloseTo(0, 10)
  })

  it('makes the note height proportional to its duration (heightPx per 3 s)', () => {
    // 3 beats at 120 bpm is 1.5 s, which is half of the 3 s window.
    const note = timedFor(60, 0, 3)
    const rect = noteRect(note, 0, lookaheadS, widthPx, heightPx)
    expect(rect.h).toBeCloseTo(heightPx / 2, 10)
  })

  it('places x and width from the keyboard layout', () => {
    // C4 (60) is white key index 23 (A0 = 0), so x = 23 * 10 px.
    const rect = noteRect(timedFor(60, 0, 1), 0, lookaheadS, widthPx, heightPx)
    expect(rect.x).toBeCloseTo(230, 10)
    expect(rect.w).toBeCloseTo(10, 10)
  })

  it('draws black key notes narrower than white key notes', () => {
    const white = noteRect(timedFor(60, 0, 1), 0, lookaheadS, widthPx, heightPx)
    const black = noteRect(timedFor(61, 0, 1), 0, lookaheadS, widthPx, heightPx)
    expect(black.w).toBeLessThan(white.w)
  })
})

describe('the number-only range functions (no array per call)', () => {
  it('visibleFrom and visibleTo give the same range as visibleRange', () => {
    const timed = randomTimedSong(500, 7)
    const rnd = prng(11)
    for (let k = 0; k < 100; k++) {
      const nowS = rnd() * 60
      const [from, to] = visibleRange(timed, nowS, 3)
      expect(visibleFrom(timed, nowS)).toBe(from)
      expect(Math.max(from, visibleTo(timed, nowS, 3))).toBe(to)
    }
  })

  it('startedBy counts the notes that start at or before nowS', () => {
    const timed = randomTimedSong(300, 3)
    const rnd = prng(5)
    for (let k = 0; k < 50; k++) {
      const nowS = rnd() * 60
      expect(startedBy(timed, nowS)).toBe(timed.notes.filter((n) => n.startS <= nowS).length)
    }
  })
})

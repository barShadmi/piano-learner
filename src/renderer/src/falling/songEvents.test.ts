import { describe, expect, it } from 'vitest'
import { MAX_SONG_EVENTS } from '../../../shared/audio'
import { songEventsPlan } from './songEvents'
import type { NoteTiming, TimedNotes } from './songTime'

function note(overrides: Partial<NoteTiming> & Pick<NoteTiming, 'startS' | 'endS'>): NoteTiming {
  return { id: 'n', pitch: 60, hand: 'right', ...overrides }
}

function timed(notes: NoteTiming[]): TimedNotes {
  return { notes, maxDurationS: 0 }
}

describe("songEventsPlan events", () => {
  it('makes an on event at the start and an off event at the end, in milliseconds', () => {
    const events = songEventsPlan(timed([note({ pitch: 60, startS: 1, endS: 1.5 })])).events
    expect(events).toEqual([
      { timeMs: 1000, note: 60, velocity: 80, on: true },
      { timeMs: 1500, note: 60, velocity: 0, on: false }
    ])
  })

  it('uses the note velocity for the note on, and 0 for the note off', () => {
    const events = songEventsPlan(timed([note({ startS: 0, endS: 1, velocity: 100 })])).events
    expect(events.map((e) => e.velocity)).toEqual([100, 0])
  })

  it('uses the default velocity when the note has none, and a chosen default when asked', () => {
    const events = songEventsPlan(timed([note({ startS: 0, endS: 1 })]), 64).events
    expect(events[0].velocity).toBe(64)
  })

  it('skips notes that start before the song (the lead-in)', () => {
    const events = songEventsPlan(
      timed([note({ pitch: 60, startS: -2, endS: -1 }), note({ pitch: 62, startS: 0, endS: 0.5 })])
    ).events
    expect(events.map((e) => e.note)).toEqual([62, 62])
  })

  it('sorts by time, and releases a note before the next one starts on the same key', () => {
    const events = songEventsPlan(
      timed([
        note({ id: 'a', pitch: 60, startS: 0, endS: 1 }),
        note({ id: 'b', pitch: 60, startS: 1, endS: 2 }),
        note({ id: 'c', pitch: 64, startS: 0.5, endS: 0.75 })
      ])
    ).events
    expect(events.map((e) => [e.timeMs, e.note, e.on])).toEqual([
      [0, 60, true],
      [500, 64, true],
      [750, 64, false],
      [1000, 60, false],
      [1000, 60, true],
      [2000, 60, false]
    ])
  })

  it('ends an earlier note when the same key is struck again before it ends', () => {
    const events = songEventsPlan(
      timed([
        note({ id: 'a', pitch: 60, startS: 0, endS: 1 }),
        note({ id: 'b', pitch: 60, startS: 0.5, endS: 1.5 })
      ])
    ).events
    expect(events.map((e) => [e.timeMs, e.note, e.on])).toEqual([
      [0, 60, true],
      [500, 60, false],
      [500, 60, true],
      [1500, 60, false]
    ])
  })

  it('keeps the longer note when two notes on the same key start together, in either order', () => {
    for (const [first, second] of [
      [2, 0.5],
      [0.5, 2]
    ]) {
      const events = songEventsPlan(
        timed([
          note({ id: 'a', pitch: 60, startS: 0, endS: first }),
          note({ id: 'b', pitch: 60, startS: 0, endS: second })
        ])
      ).events
      expect(events.map((e) => [e.timeMs, e.note, e.on])).toEqual([
        [0, 60, true],
        [2000, 60, false]
      ])
    }
  })

  it('skips a note outside the piano keys, so one bad note does not refuse the whole song', () => {
    const events = songEventsPlan(timed([note({ pitch: 10, startS: 0, endS: 1 })])).events
    expect(events).toEqual([])
  })

  it('skips a note that starts or ends after the one-day limit', () => {
    const events = songEventsPlan(timed([note({ startS: 90000, endS: 90001 })])).events
    expect(events).toEqual([])
  })

  it('never gives more than the engine accepts, and keeps note on and off pairs whole', () => {
    const many: NoteTiming[] = []
    for (let i = 0; i < MAX_SONG_EVENTS / 2 + 10; i++) {
      many.push(note({ startS: i * 0.01, endS: i * 0.01 + 0.005 }))
    }
    const events = songEventsPlan(timed(many)).events
    expect(events.length).toBe(MAX_SONG_EVENTS)
    expect(events.filter((e) => e.on).length).toBe(events.length / 2)
  })

  it('says when the song was cut at the event cap, and not when it was not', () => {
    const many: NoteTiming[] = []
    for (let i = 0; i < MAX_SONG_EVENTS / 2 + 10; i++) {
      many.push(note({ startS: i * 0.01, endS: i * 0.01 + 0.005 }))
    }
    expect(songEventsPlan(timed(many)).cut).toBe(true)
    expect(songEventsPlan(timed([note({ startS: 0, endS: 1 })])).cut).toBe(false)
  })
})

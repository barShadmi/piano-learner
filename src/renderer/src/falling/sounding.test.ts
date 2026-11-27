import { describe, expect, it } from 'vitest'
import { SoundingTracker } from './sounding'
import type { NoteTiming, TimedNotes } from './songTime'

function timed(list: Array<[number, number, number, 'right' | 'left']>): TimedNotes {
  const notes: NoteTiming[] = list.map(([pitch, startS, endS, hand], i) => ({
    id: `n${i}`,
    pitch,
    hand,
    startS,
    endS
  }))
  notes.sort((a, b) => a.startS - b.startS)
  return { notes, maxDurationS: Math.max(...notes.map((n) => n.endS - n.startS)) }
}

describe('SoundingTracker', () => {
  const song = timed([
    [60, 1, 2, 'right'],
    [48, 1, 3, 'left']
  ])

  it('reports a change when notes start, and not while the set stays the same', () => {
    const t = new SoundingTracker(song)
    expect(t.update(0.5)).toBe(false) // nothing sounding, nothing before
    expect(t.update(1.0)).toBe(true) // both start
    expect(t.update(1.5)).toBe(false)
    expect(t.update(1.9)).toBe(false)
  })

  it('reports a change when a note ends', () => {
    const t = new SoundingTracker(song)
    t.update(1.5)
    expect(t.update(2.0)).toBe(true) // 60 ended, 48 still sounding
    expect(t.update(2.5)).toBe(false)
    expect(t.update(3.0)).toBe(true) // all ended
  })

  it('gives the sounding pitches with their hands', () => {
    const t = new SoundingTracker(song)
    t.update(1.5)
    const map = t.byPitch()
    expect(map.get(60)).toBe('right')
    expect(map.get(48)).toBe('left')
    expect(map.size).toBe(2)
  })

  it('reports a change after a seek back', () => {
    const t = new SoundingTracker(song)
    t.update(1.5)
    expect(t.update(0)).toBe(true)
    expect(t.byPitch().size).toBe(0)
  })

  it('skips pitches outside the keyboard without throwing', () => {
    const t = new SoundingTracker(timed([[10, 0, 1, 'right'], [60, 0, 1, 'right']]))
    t.update(0.5)
    expect([...t.byPitch().keys()]).toEqual([60])
  })
})

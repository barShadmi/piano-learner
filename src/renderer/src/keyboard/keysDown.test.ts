import { describe, expect, it } from 'vitest'
import type { MidiEvent } from '../../../shared/audio'
import { applyEvents, keysDownLine, type KeysState } from './keysDown'

const empty: KeysState = { down: new Set(), pedal: false }

function on(note: number): MidiEvent {
  return { kind: 'on', note, velocity: 80, timeUs: 0 }
}
function off(note: number): MidiEvent {
  return { kind: 'off', note, velocity: 0, timeUs: 0 }
}
function sustain(down: boolean): MidiEvent {
  return { kind: 'sustain', note: 0, velocity: 0, down, timeUs: 0 }
}
const allOff: MidiEvent = { kind: 'allOff', note: 0, velocity: 0, timeUs: 0 }

describe('applyEvents', () => {
  it('adds a key on "on"', () => {
    const s = applyEvents(empty, [on(60)])
    expect([...s.down]).toEqual([60])
  })

  it('removes a key on "off"', () => {
    const s = applyEvents(applyEvents(empty, [on(60), on(64)]), [off(60)])
    expect([...s.down]).toEqual([64])
  })

  it('clears all keys on "allOff"', () => {
    const s = applyEvents(empty, [on(60), on(64), allOff])
    expect(s.down.size).toBe(0)
  })

  it('sets the pedal on "sustain" with down true and clears it with false', () => {
    const down = applyEvents(empty, [sustain(true)])
    expect(down.pedal).toBe(true)
    const up = applyEvents(down, [sustain(false)])
    expect(up.pedal).toBe(false)
  })

  it('treats a repeated "on" as harmless', () => {
    const s = applyEvents(empty, [on(60), on(60)])
    expect([...s.down]).toEqual([60])
  })

  it('treats an "off" for a key not down as harmless', () => {
    const s = applyEvents(empty, [off(60)])
    expect(s.down.size).toBe(0)
  })

  it('ignores notes outside 21 to 108', () => {
    const s = applyEvents(empty, [on(20), on(109), on(21), on(108)])
    expect([...s.down].sort((a, b) => a - b)).toEqual([21, 108])
  })

  it('returns the same object when nothing changed', () => {
    const s1 = applyEvents(empty, [on(60)])
    expect(applyEvents(s1, [on(60)])).toBe(s1)
    expect(applyEvents(s1, [off(64)])).toBe(s1)
    expect(applyEvents(s1, [on(20)])).toBe(s1)
    expect(applyEvents(s1, [])).toBe(s1)
    const s2 = applyEvents(s1, [sustain(true)])
    expect(applyEvents(s2, [sustain(true)])).toBe(s2)
  })

  it('does not change the old state object', () => {
    const s1 = applyEvents(empty, [on(60)])
    applyEvents(s1, [on(64)])
    expect([...s1.down]).toEqual([60])
  })
})

describe('keysDownLine', () => {
  it('says "No keys down." when nothing is down', () => {
    expect(keysDownLine(empty)).toBe('No keys down.')
  })

  it('lists keys in pitch order with names', () => {
    const s = applyEvents(empty, [on(67), on(60), on(64)])
    expect(keysDownLine(s)).toBe('Keys down: C4, E4, G4')
  })

  it('uses ♯ in names', () => {
    const s = applyEvents(empty, [on(61)])
    expect(keysDownLine(s)).toBe('Keys down: C♯4')
  })
})

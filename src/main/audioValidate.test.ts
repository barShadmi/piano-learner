import { describe, expect, it } from 'vitest'
import { parseSongPlay, parseStartConfig, parseToneArgs, parseVolume } from './audioValidate'

describe('parseVolume', () => {
  it('accepts a number from 0 to 1', () => {
    expect(parseVolume(0)).toEqual({ ok: true, value: 0 })
    expect(parseVolume(0.35)).toEqual({ ok: true, value: 0.35 })
    expect(parseVolume(1)).toEqual({ ok: true, value: 1 })
  })

  it('rejects anything else, in plain words', () => {
    for (const bad of [-0.1, 1.5, NaN, Infinity, '0.5', undefined, null, true]) {
      const parsed = parseVolume(bad)
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.error).toBe('The volume must be a number from 0 to 1.')
    }
  })
})

describe('parseStartConfig', () => {
  it('accepts nothing at all as the defaults', () => {
    expect(parseStartConfig(undefined)).toEqual({ ok: true, value: {} })
    expect(parseStartConfig(null)).toEqual({ ok: true, value: {} })
    expect(parseStartConfig({})).toEqual({ ok: true, value: {} })
  })

  it('accepts a full valid config', () => {
    const config = { deviceId: 'abc', backend: 'asio', bufferFrames: 128 }
    expect(parseStartConfig(config)).toEqual({ ok: true, value: config })
  })

  it('rejects things that are not plain objects', () => {
    for (const bad of ['x', 5, true, [], () => 1]) {
      expect(parseStartConfig(bad).ok).toBe(false)
    }
  })

  it('rejects unknown keys', () => {
    expect(parseStartConfig({ volume: 1 }).ok).toBe(false)
  })

  it('rejects an unknown backend', () => {
    expect(parseStartConfig({ backend: 'web-audio' }).ok).toBe(false)
    expect(parseStartConfig({ backend: 3 }).ok).toBe(false)
  })

  it('rejects a bad device id', () => {
    expect(parseStartConfig({ deviceId: '' }).ok).toBe(false)
    expect(parseStartConfig({ deviceId: 7 }).ok).toBe(false)
    expect(parseStartConfig({ deviceId: 'x'.repeat(1025) }).ok).toBe(false)
  })

  it('rejects buffer sizes that are not whole numbers in 16 to 8192', () => {
    for (const bad of [0, 15, 8193, 64.5, NaN, Infinity, '128']) {
      expect(parseStartConfig({ bufferFrames: bad }).ok).toBe(false)
    }
    expect(parseStartConfig({ bufferFrames: 16 }).ok).toBe(true)
    expect(parseStartConfig({ bufferFrames: 8192 }).ok).toBe(true)
  })

  it('gives a plain-words reason when it rejects', () => {
    const result = parseStartConfig({ bufferFrames: 1 })
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/buffer/i) })
  })

  it('drops undefined fields so the addon sees only what was set', () => {
    expect(parseStartConfig({ deviceId: undefined, bufferFrames: 64 })).toEqual({
      ok: true,
      value: { bufferFrames: 64 }
    })
  })
})

describe('parseToneArgs', () => {
  it('accepts nothing as the defaults', () => {
    expect(parseToneArgs(undefined)).toEqual({ ok: true, value: {} })
    expect(parseToneArgs({})).toEqual({ ok: true, value: {} })
  })

  it('accepts a sensible tone', () => {
    expect(parseToneArgs({ frequencyHz: 440, seconds: 1 })).toEqual({
      ok: true,
      value: { frequencyHz: 440, seconds: 1 }
    })
  })

  it('rejects out of range or non-number values', () => {
    for (const bad of [{ frequencyHz: 10 }, { frequencyHz: 9000 }, { frequencyHz: NaN }, { frequencyHz: '440' }]) {
      expect(parseToneArgs(bad).ok).toBe(false)
    }
    for (const bad of [{ seconds: 0 }, { seconds: 6 }, { seconds: -1 }, { seconds: Infinity }]) {
      expect(parseToneArgs(bad).ok).toBe(false)
    }
  })

  it('rejects non-objects and unknown keys', () => {
    expect(parseToneArgs('loud').ok).toBe(false)
    expect(parseToneArgs([]).ok).toBe(false)
    expect(parseToneArgs({ gain: 1 }).ok).toBe(false)
  })
})

describe('parseSongPlay', () => {
  const ok = { timeMs: 0, note: 60, velocity: 80, on: true }

  it('accepts events and a start point', () => {
    const input = { events: [ok, { timeMs: 10.5, note: 108, velocity: 0, on: false }], fromMs: 5 }
    expect(parseSongPlay(input)).toEqual({ ok: true, value: input })
  })

  it('starts at 0 when no start point is given, and allows an empty song', () => {
    expect(parseSongPlay({ events: [] })).toEqual({ ok: true, value: { events: [], fromMs: 0 } })
  })

  it('accepts exactly 200000 events and refuses one more', () => {
    expect(parseSongPlay({ events: new Array(200_000).fill(ok), fromMs: 0 }).ok).toBe(true)
    const parsed = parseSongPlay({ events: new Array(200_001).fill(ok), fromMs: 0 })
    expect(parsed).toEqual({ ok: false, error: 'A song can have at most 200000 events.' })
  })

  it('refuses anything that is not an object with a list of events', () => {
    for (const bad of [undefined, null, 5, 'x', [], { fromMs: 0 }, { events: 'no' }, { events: {} }]) {
      expect(parseSongPlay(bad).ok, String(JSON.stringify(bad))).toBe(false)
    }
  })

  it('refuses unexpected fields at either level', () => {
    expect(parseSongPlay({ events: [], fromMs: 0, extra: 1 }).ok).toBe(false)
    expect(parseSongPlay({ events: [{ ...ok, extra: 1 }] }).ok).toBe(false)
    expect(parseSongPlay({ events: [{ timeMs: 0, note: 60, velocity: 80 }] }).ok).toBe(false)
  })

  it('refuses a note outside 21 to 108 or not a whole number', () => {
    for (const note of [20, 109, 60.5, NaN, '60', undefined]) {
      expect(parseSongPlay({ events: [{ ...ok, note }] }).ok, String(note)).toBe(false)
    }
  })

  it('refuses a velocity outside 1 to 127 for a note on, but lets a note off use 0', () => {
    for (const velocity of [0, 128, 1.5, -1, NaN]) {
      expect(parseSongPlay({ events: [{ ...ok, velocity }] }).ok, String(velocity)).toBe(false)
    }
    expect(parseSongPlay({ events: [{ ...ok, on: false, velocity: 0 }] }).ok).toBe(true)
    expect(parseSongPlay({ events: [{ ...ok, on: false, velocity: 128 }] }).ok).toBe(false)
  })

  it('refuses times that are negative, infinite or not numbers', () => {
    for (const timeMs of [-1, NaN, Infinity, '0', null]) {
      expect(parseSongPlay({ events: [{ ...ok, timeMs }] }).ok, String(timeMs)).toBe(false)
    }
    for (const fromMs of [-1, NaN, Infinity, '0', null]) {
      expect(parseSongPlay({ events: [], fromMs }).ok, String(fromMs)).toBe(false)
    }
  })

  it('allows a time of one day and refuses more', () => {
    const day = 86_400_000
    expect(parseSongPlay({ events: [{ ...ok, timeMs: day }], fromMs: day }).ok).toBe(true)
    expect(parseSongPlay({ events: [{ ...ok, timeMs: day + 1 }] }).ok).toBe(false)
    expect(parseSongPlay({ events: [], fromMs: day + 1 }).ok).toBe(false)
    expect(parseSongPlay({ events: [{ ...ok, timeMs: Number.MAX_VALUE }] }).ok).toBe(false)
  })

  it('refuses on that is not a true or false', () => {
    expect(parseSongPlay({ events: [{ ...ok, on: 1 }] }).ok).toBe(false)
  })

  it('gives plain English reasons', () => {
    const parsed = parseSongPlay({ events: [{ ...ok, note: 5 }] })
    expect(parsed).toEqual({ ok: false, error: expect.stringMatching(/note/i) })
  })
})

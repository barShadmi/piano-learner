import { describe, expect, it } from 'vitest'
import { parseStartConfig, parseToneArgs, parseVolume } from './audioValidate'

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

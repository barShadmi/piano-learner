import { describe, expect, it } from 'vitest'
import { checkSettings, defaultSettings, parseSettings, startConfigFor } from './settings'

describe('defaultSettings', () => {
  it('uses the fastest exclusive mode on Windows', () => {
    expect(defaultSettings('win32')).toEqual({
      backend: 'wasapi-exclusive',
      bufferFrames: 128,
      volume: 0.8,
      pianoSpeakers: false
    })
  })

  it('uses cpal on other systems', () => {
    expect(defaultSettings('linux').backend).toBe('cpal')
    expect(defaultSettings('darwin').backend).toBe('cpal')
  })

  it('leaves the device unset, which means the default output', () => {
    expect(defaultSettings('win32')).not.toHaveProperty('deviceId')
  })
})

describe('parseSettings', () => {
  it('gives the defaults for nothing, null or a non-object', () => {
    for (const bad of [undefined, null, 'x', 5, [], () => 1]) {
      expect(parseSettings(bad, 'win32')).toEqual(defaultSettings('win32'))
    }
  })

  it('keeps a full valid set', () => {
    const full = {
      deviceId: 'abc',
      backend: 'asio',
      bufferFrames: 256,
      volume: 0.5,
      pianoSpeakers: true
    }
    expect(parseSettings(full, 'win32')).toEqual(full)
  })

  it('fills defaults for missing fields', () => {
    expect(parseSettings({ bufferFrames: 512 }, 'win32')).toEqual({
      ...defaultSettings('win32'),
      bufferFrames: 512
    })
  })

  it('falls back to the default for an unknown backend or buffer size', () => {
    const parsed = parseSettings({ backend: 'web-audio', bufferFrames: 100 }, 'win32')
    expect(parsed.backend).toBe('wasapi-exclusive')
    expect(parsed.bufferFrames).toBe(128)
  })

  it('accepts only the four buffer sizes', () => {
    for (const good of [64, 128, 256, 512]) {
      expect(parseSettings({ bufferFrames: good }, 'win32').bufferFrames).toBe(good)
    }
    for (const bad of [32, 1024, 64.5, '128', NaN]) {
      expect(parseSettings({ bufferFrames: bad }, 'win32').bufferFrames).toBe(128)
    }
  })

  it('clamps the volume to 0 to 1 and uses the default for a non-number', () => {
    expect(parseSettings({ volume: 1.7 }, 'win32').volume).toBe(1)
    expect(parseSettings({ volume: -0.2 }, 'win32').volume).toBe(0)
    expect(parseSettings({ volume: 0.25 }, 'win32').volume).toBe(0.25)
    expect(parseSettings({ volume: '0.5' }, 'win32').volume).toBe(0.8)
    expect(parseSettings({ volume: NaN }, 'win32').volume).toBe(0.8)
  })

  it('uses the default for piano speakers unless it is a real boolean', () => {
    expect(parseSettings({ pianoSpeakers: true }, 'win32').pianoSpeakers).toBe(true)
    expect(parseSettings({ pianoSpeakers: 'yes' }, 'win32').pianoSpeakers).toBe(false)
  })

  it('drops an empty or very long device id', () => {
    expect(parseSettings({ deviceId: '' }, 'win32')).not.toHaveProperty('deviceId')
    expect(parseSettings({ deviceId: 'x'.repeat(1025) }, 'win32')).not.toHaveProperty('deviceId')
    expect(parseSettings({ deviceId: 7 }, 'win32')).not.toHaveProperty('deviceId')
  })

  it('ignores keys it does not know', () => {
    expect(parseSettings({ volume: 0.3, extra: 'x' }, 'win32')).toEqual({
      ...defaultSettings('win32'),
      volume: 0.3
    })
  })
})

describe('startConfigFor', () => {
  it('passes the output, mode and buffer to the engine', () => {
    expect(
      startConfigFor({ deviceId: 'abc', backend: 'wasapi-shared', bufferFrames: 256, volume: 0.8, pianoSpeakers: false })
    ).toEqual({ deviceId: 'abc', backend: 'wasapi-shared', bufferFrames: 256 })
  })

  it('leaves the device out when none is chosen', () => {
    const config = startConfigFor(defaultSettings('win32'))
    expect(config).toEqual({ backend: 'wasapi-exclusive', bufferFrames: 128 })
    expect(config).not.toHaveProperty('deviceId')
  })
})

describe('checkSettings', () => {
  it('refuses input that is not a plain object, in plain words', () => {
    for (const bad of [undefined, null, 'x', 5, [], () => 1]) {
      expect(checkSettings(bad, 'win32')).toEqual({ ok: false, error: 'Those settings are not valid.' })
    }
  })

  it('returns the parsed settings for a plain object', () => {
    expect(checkSettings({ bufferFrames: 256 }, 'win32')).toEqual({
      ok: true,
      value: { ...defaultSettings('win32'), bufferFrames: 256 }
    })
  })
})

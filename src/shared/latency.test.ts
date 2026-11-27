import { describe, expect, it } from 'vitest'
import {
  SOUND_OFF_LINE,
  soundIsOff,
  outputWords,
  reportJson,
  reportText,
  resultLine,
  setupRows,
  timingRows,
  verdict,
  verdictWords,
  type LatencySummary
} from './latency'

const base: LatencySummary = {
  count: 20,
  medianMs: 4.2,
  p95Ms: 5.1,
  maxMs: 6,
  outputMs: 2.7,
  bufferFrames: 128,
  sampleRate: 48000,
  backend: 'wasapi-exclusive',
  underruns: 0
}

const now = new Date('2026-11-27T13:50:00.000Z')

describe('verdict', () => {
  it('is good when the slowest of most keys is under 10 ms', () => {
    expect(verdict({ ...base, p95Ms: 9.99 })).toBe('good')
  })

  it('is close from 10 ms up to and including 15 ms', () => {
    expect(verdict({ ...base, p95Ms: 10 })).toBe('close')
    expect(verdict({ ...base, p95Ms: 15 })).toBe('close')
  })

  it('is slow above 15 ms', () => {
    expect(verdict({ ...base, p95Ms: 15.01 })).toBe('slow')
  })

  it('judges by the 95th percentile, not the median', () => {
    expect(verdict({ ...base, medianMs: 3, p95Ms: 12 })).toBe('close')
  })
})

describe('verdictWords', () => {
  it('says great, with a tick and no tips, when good', () => {
    expect(verdictWords('good')).toEqual({
      glyph: '✓',
      text: 'Great. Under 10 ms, you will not feel any delay.',
      tips: []
    })
  })

  it('gives the two things to try when close or slow', () => {
    for (const level of ['close', 'slow'] as const) {
      expect(verdictWords(level).tips).toEqual([
        'Choose exclusive mode or ASIO in Sound settings',
        'Use a smaller buffer'
      ])
    }
  })

  it('uses a different symbol for close and slow, so colour is not the only signal', () => {
    expect(verdictWords('close').glyph).toBe('▲')
    expect(verdictWords('slow').glyph).toBe('✗')
  })
})

describe('resultLine', () => {
  it('rounds the typical time to one decimal', () => {
    expect(resultLine(4.23)).toBe('About 4.2 ms from key to sound')
  })
})

describe('timingRows', () => {
  it('gives the plain-word rows, with the wait worked out from the median', () => {
    expect(timingRows(base)).toEqual([
      { label: 'Typical (median)', value: '4.2 ms' },
      { label: 'Slowest of most (95%)', value: '5.1 ms' },
      { label: 'Slowest', value: '6.0 ms' },
      { label: 'Of which waiting for the sound card', value: '0.5 ms' },
      { label: 'Sound card and driver', value: '2.7 ms' },
      { label: 'USB from the piano', value: '1.0 ms (estimated)' }
    ])
  })
})

describe('setupRows', () => {
  it('says how sound is set up in plain words', () => {
    expect(setupRows(base)).toEqual([
      { label: 'Output mode', value: 'exclusive mode' },
      { label: 'Buffer', value: '128 samples' },
      { label: 'Sample rate', value: '48000 Hz' },
      { label: 'Sound gaps (underruns)', value: '0' }
    ])
  })
})

describe('outputWords', () => {
  it('names each way of playing sound, and says when none is running', () => {
    expect(outputWords('wasapi-shared')).toBe('shared mode')
    expect(outputWords('asio')).toBe('ASIO')
    expect(outputWords('cpal')).toBe('standard mode')
    expect(outputWords('')).toBe('Not running')
  })
})

describe('reportText', () => {
  it('gives the result, the verdict and the rows in plain words', () => {
    const text = reportText(base, now)
    expect(text).toContain('About 4.2 ms from key to sound')
    expect(text).toContain('Great. Under 10 ms, you will not feel any delay.')
    expect(text).toContain('Typical (median): 4.2 ms')
    expect(text).toContain('Output mode: exclusive mode')
  })

  it('says when the sound card figure was measured', () => {
    expect(reportText(base, now)).toContain('measured when sound started')
  })

  it('says the time it was saved', () => {
    expect(reportText(base, now)).toContain('Saved at: 2026-11-27T13:50:00.000Z')
  })

  it('says no keys were timed yet, with no result, when there are none', () => {
    const text = reportText({ ...base, count: 0, backend: '' }, now)
    expect(text).toContain('No keys have been timed yet.')
    expect(text).not.toContain('About')
  })

  it('says how many keys so far, with no verdict, when fewer than 20', () => {
    const text = reportText({ ...base, count: 7 }, now)
    expect(text).toContain('Only 7 of 20 keys timed so far.')
    expect(text).not.toContain('Great.')
  })
})

describe('reportJson', () => {
  it('holds the numbers, the verdict and the time it was saved', () => {
    const data = JSON.parse(reportJson(base, now))
    expect(data).toMatchObject({
      savedAt: '2026-11-27T13:50:00.000Z',
      keysTimed: 20,
      medianMs: 4.2,
      p95Ms: 5.1,
      maxMs: 6,
      outputMs: 2.7,
      usbMs: 1,
      backend: 'wasapi-exclusive',
      bufferFrames: 128,
      sampleRate: 48000,
      underruns: 0,
      verdict: 'good'
    })
    expect(data.waitMs).toBeCloseTo(0.5)
  })

  it('has no verdict and no wait when there are no keys', () => {
    const data = JSON.parse(reportJson({ ...base, count: 0 }, now))
    expect(data.verdict).toBeNull()
    expect(data.waitMs).toBeNull()
  })
})

describe('soundIsOff', () => {
  it('is true when no sound output is running (no backend)', () => {
    expect(soundIsOff({ ...base, backend: '' })).toBe(true)
  })

  it('is false while an output is running', () => {
    expect(soundIsOff(base)).toBe(false)
  })

  it('gives the plain words to show instead', () => {
    expect(SOUND_OFF_LINE).toBe('Sound is not on. Go back to Sound and press Try again.')
  })
})

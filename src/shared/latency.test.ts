import { describe, expect, it } from 'vitest'
import {
  PLAY_A_KEY_FIRST,
  SOUND_OFF_LINE,
  hasTimedKey,
  progressAnnouncement,
  soundCardLine,
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
  it('says almost every key is under 10 ms, with a tick and no tips, when good', () => {
    expect(verdictWords('good')).toEqual({
      glyph: '✓',
      text: 'Almost every key sounds in under 10 ms. Good.',
      tips: []
    })
  })

  it('says most keys are fast but some take over 10 ms, when close', () => {
    expect(verdictWords('close').text).toBe('Most keys are fast, but some take over 10 ms.')
  })

  it('says some keys take over 15 ms, when slow', () => {
    expect(verdictWords('slow').text).toBe('Some keys take over 15 ms. Too slow.')
  })

  it('gives the two things to try when close or slow, using the Sound screen names', () => {
    for (const level of ['close', 'slow'] as const) {
      expect(verdictWords(level).tips).toEqual([
        'On the Sound screen, set Mode to Fastest (exclusive) or ASIO driver.',
        'Pick a smaller Buffer on the Sound screen.'
      ])
    }
  })

  it('uses a different symbol for close and slow, so colour is not the only signal', () => {
    expect(verdictWords('close').glyph).toBe('▲')
    expect(verdictWords('slow').glyph).toBe('✗')
  })
})

describe('resultLine', () => {
  it('says the big number is the typical key, rounded to one decimal', () => {
    expect(resultLine(4.23)).toBe('Typical key: about 4.2 ms.')
  })
})

describe('timingRows', () => {
  it('gives the plain-word rows, with the wait worked out from the median', () => {
    expect(timingRows(base)).toEqual([
      { label: 'Typical key', value: '4.2 ms' },
      { label: 'Almost every key (95 in 100)', value: '5.1 ms' },
      { label: 'Slowest', value: '6.0 ms' },
      { label: 'Waiting for the next sound slot (typical key)', value: '0.5 ms' },
      { label: 'Sound card and driver', value: '2.7 ms' },
      { label: 'USB from the piano', value: '1.0 ms (estimated)' }
    ])
  })
})

describe('setupRows', () => {
  it('says how sound is set up in plain words', () => {
    expect(setupRows(base)).toEqual([
      { label: 'Mode', value: 'exclusive mode' },
      { label: 'Buffer', value: '128 samples' },
      { label: 'Sample rate', value: '48000 Hz' },
      { label: 'Sound gaps', value: '0' }
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
    expect(text).toContain('Typical key: about 4.2 ms.')
    expect(text).toContain('Almost every key sounds in under 10 ms. Good.')
    expect(text).toContain('Typical key: 4.2 ms')
    expect(text).toContain('Mode: exclusive mode')
  })

  it('says the sound driver reported the sound card figure for WASAPI modes', () => {
    expect(reportText(base, now)).toContain(
      'The sound card figure was reported by the sound driver when sound started.'
    )
  })

  it('says the sound card figure was measured for the other modes', () => {
    const text = reportText({ ...base, backend: 'cpal' }, now)
    expect(text).toContain('The sound card figure was measured when sound started.')
    expect(text).not.toContain('reported by the sound driver')
  })

  it('says the time it was saved', () => {
    expect(reportText(base, now)).toContain('Saved at: 2026-11-27T13:50:00.000Z')
  })

  it('says no keys were timed yet, with no result, when there are none', () => {
    const text = reportText({ ...base, count: 0, backend: '' }, now)
    expect(text).toContain('No keys have been timed yet.')
    expect(text).not.toContain('Typical key')
  })

  it('says how many keys so far, with no verdict, when fewer than 20', () => {
    const text = reportText({ ...base, count: 7 }, now)
    expect(text).toContain('Only 7 of 20 keys timed so far.')
    expect(text).not.toContain('Almost every key sounds')
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

describe('hasTimedKey', () => {
  it('is false before any answer and before any key is timed, true once one is', () => {
    expect(hasTimedKey(undefined)).toBe(false)
    expect(hasTimedKey({ ...base, count: 0 })).toBe(false)
    expect(hasTimedKey({ ...base, count: 1 })).toBe(true)
  })

  it('gives the hint shown while Start over and Save report are off', () => {
    expect(PLAY_A_KEY_FIRST).toBe('Play a key first.')
  })
})

describe('progressAnnouncement', () => {
  it('says nothing for most keys, so the screen reader is not spammed', () => {
    expect(progressAnnouncement(0)).toBe('')
    expect(progressAnnouncement(3)).toBe('')
    expect(progressAnnouncement(6)).toBe('')
  })

  it('says the count every 5 keys, and when all 20 are timed', () => {
    expect(progressAnnouncement(5)).toBe('5 of 20 keys timed.')
    expect(progressAnnouncement(15)).toBe('15 of 20 keys timed.')
    expect(progressAnnouncement(20)).toBe('All 20 keys timed.')
  })
})

describe('soundCardLine', () => {
  it('says the driver reported the figure for WASAPI modes, and that it was measured otherwise', () => {
    expect(soundCardLine('wasapi-exclusive')).toBe(
      'The sound card figure was reported by the sound driver when sound started.'
    )
    expect(soundCardLine('wasapi-shared')).toBe(
      'The sound card figure was reported by the sound driver when sound started.'
    )
    expect(soundCardLine('cpal')).toBe('The sound card figure was measured when sound started.')
    expect(soundCardLine('asio')).toBe('The sound card figure was measured when sound started.')
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
    expect(SOUND_OFF_LINE).toBe('Sound is off. Go back to Sound and press Start sound or Try again.')
  })
})

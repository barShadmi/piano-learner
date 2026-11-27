import { describe, expect, it } from 'vitest'
import { backendWords, statusLine } from './soundText'

describe('backendWords', () => {
  it('uses plain words for each way of playing', () => {
    expect(backendWords('wasapi-exclusive')).toBe('exclusive mode')
    expect(backendWords('wasapi-shared')).toBe('shared mode')
    expect(backendWords('asio')).toBe('ASIO')
    expect(backendWords('cpal')).toBe('standard mode')
    expect(backendWords('mystery')).toBe('mystery')
  })
})

describe('statusLine', () => {
  it('says what is happening for each phase', () => {
    expect(statusLine({ phase: 'starting' })).toBe('Starting sound…')
    expect(statusLine({ phase: 'off' })).toBe('Sound is off.')
    expect(statusLine({ phase: 'failed', error: 'No sound card.' })).toBe('Sound could not start.')
  })

  it('describes the device, mode, buffer and delay when on', () => {
    expect(
      statusLine({
        phase: 'on',
        result: {
          backend: 'wasapi-exclusive',
          deviceName: 'Headphones (Realtek)',
          sampleRate: 48000,
          bufferFrames: 128,
          outputLatencyMs: 2.66
        }
      })
    ).toBe('Sound is on. Headphones (Realtek), exclusive mode, 128 samples, about 2.7 ms.')
  })

  it('does not claim a delay when it is not known', () => {
    expect(
      statusLine({
        phase: 'on',
        result: {
          backend: 'cpal',
          deviceName: 'Speakers',
          sampleRate: 48000,
          bufferFrames: 256,
          outputLatencyMs: 0
        }
      })
    ).toBe('Sound is on. Speakers, standard mode, 256 samples.')
  })
})

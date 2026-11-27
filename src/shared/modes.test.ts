import { describe, expect, it } from 'vitest'
import { modeLabel, modeWords } from './modes'

describe('modeLabel', () => {
  it('uses the names of the Mode options on the Sound screen', () => {
    expect(modeLabel('wasapi-exclusive')).toBe('Fastest (exclusive)')
    expect(modeLabel('wasapi-shared')).toBe('Shared with other apps')
    expect(modeLabel('asio')).toBe('ASIO driver')
    expect(modeLabel('cpal')).toBe('Standard mode')
  })
})

describe('modeWords', () => {
  it('gives the same names as the Mode options for every mode the engine reports', () => {
    expect(modeWords('wasapi-exclusive')).toBe('Fastest (exclusive)')
    expect(modeWords('wasapi-shared')).toBe('Shared with other apps')
    expect(modeWords('asio')).toBe('ASIO driver')
    expect(modeWords('cpal')).toBe('Standard mode')
  })

  it('says Not running when no sound output is running', () => {
    expect(modeWords('')).toBe('Not running')
  })

  it('passes an unknown mode through unchanged', () => {
    expect(modeWords('mystery')).toBe('mystery')
  })
})

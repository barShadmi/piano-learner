import { describe, expect, it } from 'vitest'
import { screenFor } from './routes'

describe('screenFor', () => {
  it('shows the library for an empty hash, a lone # and #/', () => {
    expect(screenFor('')).toBe('library')
    expect(screenFor('#')).toBe('library')
    expect(screenFor('#/')).toBe('library')
  })

  it('shows not-found for any other hash', () => {
    expect(screenFor('#/nope')).toBe('not-found')
  })
})

describe('screenFor sound', () => {
  it('shows the sound screen for #/sound', () => {
    expect(screenFor('#/sound')).toBe('sound')
  })

  it('does not match look-alikes', () => {
    expect(screenFor('#/sounds')).toBe('not-found')
    expect(screenFor('#/sound/x')).toBe('not-found')
  })
})

describe('screenFor latency', () => {
  it('shows the delay test for #/latency', () => {
    expect(screenFor('#/latency')).toBe('latency')
  })

  it('does not match look-alikes', () => {
    expect(screenFor('#/latency/x')).toBe('not-found')
    expect(screenFor('#/latencies')).toBe('not-found')
  })
})

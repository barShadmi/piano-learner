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

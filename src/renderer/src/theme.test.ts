import { describe, expect, it } from 'vitest'
import { getInitialTheme } from './theme'

describe('getInitialTheme', () => {
  it('uses a stored dark theme over a light system preference', () => {
    expect(getInitialTheme('dark', false)).toBe('dark')
  })

  it('follows the system preference when nothing is stored', () => {
    expect(getInitialTheme(null, true)).toBe('dark')
    expect(getInitialTheme(null, false)).toBe('light')
  })

  it('falls back to the system preference when the stored value is invalid', () => {
    expect(getInitialTheme('purple', true)).toBe('dark')
    expect(getInitialTheme('purple', false)).toBe('light')
  })
})

import { describe, expect, it } from 'vitest'
import { mergeLit } from './lit'

describe('mergeLit', () => {
  it('shows the song hand colours when nothing is pressed', () => {
    const lit = mergeLit(new Set(), new Map([[60, 'right' as const], [48, 'left' as const]]))
    expect(lit.get(60)).toBe('right')
    expect(lit.get(48)).toBe('left')
    expect(lit.size).toBe(2)
  })

  it('lets a key Bar presses win over the song colour', () => {
    const lit = mergeLit(new Set([60]), new Map([[60, 'right' as const], [48, 'left' as const]]))
    expect(lit.get(60)).toBe('pressed')
    expect(lit.get(48)).toBe('left')
  })

  it('shows pressed keys that the song does not use', () => {
    const lit = mergeLit(new Set([72]), new Map())
    expect(lit.get(72)).toBe('pressed')
    expect(lit.size).toBe(1)
  })
})

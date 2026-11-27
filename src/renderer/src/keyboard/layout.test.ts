import { describe, expect, it } from 'vitest'
import { isBlack, keyboardLayout, noteName } from './layout'

describe('keyboardLayout', () => {
  const keys = keyboardLayout()

  it('has 88 keys from A0 (21) to C8 (108)', () => {
    expect(keys).toHaveLength(88)
    expect(keys[0].note).toBe(21)
    expect(keys[87].note).toBe(108)
  })

  it('has 52 white keys and 36 black keys', () => {
    expect(keys.filter((k) => !k.black)).toHaveLength(52)
    expect(keys.filter((k) => k.black)).toHaveLength(36)
  })

  it('puts A0 at x 0 and C8 at x 51, and the white range is 52 wide', () => {
    expect(keys[0].x).toBe(0)
    const c8 = keys.find((k) => k.note === 108)!
    expect(c8.x).toBe(51)
    expect(c8.width).toBe(1)
    const whiteEnd = Math.max(...keys.filter((k) => !k.black).map((k) => k.x + k.width))
    expect(whiteEnd).toBe(52)
  })

  it('gives white keys whole-number x and width 1', () => {
    for (const k of keys.filter((k) => !k.black)) {
      expect(Number.isInteger(k.x)).toBe(true)
      expect(k.width).toBe(1)
    }
  })

  it('gives black keys width 0.6 and keeps them inside the white range', () => {
    for (const k of keys.filter((k) => k.black)) {
      expect(k.width).toBe(0.6)
      expect(k.x).toBeGreaterThanOrEqual(0)
      expect(k.x + k.width).toBeLessThanOrEqual(52)
    }
  })

  it('never overlaps black keys with each other', () => {
    const blacks = keys.filter((k) => k.black).sort((a, b) => a.x - b.x)
    for (let i = 1; i < blacks.length; i++) {
      expect(blacks[i].x).toBeGreaterThanOrEqual(blacks[i - 1].x + blacks[i - 1].width)
    }
  })

  it('centres G♯ on the boundary between its white neighbours', () => {
    // G♯4 = 68. The boundary between G4 and A4 sits at the right edge of G4.
    const gSharp = keys.find((k) => k.note === 68)!
    const g4 = keys.find((k) => k.note === 67)!
    expect(gSharp.x + gSharp.width / 2).toBeCloseTo(g4.x + 1)
  })
})

describe('isBlack', () => {
  it('marks the five black pitch classes', () => {
    expect(isBlack(61)).toBe(true) // C♯4
    expect(isBlack(63)).toBe(true) // D♯4
    expect(isBlack(66)).toBe(true) // F♯4
    expect(isBlack(68)).toBe(true) // G♯4
    expect(isBlack(70)).toBe(true) // A♯4
  })

  it('marks white keys as not black', () => {
    expect(isBlack(60)).toBe(false) // C4
    expect(isBlack(64)).toBe(false) // E4
    expect(isBlack(65)).toBe(false) // F4
  })
})

describe('noteName', () => {
  it('names notes with octave numbers', () => {
    expect(noteName(21)).toBe('A0')
    expect(noteName(60)).toBe('C4')
    expect(noteName(108)).toBe('C8')
  })

  it('uses ♯ for sharps', () => {
    expect(noteName(61)).toBe('C♯4')
  })
})

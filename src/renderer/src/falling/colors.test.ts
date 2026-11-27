import { describe, expect, it } from 'vitest'
import { parseHex, pickTextColour } from './colors'

describe('parseHex', () => {
  it('reads #rrggbb with spaces around it', () => {
    expect(parseHex(' #1d4ed8 ')).toBe(0x1d4ed8)
  })
  it('reads #rgb', () => {
    expect(parseHex('#fff')).toBe(0xffffff)
  })
  it('gives undefined for anything else', () => {
    expect(parseHex('blue')).toBeUndefined()
    expect(parseHex('')).toBeUndefined()
  })
})

describe('pickTextColour', () => {
  const LIGHT = 0xffffff
  const DARK = 0x1c1b19
  it('uses the light colour on the dark blue of the light theme', () => {
    expect(pickTextColour(0x1d4ed8, LIGHT, DARK)).toBe(LIGHT)
  })
  it('uses the dark colour on the light blue of the dark theme', () => {
    expect(pickTextColour(0x6ea8ff, LIGHT, DARK)).toBe(DARK)
  })
  it('uses the dark colour on the light orange of the dark theme', () => {
    expect(pickTextColour(0xff9f5a, LIGHT, DARK)).toBe(DARK)
  })
})

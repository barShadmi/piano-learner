import { describe, expect, it } from 'vitest'
import { chooseLabel, type Mark } from './label'

// A pretend font: every character is 0.5 of the font size wide.
const textWidth = (text: string, size: number): number => text.length * size * 0.5
const text = (m: Mark): string | undefined => (m.kind === 'label' ? m.text : undefined)
const sizes = { md: 16, sm: 12, inset: 4, textWidth }

describe('chooseLabel', () => {
  it('shows hand and finger at the larger size on a wide, tall note', () => {
    expect(chooseLabel('right', 3, 40, 60, sizes)).toEqual({
      kind: 'label',
      text: 'R3',
      size: 16
    })
  })
  it('gives the same finger a different text for each hand', () => {
    expect(text(chooseLabel('right', 3, 40, 60, sizes))).toBe('R3')
    expect(text(chooseLabel('left', 3, 40, 60, sizes))).toBe('L3')
  })
  it('shows only the hand letter when there is no finger', () => {
    expect(text(chooseLabel('left', undefined, 40, 60, sizes))).toBe('L')
  })
  it('drops to the smaller size before it drops the finger', () => {
    // R3 at 16 needs 16 px, at 12 needs 12 px.
    expect(chooseLabel('right', 3, 14, 60, sizes)).toEqual({
      kind: 'label',
      text: 'R3',
      size: 12
    })
  })
  it('drops the finger and keeps the hand letter when R3 does not fit', () => {
    // The letter alone at 16 needs 8 px; R3 at 12 needs 12 px.
    expect(chooseLabel('right', 3, 10, 60, sizes)).toEqual({
      kind: 'label',
      text: 'R',
      size: 16
    })
  })
  it('puts a stripe on the right edge of a right-hand note too narrow for a letter', () => {
    expect(chooseLabel('right', 3, 5, 60, sizes)).toEqual({ kind: 'stripe', side: 'right' })
  })
  it('puts a stripe on the left edge of a left-hand note that is too short, e.g. 13 px tall', () => {
    expect(chooseLabel('left', 3, 40, 13, sizes)).toEqual({ kind: 'stripe', side: 'left' })
  })
  it('never leaves the hand to colour alone, for any hand, finger and note size', () => {
    for (const hand of ['right', 'left'] as const) {
      for (const finger of [undefined, 1, 2, 3, 4, 5] as const) {
        for (let w = 0; w <= 60; w += 3) {
          for (let h = 0; h <= 60; h += 3) {
            const m = chooseLabel(hand, finger, w, h, sizes)
            if (m.kind === 'stripe') expect(m.side).toBe(hand)
            else expect(m.text.startsWith(hand === 'right' ? 'R' : 'L')).toBe(true)
          }
        }
      }
    }
  })
  it('uses the smaller size when the note is too short for the larger one', () => {
    expect(chooseLabel('left', undefined, 40, 17, sizes)).toEqual({
      kind: 'label',
      text: 'L',
      size: 12
    })
  })
})

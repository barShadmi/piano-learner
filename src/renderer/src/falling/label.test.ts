import { describe, expect, it } from 'vitest'
import { chooseLabel } from './label'

// A pretend font: every character is 0.5 of the font size wide.
const textWidth = (text: string, size: number): number => text.length * size * 0.5
const sizes = { md: 16, sm: 12, inset: 4, textWidth }

describe('chooseLabel', () => {
  it('shows hand and finger at the larger size on a wide, tall note', () => {
    expect(chooseLabel('right', 3, 40, 60, sizes)).toEqual({
      text: 'R3',
      size: 16
    })
  })
  it('gives the same finger a different text for each hand', () => {
    expect(chooseLabel('right', 3, 40, 60, sizes)?.text).toBe('R3')
    expect(chooseLabel('left', 3, 40, 60, sizes)?.text).toBe('L3')
  })
  it('shows only the hand letter when there is no finger', () => {
    expect(chooseLabel('left', undefined, 40, 60, sizes)?.text).toBe('L')
  })
  it('drops to the smaller size before it drops the finger', () => {
    // R3 at 16 needs 16 px, at 12 needs 12 px.
    expect(chooseLabel('right', 3, 14, 60, sizes)).toEqual({
      text: 'R3',
      size: 12
    })
  })
  it('drops the finger and keeps the hand letter when R3 does not fit', () => {
    // The letter alone at 16 needs 8 px; R3 at 12 needs 12 px.
    expect(chooseLabel('right', 3, 10, 60, sizes)).toEqual({
      text: 'R',
      size: 16
    })
  })
  it('shows no label when even the letter at the smaller size does not fit', () => {
    expect(chooseLabel('right', 3, 5, 60, sizes)).toBeUndefined()
  })
  it('shows no label when the note is too short for the smaller size and the inset', () => {
    expect(chooseLabel('right', 3, 40, 15, sizes)).toBeUndefined()
  })
  it('uses the smaller size when the note is too short for the larger one', () => {
    expect(chooseLabel('left', undefined, 40, 17, sizes)).toEqual({
      text: 'L',
      size: 12
    })
  })
})

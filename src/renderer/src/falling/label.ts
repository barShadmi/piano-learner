// Picks the text and size of the label on a falling note. Pure TypeScript, so it is unit tested.
// The hand is always in the text (R or L), so the hand is never shown by colour alone.
import type { Finger, Hand } from '../../../shared/song/types'

export type LabelSizes = {
  /** Larger font size in px (the --text-md token). */
  md: number
  /** Smaller font size in px (the --text-sm token). It is the floor. */
  sm: number
  /** Gap from the note's bottom edge in px (the --space-1 token). */
  inset: number
  /** How wide a text is at a font size, in px. */
  textWidth: (text: string, size: number) => number
}

export type Label = { text: string; size: number }

// Built once so choosing a label never makes a new string.
const FULL: Record<Hand, readonly string[]> = {
  right: ['R', 'R1', 'R2', 'R3', 'R4', 'R5'],
  left: ['L', 'L1', 'L2', 'L3', 'L4', 'L5']
}

/**
 * Tries, in order: hand and finger at the larger size, the same at the smaller size,
 * the hand letter alone at the larger size, then at the smaller size. Undefined when none fits.
 */
export function chooseLabel(
  hand: Hand,
  finger: Finger | undefined,
  width: number,
  height: number,
  sizes: LabelSizes
): Label | undefined {
  const letter = FULL[hand][0]
  const full = finger === undefined ? letter : FULL[hand][finger]
  const sizeList = [sizes.md, sizes.sm]
  const texts = full === letter ? [letter] : [full, letter]
  for (const text of texts) {
    for (const size of sizeList) {
      if (size + sizes.inset <= height && sizes.textWidth(text, size) <= width) return { text, size }
    }
  }
  return undefined
}

// Pure layout for the 88-key keyboard. No React here.
// Units: one white key is 1 wide. The 52 white keys span x 0 to 52.

export type KeyLayout = {
  note: number
  black: boolean
  // Left edge, in white-key units.
  x: number
  width: number
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Black pitch classes: C♯ 1, D♯ 3, F♯ 6, G♯ 8, A♯ 10.
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

// Small offsets so black keys sit where a real piano has them.
// Negative moves left, positive moves right.
const BLACK_OFFSET: Record<number, number> = {
  1: -0.1, // C♯
  3: 0.1, // D♯
  6: -0.1, // F♯
  8: 0, // G♯
  10: 0.1 // A♯
}

const BLACK_WIDTH = 0.6

export function isBlack(note: number): boolean {
  return BLACK_PITCH_CLASSES.has(((note % 12) + 12) % 12)
}

export function noteName(note: number): string {
  const name = NAMES[((note % 12) + 12) % 12]
  const octave = Math.floor(note / 12) - 1
  return `${name}${octave}`
}

export function keyboardLayout(first = 21, last = 108): KeyLayout[] {
  const keys: KeyLayout[] = []
  // Number of white keys placed so far. The next white key gets this index.
  let whiteCount = 0
  for (let note = first; note <= last; note++) {
    if (isBlack(note)) {
      // Black keys sit on the boundary between the white key before (index whiteCount - 1)
      // and the white key after (index whiteCount).
      const boundary = whiteCount
      const offset = BLACK_OFFSET[((note % 12) + 12) % 12]
      keys.push({
        note,
        black: true,
        x: boundary - BLACK_WIDTH / 2 + offset,
        width: BLACK_WIDTH
      })
    } else {
      keys.push({ note, black: false, x: whiteCount, width: 1 })
      whiteCount++
    }
  }
  return keys
}

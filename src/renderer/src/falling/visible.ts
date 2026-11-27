// Which notes to draw, and where. Pure TypeScript. No React, no Pixi.

import { keyboardLayout } from '../keyboard/layout'
import type { NoteTiming, TimedNotes } from './songTime'

// Guards the lower search bound against floating-point rounding.
const EPS = 1e-9

// Each key's layout, by MIDI pitch. Built once.
const LAYOUT_BY_PITCH = new Map(keyboardLayout().map((k) => [k.note, k]))

/** First index whose startS is greater than `value` (or the length if none). */
function firstStartAfter(notes: NoteTiming[], value: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[mid].startS > value) hi = mid
    else lo = mid + 1
  }
  return lo
}

/**
 * Index range [from, to) that holds every note visible at nowS, where a note
 * is visible when endS > nowS and startS < nowS + lookaheadS.
 *
 * The range can also hold a few notes that have already ended (their start is
 * recent but they stopped), so callers still check endS > nowS for each note.
 */
export function visibleRange(
  timed: TimedNotes,
  nowS: number,
  lookaheadS: number
): [number, number] {
  const { notes, maxDurationS } = timed
  // A note that started before nowS - maxDurationS has ended by nowS.
  const from = firstStartAfter(notes, nowS - maxDurationS - EPS)
  // A note that starts at or after nowS + lookaheadS is not yet visible.
  const to = lowerBoundStart(notes, nowS + lookaheadS)
  return [from, Math.max(from, to)]
}

// First index whose startS is at least `value` (or the length if none).
function lowerBoundStart(notes: NoteTiming[], value: number): number {
  let lo = 0
  let hi = notes.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (notes[mid].startS < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Notes that are sounding at nowS: startS <= nowS < endS. */
export function soundingNotes(timed: TimedNotes, nowS: number): NoteTiming[] {
  const { notes, maxDurationS } = timed
  const from = firstStartAfter(notes, nowS - maxDurationS - EPS)
  const to = firstStartAfter(notes, nowS)
  const out: NoteTiming[] = []
  for (let i = from; i < to; i++) {
    if (notes[i].endS > nowS) out.push(notes[i])
  }
  return out
}

/**
 * Where a note is drawn, in pixels. The canvas is widthPx wide (the keyboard's
 * 52 white keys) and heightPx tall. The note's bottom edge is at the keyboard
 * (heightPx) when it starts, and the canvas shows lookaheadS seconds.
 */
export function noteRect(
  note: NoteTiming,
  nowS: number,
  lookaheadS: number,
  widthPx: number,
  heightPx: number
): { x: number; y: number; w: number; h: number } {
  const key = LAYOUT_BY_PITCH.get(note.pitch)
  if (!key) throw new RangeError(`pitch ${note.pitch} is not on the 88-key keyboard`)
  const unit = widthPx / 52
  const pixelsPerSecond = heightPx / lookaheadS
  const h = (note.endS - note.startS) * pixelsPerSecond
  const bottom = heightPx - (note.startS - nowS) * pixelsPerSecond
  return {
    x: key.x * unit,
    y: bottom - h,
    w: key.width * unit,
    h
  }
}

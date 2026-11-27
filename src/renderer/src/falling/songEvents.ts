// Turns the timed notes of a song into the note on / note off events the native engine plays.
// Pure TypeScript. No sound happens here.
import { MAX_SONG_EVENTS, MAX_SONG_TIME_MS, type SongEvent } from '../../../shared/audio'
import type { TimedNotes } from './songTime'

/** The velocity of a note that does not say its own. */
export const DEFAULT_VELOCITY = 80

// The lowest and highest key on the piano (A0 and C8).
const LOWEST_KEY = 21
const HIGHEST_KEY = 108

/** The events for a song, and whether the song had to be cut short to fit the engine's limit. */
export interface SongEventPlan {
  events: SongEvent[]
  cut: boolean
}

// One note as it will be played, in whole milliseconds.
interface Piece {
  onMs: number
  offMs: number
  pitch: number
  velocity: number
}

// The notes that will be played, in start order. A key struck again before its earlier note ends
// cuts that earlier note short at the new strike, so the engine never holds one key twice.
function piecesFor(timed: TimedNotes, velocityDefault: number): Piece[] {
  const pieces: Piece[] = []
  for (const n of timed.notes) {
    if (n.startS < 0) continue
    if (n.pitch < LOWEST_KEY || n.pitch > HIGHEST_KEY) continue
    const offMs = Math.round(n.endS * 1000)
    if (offMs > MAX_SONG_TIME_MS) continue
    const velocity = Math.min(127, Math.max(1, Math.round(n.velocity ?? velocityDefault)))
    pieces.push({ onMs: Math.round(n.startS * 1000), offMs, pitch: n.pitch, velocity })
  }
  pieces.sort((a, b) => a.onMs - b.onMs)

  const lastByPitch = new Map<number, Piece>()
  for (const p of pieces) {
    const earlier = lastByPitch.get(p.pitch)
    // Two notes on one key that start together sound as one: the longer one wins.
    if (earlier && earlier.onMs === p.onMs) p.offMs = Math.max(p.offMs, earlier.offMs)
    if (earlier && earlier.offMs > p.onMs) earlier.offMs = p.onMs
    lastByPitch.set(p.pitch, p)
  }
  // A note cut to nothing by the next strike of its key is left out.
  return pieces.filter((p) => p.offMs > p.onMs)
}

/**
 * The events for the whole song, in time order, and whether the song was cut short.
 * Time 0 is the start of the song. A note that starts before 0 (the lead-in) is left out.
 * A note on and its note off always come together, so the list never leaves a note held.
 * At the same moment a note off comes before a note on.
 */
export function songEventsPlan(timed: TimedNotes, velocityDefault: number = DEFAULT_VELOCITY): SongEventPlan {
  let pieces = piecesFor(timed, velocityDefault)
  // Each note is two events. Only whole notes are kept, so the engine's limit is never passed.
  const most = Math.floor(MAX_SONG_EVENTS / 2)
  const cut = pieces.length > most
  if (cut) pieces = pieces.slice(0, most)

  const events: SongEvent[] = []
  for (const p of pieces) {
    events.push({ timeMs: p.onMs, note: p.pitch, velocity: p.velocity, on: true })
    events.push({ timeMs: p.offMs, note: p.pitch, velocity: 0, on: false })
  }
  // Sort by time. At the same time a note off (on: false) comes first, so a key that is struck again is released first.
  events.sort((a, b) => a.timeMs - b.timeMs || Number(a.on) - Number(b.on))
  return { events, cut }
}

// Which keys are down, and whether the pedal is down. Pure logic, no React.
import type { MidiEvent } from '../../../shared/audio'
import { noteName } from './layout'

export type KeysState = {
  down: ReadonlySet<number>
  pedal: boolean
}

const FIRST = 21 // A0
const LAST = 108 // C8

// Applies a batch of events. Returns the same object when nothing changed.
export function applyEvents(state: KeysState, events: readonly MidiEvent[]): KeysState {
  // Always work on a copy of the set. If nothing ends up changed, the old set and state are returned instead.
  const next = new Set(state.down)
  let pedal = state.pedal

  for (const ev of events) {
    if (ev.kind === 'sustain') {
      pedal = ev.down === true
    } else if (ev.kind === 'allOff') {
      next.clear()
    } else if (ev.note < FIRST || ev.note > LAST) {
      continue
    } else if (ev.kind === 'on') {
      next.add(ev.note)
    } else if (ev.kind === 'off') {
      next.delete(ev.note)
    }
  }

  const downSame = sameSet(next, state.down)
  if (downSame && pedal === state.pedal) return state
  return { down: downSame ? state.down : next, pedal }
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

// "Keys down: C4, E4, G4" in pitch order, or "No keys down."
export function keysDownLine(state: KeysState): string {
  if (state.down.size === 0) return 'No keys down.'
  const notes = [...state.down].sort((a, b) => a - b).map(noteName)
  return `Keys down: ${notes.join(', ')}`
}

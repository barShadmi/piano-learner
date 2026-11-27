// Tracks which song notes are sounding, so the keyboard only redraws when that set changes.
// update() is safe to call every frame: once its arrays are big enough it does not allocate.
import type { Hand } from '../../../shared/song/types'
import type { NoteTiming, TimedNotes } from './songTime'
import { startedBy, visibleFrom } from './visible'

export class SoundingTracker {
  private current: NoteTiming[] = []
  private next: NoteTiming[] = []

  constructor(private readonly timed: TimedNotes) {}

  /** Looks at time nowS. Returns true when the set of sounding notes is not the same as last time. */
  update(nowS: number): boolean {
    const { notes } = this.timed
    const to = startedBy(this.timed, nowS)
    const next = this.next
    next.length = 0
    for (let i = visibleFrom(this.timed, nowS); i < to; i++) {
      const n = notes[i]
      if (n.endS > nowS && n.pitch >= 21 && n.pitch <= 108) next.push(n)
    }
    const cur = this.current
    let same = cur.length === next.length
    for (let i = 0; same && i < next.length; i++) if (cur[i] !== next[i]) same = false
    this.current = next
    this.next = cur
    return !same
  }

  /** The sounding pitches and their hands as of the last update. Allocates: call it only after a change. */
  byPitch(): Map<number, Hand> {
    const map = new Map<number, Hand>()
    for (const n of this.current) {
      // If two notes share a pitch, the first one wins.
      if (!map.has(n.pitch)) map.set(n.pitch, n.hand)
    }
    return map
  }
}

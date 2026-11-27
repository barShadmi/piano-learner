// Song time: converts beats (the song's own time) into seconds (real time).
// Pure TypeScript. No React, no Pixi.

import type { Finger, Hand, Song, TempoChange } from '../../../shared/song/types'

/** A note with its start and end in seconds. */
export interface NoteTiming {
  id: string
  pitch: number
  hand: Hand
  finger?: Finger
  /** 1..127, when the note has one. */
  velocity?: number
  startS: number
  endS: number
}

/** Notes sorted by start time, plus the longest note length in seconds. */
export interface TimedNotes {
  notes: NoteTiming[]
  maxDurationS: number
}

const DEFAULT_BPM = 120

interface Segment {
  /** Start of this tempo, in beats. */
  start: number
  bpm: number
}

// Sort the tempos, and make sure there is one that starts at beat 0.
function normaliseTempos(tempos: TempoChange[]): Segment[] {
  if (tempos.length === 0) return [{ start: 0, bpm: DEFAULT_BPM }]
  const sorted = tempos.map((t) => ({ start: t.start, bpm: t.bpm })).sort((a, b) => a.start - b.start)
  if (sorted[0].start > 0) {
    sorted.unshift({ start: 0, bpm: sorted[0].bpm })
  }
  return sorted
}

function beatToSecondsIn(segs: Segment[], beat: number): number {
  // Before beat 0 (or at it), use the first tempo.
  if (beat <= 0) return (beat * 60) / segs[0].bpm
  let seconds = 0
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].start
    const to = i + 1 < segs.length ? segs[i + 1].start : Infinity
    const inThisSegment = Math.min(beat, to) - from
    seconds += (inThisSegment * 60) / segs[i].bpm
    if (beat <= to) break
  }
  return seconds
}

function secondsToBeatIn(segs: Segment[], seconds: number): number {
  if (seconds <= 0) return (seconds * segs[0].bpm) / 60
  let segStartSeconds = 0
  for (let i = 0; i < segs.length; i++) {
    const from = segs[i].start
    const to = i + 1 < segs.length ? segs[i + 1].start : Infinity
    const segLengthSeconds = ((to - from) * 60) / segs[i].bpm
    if (seconds <= segStartSeconds + segLengthSeconds) {
      return from + ((seconds - segStartSeconds) * segs[i].bpm) / 60
    }
    segStartSeconds += segLengthSeconds
  }
  // Not reached: the last segment goes to infinity.
  return segs[segs.length - 1].start
}

/** Converts a beat position into seconds, using every tempo change. */
export function beatToSeconds(tempos: TempoChange[], beat: number): number {
  return beatToSecondsIn(normaliseTempos(tempos), beat)
}

/** Converts seconds into a beat position, using every tempo change. */
export function secondsToBeat(tempos: TempoChange[], seconds: number): number {
  return secondsToBeatIn(normaliseTempos(tempos), seconds)
}

/** All notes with their times in seconds, sorted by start time. */
export function songNotesInSeconds(song: Song): TimedNotes {
  const segs = normaliseTempos(song.tempos)
  const notes: NoteTiming[] = song.notes.map((n) => {
    const timing: NoteTiming = {
      id: n.id,
      pitch: n.pitch,
      hand: n.hand,
      startS: beatToSecondsIn(segs, n.start),
      endS: beatToSecondsIn(segs, n.start + n.duration)
    }
    if (n.finger !== undefined) timing.finger = n.finger
    if (n.velocity !== undefined) timing.velocity = n.velocity
    return timing
  })
  notes.sort((a, b) => a.startS - b.startS || a.pitch - b.pitch)
  let maxDurationS = 0
  for (const n of notes) {
    maxDurationS = Math.max(maxDurationS, n.endS - n.startS)
  }
  return { notes, maxDurationS }
}

/** Length of the song in seconds: the end of its last note. 0 for no notes. */
export function songLengthSeconds(song: Song): number {
  const { notes } = songNotesInSeconds(song)
  let end = 0
  for (const n of notes) end = Math.max(end, n.endS)
  return end
}

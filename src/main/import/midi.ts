// MIDI file -> Song. Runs in the main process only.
import { Midi } from '@tonejs/midi'
import type { Hand, Measure, Note, Song, TempoChange, TimeSignature } from '../../shared/song'
import type { ImportResult } from './index'

const LOWEST = 21
const HIGHEST = 108
const MIDDLE_C = 60
const BEAT_UNITS = [1, 2, 4, 8, 16]
// Most MIDI files are short. This stops a broken file making endless measures.
const MAX_MEASURES = 20000

const KEY_NAMES = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']

const NOT_MIDI = 'This file could not be read as MIDI.'
const NO_NOTES = 'This file has no notes.'

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

const round = (x: number): number => Math.round(x * 1e6) / 1e6

interface RawNote {
  pitch: number
  start: number
  duration: number
  velocity: number
  track: number
}

export function parseMidi(bytes: Uint8Array, filePath: string): ImportResult {
  const fileName = baseName(filePath)
  let midi: Midi
  try {
    midi = new Midi(bytes)
  } catch {
    return { ok: false, error: NOT_MIDI }
  }

  try {
    const ppq = midi.header.ppq
    if (!(ppq > 0)) return { ok: false, error: NOT_MIDI }

    // Notes per track (drum tracks and out-of-range notes are left out).
    const tracks: RawNote[][] = []
    midi.tracks.forEach((track) => {
      if (track.instrument.percussion || track.channel === 9) return
      const raw: RawNote[] = []
      for (const note of track.notes) {
        if (note.midi < LOWEST || note.midi > HIGHEST) continue
        if (!(note.durationTicks > 0)) continue
        raw.push({
          pitch: note.midi,
          start: round(note.ticks / ppq),
          duration: round(note.durationTicks / ppq),
          velocity: Math.min(127, Math.max(1, Math.round(note.velocity * 127))),
          track: tracks.length
        })
      }
      if (raw.length > 0) tracks.push(raw)
    })
    if (tracks.length === 0) return { ok: false, error: NO_NOTES }

    // Hands: with two or more tracks, the higher track is right and the next is left.
    const average = (t: RawNote[]): number => t.reduce((s, n) => s + n.pitch, 0) / t.length
    const order = tracks.map((_, i) => i).sort((a, b) => average(tracks[b]) - average(tracks[a]))
    const trackHand = new Map<number, Hand>()
    if (tracks.length >= 2) {
      trackHand.set(order[0], 'right')
      trackHand.set(order[1], 'left')
    }
    const all = tracks.flat().map((n) => ({
      ...n,
      hand: trackHand.get(n.track) ?? (n.pitch >= MIDDLE_C ? 'right' : 'left')
    }))
    all.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    const notes: Note[] = all.map((n, i) => ({
      id: `n${i + 1}`,
      pitch: n.pitch,
      start: n.start,
      duration: n.duration,
      hand: n.hand,
      velocity: n.velocity
    }))
    let songEnd = 0
    for (const n of notes) songEnd = Math.max(songEnd, n.start + n.duration)

    // Tempos: quarter-note bpm, one per start, the first at beat 0.
    const tempoMap = new Map<number, number>()
    for (const t of [...midi.header.tempos].sort((a, b) => a.ticks - b.ticks)) {
      if (Number.isFinite(t.bpm) && t.bpm > 0) {
        tempoMap.set(round(t.ticks / ppq), Math.min(300, Math.max(20, t.bpm)))
      }
    }
    const tempos: TempoChange[] = [...tempoMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([start, bpm]) => ({ start, bpm: Math.round(bpm * 100) / 100 }))
    // MIDI's own default tempo is 120 until the first tempo event.
    if (tempos.length === 0 || tempos[0].start !== 0) tempos.unshift({ start: 0, bpm: 120 })

    // Measures: from the time signature events, else 4/4, to the end of the song.
    const sigs = [...midi.header.timeSignatures]
      .sort((a, b) => a.ticks - b.ticks)
      .map((s) => ({ start: round(s.ticks / ppq), ts: toTimeSignature(s.timeSignature) }))
      .filter((s): s is { start: number; ts: TimeSignature } => s.ts !== undefined)
    const measures: Measure[] = []
    let pos = 0
    while ((pos < songEnd || measures.length === 0) && measures.length < MAX_MEASURES) {
      let ts: TimeSignature = { beats: 4, beatUnit: 4 }
      for (const s of sigs) if (s.start <= pos) ts = s.ts
      measures.push({ index: measures.length, start: round(pos), timeSignature: ts })
      pos += (ts.beats * 4) / ts.beatUnit
    }
    if (measures.length >= MAX_MEASURES) return { ok: false, error: NOT_MIDI }

    const keyIndex = KEY_NAMES.indexOf(midi.header.keySignatures[0]?.key ?? '')
    const keyFifths = keyIndex >= 0 ? keyIndex - 7 : 0

    const title =
      midi.header.name.trim() ||
      midi.tracks.map((t) => t.name.trim()).find((n) => n.length > 0) ||
      withoutExtension(fileName)

    const song: Song = {
      formatVersion: 1,
      id: crypto.randomUUID(),
      title,
      keyFifths,
      measures,
      tempos,
      notes,
      source: { kind: 'midi', fileName }
    }
    return { ok: true, song }
  } catch {
    return { ok: false, error: NOT_MIDI }
  }
}

function toTimeSignature(raw: number[]): TimeSignature | undefined {
  const [beats, unit] = raw
  if (!Number.isInteger(beats) || beats <= 0 || !BEAT_UNITS.includes(unit)) return undefined
  return { beats, beatUnit: unit as TimeSignature['beatUnit'] }
}

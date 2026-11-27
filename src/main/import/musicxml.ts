// MusicXML (.musicxml, .xml, .mxl) -> Song. Runs in the main process only.
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { strFromU8, unzipSync } from 'fflate'
import type { Finger, Hand, Measure, Note, Song, TempoChange, TimeSignature } from '../../shared/song'
import type { ImportResult } from './index'

const LOWEST = 21
const HIGHEST = 108
const MIDDLE_C = 60
const BEAT_UNITS = [1, 2, 4, 8, 16]
const DEFAULT_BPM = 100
// MusicXML "dynamics" is a percentage of this default velocity.
const DEFAULT_VELOCITY = 90
// Stops a broken or hostile file from making huge results.
const MAX_MEASURES = 20000
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024

const NOT_MUSICXML = 'This file could not be read as MusicXML.'
const NO_NOTES = 'This file has no notes.'

type XNode = Record<string, unknown>

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const UNIT_BEATS: Record<string, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  '16th': 0.25,
  '32nd': 0.125
}

// preserveOrder keeps <backup> and <forward> in the right place. Entities are
// never expanded, and DOCTYPE content is not processed.
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  ignoreDeclaration: true,
  ignorePiTags: true,
  processEntities: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true
})

// ---------- small helpers for the order-preserving tree ----------

const tagOf = (n: XNode): string => Object.keys(n).find((k) => k !== ':@') ?? ''
const kids = (n: XNode | undefined): XNode[] => {
  if (!n) return []
  const v = n[tagOf(n)]
  return Array.isArray(v) ? (v as XNode[]) : []
}
const child = (n: XNode | undefined, name: string): XNode | undefined =>
  kids(n).find((k) => tagOf(k) === name)
const childrenNamed = (n: XNode | undefined, name: string): XNode[] =>
  kids(n).filter((k) => tagOf(k) === name)
const path = (n: XNode | undefined, ...names: string[]): XNode | undefined => {
  let cur = n
  for (const name of names) cur = child(cur, name)
  return cur
}
const textOf = (n: XNode | undefined): string | undefined => {
  const t = kids(n).find((k) => '#text' in k)
  return t === undefined ? undefined : String(t['#text']).trim()
}
const attr = (n: XNode, name: string): string | undefined => {
  const a = n[':@'] as Record<string, unknown> | undefined
  const v = a?.['@_' + name]
  return v === undefined ? undefined : String(v)
}
const num = (s: string | undefined): number | undefined => {
  if (s === undefined || s === '') return undefined
  const v = Number(s)
  return Number.isFinite(v) ? v : undefined
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** Decodes the five standard XML entities and numeric references (text is never expanded otherwise). */
function decodeEntities(text: string): string {
  const fromCode = (code: number): string => {
    try {
      return String.fromCodePoint(code)
    } catch {
      return ''
    }
  }
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#([0-9]+);/g, (_, d: string) => fromCode(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

const round = (x: number): number => Math.round(x * 1e6) / 1e6

/** Turns file bytes into text, honouring a UTF-16 byte order mark. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes)
  return new TextDecoder('utf-8').decode(bytes)
}

// ---------- notes ----------

interface RawNote {
  part: number
  staff: number
  pitch: number
  start: number
  end: number
  inFirstMeasure: boolean
  finger?: Finger
  velocity?: number
}

function pitchToMidi(pitch: XNode): number | undefined {
  const step = STEP_SEMITONES[textOf(child(pitch, 'step')) ?? '']
  const octave = num(textOf(child(pitch, 'octave')))
  if (step === undefined || octave === undefined) return undefined
  const alter = Math.round(num(textOf(child(pitch, 'alter'))) ?? 0)
  return (octave + 1) * 12 + step + alter
}

function readFinger(note: XNode): Finger | undefined {
  const text = textOf(path(note, 'notations', 'technical', 'fingering'))
  return text !== undefined && /^[1-5]$/.test(text) ? (Number(text) as Finger) : undefined
}

function readTimeSignature(attributes: XNode): TimeSignature | undefined {
  const time = child(attributes, 'time')
  if (!time) return undefined
  const beatsText = textOf(child(time, 'beats'))
  const unit = num(textOf(child(time, 'beat-type')))
  if (beatsText === undefined || unit === undefined || !BEAT_UNITS.includes(unit)) return undefined
  const parts = beatsText.split('+').map((p) => Number(p.trim()))
  if (parts.some((p) => !Number.isInteger(p) || p <= 0)) return undefined
  return { beats: parts.reduce((a, b) => a + b, 0), beatUnit: unit as TimeSignature['beatUnit'] }
}

function measureLength(ts: TimeSignature): number {
  return (ts.beats * 4) / ts.beatUnit
}

/** Tempo from a <sound> or a <metronome>, in quarter notes per minute. */
function tempoOf(sound: XNode | undefined, metronome: XNode | undefined): number | undefined {
  const fromSound = sound ? num(attr(sound, 'tempo')) : undefined
  if (fromSound !== undefined && fromSound > 0) return fromSound
  if (!metronome) return undefined
  const unit = UNIT_BEATS[textOf(child(metronome, 'beat-unit')) ?? '']
  const perMinute = num(textOf(child(metronome, 'per-minute')))
  if (unit === undefined || perMinute === undefined || perMinute <= 0) return undefined
  const dotted = childrenNamed(metronome, 'beat-unit-dot').length > 0 ? 1.5 : 1
  return perMinute * unit * dotted
}

export function parseMusicXml(xml: string, filePath: string): ImportResult {
  const fileName = baseName(filePath)
  try {
    if (XMLValidator.validate(xml) !== true) return { ok: false, error: NOT_MUSICXML }
    const tree = parser.parse(xml) as XNode[]
    const root = tree.find((n) => tagOf(n) === 'score-partwise')
    if (!root) return { ok: false, error: NOT_MUSICXML }

    const partNodes = childrenNamed(root, 'part')
    if (partNodes.length === 0) return { ok: false, error: NOT_MUSICXML }
    const partMeasures = partNodes.map((p) => childrenNamed(p, 'measure'))
    const measureCount = Math.max(...partMeasures.map((m) => m.length))
    if (measureCount === 0) return { ok: false, error: NO_NOTES }
    if (measureCount > MAX_MEASURES) return { ok: false, error: NOT_MUSICXML }

    // Pass 1: key and time signatures. The first part to say something wins.
    const explicitSigs = new Map<number, TimeSignature>()
    let keyFifths: number | undefined
    for (const measures of partMeasures) {
      measures.forEach((measure, k) => {
        for (const attrs of childrenNamed(measure, 'attributes')) {
          const ts = readTimeSignature(attrs)
          if (ts && !explicitSigs.has(k)) explicitSigs.set(k, ts)
          const fifths = num(textOf(path(attrs, 'key', 'fifths')))
          if (keyFifths === undefined && fifths !== undefined && Number.isInteger(fifths) && Math.abs(fifths) <= 7) {
            keyFifths = fifths
          }
        }
      })
    }
    const measures: Measure[] = []
    let current: TimeSignature = { beats: 4, beatUnit: 4 }
    let at = 0
    for (let k = 0; k < measureCount; k++) {
      current = explicitSigs.get(k) ?? current
      measures.push({ index: k, start: round(at), timeSignature: current })
      at += measureLength(current)
    }
    const measureStart = measures.map((m) => m.start)

    // Pass 2: the notes of each part.
    const raw: RawNote[] = []
    let firstMeasureExtent = 0
    const tempoMap = new Map<number, number>()
    const addTempo = (start: number, bpm: number | undefined): void => {
      const key = round(start)
      if (bpm !== undefined && !tempoMap.has(key)) tempoMap.set(key, Math.min(300, Math.max(20, bpm)))
    }

    partMeasures.forEach((measuresOfPart, partIndex) => {
      let divisions = 1
      let velocity: number | undefined
      const pendingTies = new Map<string, RawNote>()

      const applySound = (sound: XNode | undefined): void => {
        const dyn = sound ? num(attr(sound, 'dynamics')) : undefined
        if (dyn !== undefined && dyn > 0) {
          velocity = Math.min(127, Math.max(1, Math.round((dyn / 100) * DEFAULT_VELOCITY)))
        }
      }

      measuresOfPart.forEach((measure, k) => {
        const base = measureStart[k]
        let cursor = 0
        let lastStart = 0
        for (const item of kids(measure)) {
          if (k === 0) firstMeasureExtent = Math.max(firstMeasureExtent, cursor)
          const tag = tagOf(item)
          if (tag === 'attributes') {
            const d = num(textOf(child(item, 'divisions')))
            if (d !== undefined && d > 0) divisions = d
          } else if (tag === 'sound') {
            addTempo(base + cursor, tempoOf(item, undefined))
            applySound(item)
          } else if (tag === 'direction') {
            const sound = child(item, 'sound')
            const metronome = path(item, 'direction-type', 'metronome')
            addTempo(base + cursor, tempoOf(sound, metronome))
            applySound(sound)
          } else if (tag === 'backup' || tag === 'forward') {
            const d = num(textOf(child(item, 'duration'))) ?? 0
            const move = Math.max(0, d) / divisions
            cursor = Math.max(0, cursor + (tag === 'forward' ? move : -move))
          } else if (tag === 'note') {
            if (child(item, 'grace')) continue
            const durationBeats = Math.max(0, num(textOf(child(item, 'duration'))) ?? 0) / divisions
            const isChord = child(item, 'chord') !== undefined
            const start = isChord ? lastStart : cursor
            if (!isChord) {
              lastStart = cursor
              cursor += durationBeats
            }
            const pitchNode = child(item, 'pitch')
            if (child(item, 'rest') || !pitchNode || child(item, 'cue') || !(durationBeats > 0)) continue
            const midi = pitchToMidi(pitchNode)
            if (midi === undefined) continue

            const staff = Math.max(1, Math.round(num(textOf(child(item, 'staff'))) ?? 1))
            const voice = textOf(child(item, 'voice')) ?? '1'
            const tieTypes = [
              ...childrenNamed(item, 'tie'),
              ...childrenNamed(child(item, 'notations'), 'tied')
            ].map((t) => attr(t, 'type'))
            const tieStop = tieTypes.includes('stop')
            const tieStart = tieTypes.includes('start')
            const tieKey = `${staff}|${voice}|${midi}`
            const absStart = base + start

            const pending = tieStop ? pendingTies.get(tieKey) : undefined
            if (pending) {
              pending.end = absStart + durationBeats
              if (!tieStart) pendingTies.delete(tieKey)
              continue
            }
            const note: RawNote = {
              part: partIndex,
              staff,
              pitch: midi,
              start: absStart,
              end: absStart + durationBeats,
              inFirstMeasure: k === 0,
              finger: readFinger(item),
              velocity
            }
            raw.push(note)
            if (tieStart) pendingTies.set(tieKey, note)
          }
        }
        if (k === 0) firstMeasureExtent = Math.max(firstMeasureExtent, cursor)
      })
    })

    // A short first bar is a pickup: move it so it ends at the bar line, with no silent gap.
    const nominalFirst = measureLength(measures[0].timeSignature)
    const gap = nominalFirst - firstMeasureExtent
    if (firstMeasureExtent > 0 && gap > 1e-9) {
      const firstEnd = nominalFirst
      for (const n of raw) {
        if (!n.inFirstMeasure) continue
        const tiedOut = n.end > firstEnd + 1e-9
        n.start += gap
        if (!tiedOut) n.end += gap
      }
    }

    const inRange = raw.filter((n) => n.pitch >= LOWEST && n.pitch <= HIGHEST)
    if (inRange.length === 0) return { ok: false, error: NO_NOTES }

    // Hands: staff 1 right and staff 2 left; else two parts (one each); else split at middle C.
    const hasTwoStaves = inRange.some((n) => n.staff >= 2)
    const handOf = (n: RawNote): Hand => {
      if (hasTwoStaves) return n.staff === 1 ? 'right' : 'left'
      if (partNodes.length === 2) return n.part === 0 ? 'right' : 'left'
      return n.pitch >= MIDDLE_C ? 'right' : 'left'
    }
    inRange.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
    const notes: Note[] = inRange.map((n, i) => {
      const note: Note = {
        id: `n${i + 1}`,
        pitch: n.pitch,
        start: round(n.start),
        duration: round(n.end - n.start),
        hand: handOf(n)
      }
      if (n.finger !== undefined) {
        note.finger = n.finger
        note.fingerSource = 'printed'
      }
      if (n.velocity !== undefined) note.velocity = n.velocity
      return note
    })

    // A badly written bar can run past its length. Add bars until every note starts inside one.
    let lastNoteStart = 0
    for (const n of notes) lastNoteStart = Math.max(lastNoteStart, n.start)
    let end = measureStart[measureStart.length - 1] + measureLength(measures[measures.length - 1].timeSignature)
    while (end <= lastNoteStart && measures.length < MAX_MEASURES) {
      const ts = measures[measures.length - 1].timeSignature
      measures.push({ index: measures.length, start: round(end), timeSignature: ts })
      end += measureLength(ts)
    }

    const tempos: TempoChange[] = [...tempoMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([start, bpm]) => ({ start, bpm: Math.round(bpm * 100) / 100 }))
    if (tempos.length === 0 || tempos[0].start !== 0) tempos.unshift({ start: 0, bpm: DEFAULT_BPM })

    const rawTitle = textOf(path(root, 'work', 'work-title')) || textOf(child(root, 'movement-title'))
    const title = (rawTitle ? decodeEntities(rawTitle).trim() : '') || withoutExtension(fileName)
    const composer = childrenNamed(path(root, 'identification'), 'creator')
      .filter((c) => attr(c, 'type') === 'composer')
      .map((c) => decodeEntities(textOf(c) ?? '').trim())
      .find((t) => t.length > 0)

    const song: Song = {
      formatVersion: 1,
      id: crypto.randomUUID(),
      title,
      ...(composer ? { composer } : {}),
      keyFifths: keyFifths ?? 0,
      measures,
      tempos,
      notes,
      source: { kind: 'musicxml', fileName }
    }
    return { ok: true, song }
  } catch {
    return { ok: false, error: NOT_MUSICXML }
  }
}

// ---------- .mxl (a zip file) ----------

export function parseMxl(bytes: Uint8Array, filePath: string): ImportResult {
  try {
    // First look at the names only, nothing is unpacked yet.
    const entries: { name: string; originalSize: number }[] = []
    unzipSync(bytes, {
      filter: (f) => {
        entries.push({ name: f.name, originalSize: f.originalSize })
        return false
      }
    })
    const sizeOf = new Map(entries.map((e) => [e.name, e.originalSize]))
    const wanted = (name: string): Uint8Array | undefined => {
      const size = sizeOf.get(name)
      if (size === undefined || size > MAX_UNZIPPED_BYTES) return undefined
      return unzipSync(bytes, { filter: (f) => f.name === name })[name]
    }

    let rootName: string | undefined
    const container = wanted('META-INF/container.xml')
    if (container) {
      const tree = parser.parse(strFromU8(container)) as XNode[]
      const rootfile = path(tree.find((n) => tagOf(n) === 'container'), 'rootfiles', 'rootfile')
      const full = rootfile ? attr(rootfile, 'full-path') : undefined
      if (full && sizeOf.has(full)) rootName = full
    }
    if (rootName === undefined) {
      rootName = entries
        .map((e) => e.name)
        .find((n) => !n.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(n))
    }
    const data = rootName === undefined ? undefined : wanted(rootName)
    if (!data) return { ok: false, error: NOT_MUSICXML }
    return parseMusicXml(decodeText(data), filePath)
  } catch {
    return { ok: false, error: NOT_MUSICXML }
  }
}

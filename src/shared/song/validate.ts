import type { Song } from './types'

export type ValidationResult = { ok: true; song: Song } | { ok: false; errors: string[] }

type Obj = Record<string, unknown>

const HANDS = ['left', 'right']
const BEAT_UNITS = [1, 2, 4, 8, 16]
const SOURCE_KINDS = ['sheet', 'midi', 'musicxml', 'video']
const FINGER_SOURCES = ['printed', 'auto', 'user']
const LEVELS = ['melody', 'melody-bass', 'full']

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isWhole(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

function isText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * Checks a value against the song format. Collects every error (it does not
 * stop at the first one). Each error starts with the path, e.g.
 * `notes[3].pitch: must be 21..108`.
 */
export function validateSong(value: unknown): ValidationResult {
  if (!isObj(value)) {
    return { ok: false, errors: ['song: must be an object'] }
  }

  const errors: string[] = []
  const fail = (path: string, message: string): void => {
    errors.push(`${path}: ${message}`)
  }

  if (value.formatVersion !== 1) fail('formatVersion', 'must be 1')
  if (!isText(value.id)) fail('id', 'must not be empty')
  if (!isText(value.title)) fail('title', 'must not be empty')
  if (value.composer !== undefined && !isText(value.composer)) {
    fail('composer', 'must not be empty')
  }
  if (value.level !== undefined && (typeof value.level !== 'string' || !LEVELS.includes(value.level))) {
    fail('level', 'must be melody, melody-bass or full')
  }

  const keyFifths = value.keyFifths
  if (!isWhole(keyFifths) || keyFifths < -7 || keyFifths > 7) {
    fail('keyFifths', 'must be an integer -7..7')
  }

  const source = value.source
  if (!isObj(source) || typeof source.kind !== 'string' || !SOURCE_KINDS.includes(source.kind)) {
    fail('source.kind', 'must be sheet, midi, musicxml or video')
  } else if (source.kind === 'video') {
    if (!isText(source.url) && !isText(source.fileName)) {
      fail('source', 'video needs a non-empty url or fileName')
    }
  } else if (!isText(source.fileName)) {
    fail('source.fileName', 'must not be empty')
  }

  // Measures. Each measure must start where the previous one ends. The last
  // measure's end sets the length of the song.
  let lastEnd: number | undefined
  const measures = value.measures
  if (!Array.isArray(measures) || measures.length === 0) {
    fail('measures', 'must have at least one measure')
  } else {
    // End of the previous measure, when it is known (valid start and time signature).
    let previousEnd: number | undefined
    for (let i = 0; i < measures.length; i++) {
      const m: unknown = measures[i]
      const path = `measures[${i}]`
      if (!isObj(m)) {
        fail(path, 'must be an object')
        previousEnd = undefined
        lastEnd = undefined
        continue
      }
      if (m.index !== i) fail(`${path}.index`, `must be ${i}`)

      const start = m.start
      if (!isNum(start)) {
        fail(`${path}.start`, 'must be a number')
      } else if (i === 0 && start !== 0) {
        fail(`${path}.start`, 'must be 0')
      } else if (previousEnd !== undefined && start !== previousEnd) {
        fail(`${path}.start`, `must start where measure ${i - 1} ends (beat ${previousEnd})`)
      }

      const ts = m.timeSignature
      let beats: number | undefined
      let beatUnit: number | undefined
      if (isObj(ts)) {
        beats = isWhole(ts.beats) && ts.beats > 0 ? ts.beats : undefined
        beatUnit = BEAT_UNITS.find((u) => u === ts.beatUnit)
      }
      if (beats === undefined) fail(`${path}.timeSignature.beats`, 'must be a whole number above 0')
      if (beatUnit === undefined) fail(`${path}.timeSignature.beatUnit`, 'must be 1, 2, 4, 8 or 16')

      lastEnd =
        isNum(start) && beats !== undefined && beatUnit !== undefined
          ? start + (beats * 4) / beatUnit
          : undefined
      previousEnd = lastEnd
    }
  }

  // Tempos: every one needs a valid start and bpm, and starts must strictly increase.
  const tempos = value.tempos
  if (!Array.isArray(tempos) || tempos.length === 0) {
    fail('tempos', 'must have at least one tempo')
  } else {
    let previousStart: number | undefined
    for (let i = 0; i < tempos.length; i++) {
      const t: unknown = tempos[i]
      const path = `tempos[${i}]`
      if (!isObj(t)) {
        fail(path, 'must be an object')
        previousStart = undefined
        continue
      }
      const start = t.start
      if (!isNum(start) || start < 0) {
        fail(`${path}.start`, 'must be 0 or more')
      } else if (i === 0 && start !== 0) {
        fail(`${path}.start`, 'must be 0')
      } else if (previousStart !== undefined && start <= previousStart) {
        fail(`${path}.start`, 'must be after the previous tempo')
      }
      previousStart = isNum(start) ? start : undefined

      const bpm = t.bpm
      if (!isNum(bpm) || bpm < 20 || bpm > 300) fail(`${path}.bpm`, 'must be 20..300')
    }
  }

  // Notes.
  const notes = value.notes
  if (!Array.isArray(notes)) {
    fail('notes', 'must be an array')
  } else {
    const seenIds = new Set<string>()
    for (let i = 0; i < notes.length; i++) {
      const n: unknown = notes[i]
      const path = `notes[${i}]`
      if (!isObj(n)) {
        fail(path, 'must be an object')
        continue
      }

      if (!isText(n.id)) {
        fail(`${path}.id`, 'must not be empty')
      } else if (seenIds.has(n.id)) {
        fail(`${path}.id`, 'must be unique')
      } else {
        seenIds.add(n.id)
      }

      if (!isWhole(n.pitch) || n.pitch < 21 || n.pitch > 108) {
        fail(`${path}.pitch`, 'must be 21..108')
      }

      const start = n.start
      if (!isNum(start) || start < 0) fail(`${path}.start`, 'must be 0 or more')
      if (isNum(start) && lastEnd !== undefined && start >= lastEnd) {
        fail(`${path}.start`, 'must be before the end of the last measure')
      }

      if (!isNum(n.duration) || n.duration <= 0) fail(`${path}.duration`, 'must be greater than 0')

      if (typeof n.hand !== 'string' || !HANDS.includes(n.hand)) {
        fail(`${path}.hand`, "must be 'left' or 'right'")
      }

      if (n.finger !== undefined && (!isWhole(n.finger) || n.finger < 1 || n.finger > 5)) {
        fail(`${path}.finger`, 'must be 1..5')
      }

      if (
        n.fingerSource !== undefined &&
        (typeof n.fingerSource !== 'string' || !FINGER_SOURCES.includes(n.fingerSource))
      ) {
        fail(`${path}.fingerSource`, 'must be printed, auto or user')
      }

      if (n.velocity !== undefined && (!isWhole(n.velocity) || n.velocity < 1 || n.velocity > 127)) {
        fail(`${path}.velocity`, 'must be 1..127')
      }

      if (
        n.confidence !== undefined &&
        (!isNum(n.confidence) || n.confidence < 0 || n.confidence > 1)
      ) {
        fail(`${path}.confidence`, 'must be 0..1')
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, song: value as unknown as Song }
}

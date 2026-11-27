import type { Backend, StartConfig, ToneArgs } from '../shared/audio'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const backends: readonly string[] = ['wasapi-exclusive', 'wasapi-shared', 'asio', 'cpal']

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  const proto = Object.getPrototypeOf(input)
  return proto === Object.prototype || proto === null
}

function isNumberIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

// The screen sends this when it asks the sound engine to open. Anything odd is refused
// here, in the main process, before it can reach the engine.
export function parseStartConfig(input: unknown): Parsed<StartConfig> {
  if (input === undefined || input === null) return { ok: true, value: {} }
  if (!isPlainObject(input)) return { ok: false, error: 'The sound settings were not valid.' }

  const value: StartConfig = {}
  for (const [key, field] of Object.entries(input)) {
    if (field === undefined) continue
    if (key === 'deviceId') {
      if (typeof field !== 'string' || field.length === 0 || field.length > 1024) {
        return { ok: false, error: 'The sound device name was not valid.' }
      }
      value.deviceId = field
    } else if (key === 'backend') {
      if (typeof field !== 'string' || !backends.includes(field)) {
        return { ok: false, error: 'That way of playing sound is not known.' }
      }
      value.backend = field as Backend
    } else if (key === 'bufferFrames') {
      if (!isNumberIn(field, 16, 8192) || !Number.isInteger(field)) {
        return { ok: false, error: 'The buffer size must be a whole number from 16 to 8192.' }
      }
      value.bufferFrames = field
    } else {
      return { ok: false, error: 'The sound settings had something unexpected in them.' }
    }
  }
  return { ok: true, value }
}

// Arguments for the test sound: pitch in Hz and length in seconds.
export function parseToneArgs(input: unknown): Parsed<ToneArgs> {
  if (input === undefined || input === null) return { ok: true, value: {} }
  if (!isPlainObject(input)) return { ok: false, error: 'The test sound settings were not valid.' }

  const value: ToneArgs = {}
  for (const [key, field] of Object.entries(input)) {
    if (field === undefined) continue
    if (key === 'frequencyHz') {
      if (!isNumberIn(field, 20, 8000)) {
        return { ok: false, error: 'The pitch must be between 20 and 8000 Hz.' }
      }
      value.frequencyHz = field
    } else if (key === 'seconds') {
      if (!isNumberIn(field, 0.1, 5)) {
        return { ok: false, error: 'The test sound must last between 0.1 and 5 seconds.' }
      }
      value.seconds = field
    } else {
      return { ok: false, error: 'The test sound settings had something unexpected in them.' }
    }
  }
  return { ok: true, value }
}

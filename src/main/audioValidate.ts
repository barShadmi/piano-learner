import { MAX_SONG_EVENTS, MAX_SONG_TIME_MS, type Backend, type SongEvent, type SongPlayArgs, type StartConfig, type ToneArgs } from '../shared/audio'

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

// The volume from the slider: a number from 0 to 1.
export function parseVolume(input: unknown): Parsed<number> {
  if (!isNumberIn(input, 0, 1)) return { ok: false, error: 'The volume must be a number from 0 to 1.' }
  return { ok: true, value: input }
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

// A song for the engine to play: its events and where to start. The engine checks again, but a
// bad request is refused here, in the main process, before it reaches the engine.
export function parseSongPlay(input: unknown): Parsed<SongPlayArgs> {
  if (!isPlainObject(input)) return { ok: false, error: 'The song was not valid.' }
  for (const key of Object.keys(input)) {
    if (key !== 'events' && key !== 'fromMs') return { ok: false, error: 'The song had something unexpected in it.' }
  }
  const { events, fromMs = 0 } = input
  if (!isNumberIn(fromMs, 0, MAX_SONG_TIME_MS)) {
    return { ok: false, error: 'The song start time must be 0 or more milliseconds (one day at most).' }
  }
  if (!Array.isArray(events)) return { ok: false, error: 'The song needs a list of notes.' }
  if (events.length > MAX_SONG_EVENTS) {
    return { ok: false, error: `A song can have at most ${MAX_SONG_EVENTS} events.` }
  }
  const checked: SongEvent[] = []
  for (const raw of events as unknown[]) {
    if (!isPlainObject(raw) || Object.keys(raw).length !== 4) {
      return { ok: false, error: 'Every song event needs a time, a note, a velocity and on or off.' }
    }
    const { timeMs, note, velocity, on } = raw
    if (!isNumberIn(timeMs, 0, MAX_SONG_TIME_MS)) {
      return { ok: false, error: 'Every song event needs a time of 0 or more milliseconds (one day at most).' }
    }
    if (!isNumberIn(note, 21, 108) || !Number.isInteger(note)) {
      return { ok: false, error: 'Every song note must be a whole piano key number, 21 to 108.' }
    }
    if (typeof on !== 'boolean') return { ok: false, error: 'Every song event must say if the note goes on or off.' }
    if (!isNumberIn(velocity, on ? 1 : 0, 127) || !Number.isInteger(velocity)) {
      return { ok: false, error: 'Every song velocity must be a whole number, 1 to 127 (0 is allowed for a note off).' }
    }
    checked.push({ timeMs, note, velocity, on })
  }
  return { ok: true, value: { events: checked, fromMs } }
}

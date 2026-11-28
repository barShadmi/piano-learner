// Shapes that the main process, the preload and the screens agree on for sound.
// They only describe data. No sound code lives here.

export type Backend = 'wasapi-exclusive' | 'wasapi-shared' | 'asio' | 'cpal'

export type StartConfig = {
  deviceId?: string
  backend?: Backend
  bufferFrames?: number
}

export type ToneArgs = {
  frequencyHz?: number
  seconds?: number
}

export type StartResult = {
  backend: string
  deviceName: string
  sampleRate: number
  // "16-bit", "24-bit", "32-bit" or "32-bit float"; missing or empty when not known.
  sampleFormat?: string
  bufferFrames: number
  outputLatencyMs: number
  fallbackReason?: string
}

export type OutputDevice = {
  id: string
  name: string
  isDefault: boolean
  backend: string
}

export type EngineStatus = {
  running: boolean
  failed: boolean
  backend?: string
  sampleRate: number
  bufferFrames: number
  callbacks: number
  underruns: number
  measuredLatencyMs: number
}

// Whether the sampled piano sound has loaded. Until it has (or if it cannot), a simple tone plays.
export type PianoSound = 'loading' | 'ready' | 'failed'

// What the Sound screen is told. `error` and `pianoError` are plain English for Bar.
export type AudioState = {
  phase: 'starting' | 'on' | 'off' | 'failed'
  result?: StartResult
  error?: string
  piano: PianoSound
  pianoError?: string
  // Set when the saved sound output was not found and the default output is used. Plain English.
  settingsNote?: string
}

export type ListOutputsReply = { ok: true; outputs: OutputDevice[] } | { ok: false; error: string }
export type TestToneReply = { ok: true } | { ok: false; error: string }
export type VolumeReply = { ok: true } | { ok: false; error: string }
export type StatusReply = { ok: true; status: EngineStatus } | { ok: false; error: string }

// Piano (MIDI) shapes. They mirror what the native engine reports.
// One key event. `down` is only set for a sustain event.
export type MidiEvent = {
  kind: 'on' | 'off' | 'sustain' | 'allOff'
  note: number
  velocity: number
  down?: boolean
  timeUs: number
}

export type MidiStatus = {
  connected: boolean
  portName?: string
  error?: string
  events: number
  droppedSound: number
  droppedScreen: number
  // Whether the piano's own speakers are off: 'off' (we switched Local Control off),
  // 'on', or 'unknown' (not connected, or no output port).
  localControl: 'off' | 'on' | 'unknown'
}

export type MidiStatusReply = { ok: true; status: MidiStatus } | { ok: false; error: string }
export type MidiReconnectReply = { ok: true } | { ok: false; error: string }

// Listen mode: the native engine plays the song, so the sound never goes through the screen.
// One note going on or off, `timeMs` into the song.
export type SongEvent = {
  timeMs: number
  note: number
  velocity: number
  on: boolean
}

export type SongPlayArgs = {
  events: SongEvent[]
  fromMs: number
}

// The most events one song may have (the engine refuses more).
export const MAX_SONG_EVENTS = 200_000
// The longest time a song may name: one day, in milliseconds.
export const MAX_SONG_TIME_MS = 86_400_000

export type SongReply = { ok: true } | { ok: false; error: string }
// `positionMs` is null when no song is playing.
export type SongPositionReply = { ok: true; positionMs: number | null } | { ok: false; error: string }

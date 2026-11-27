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

// What the Sound screen is told. `error` is plain English for Bar.
export type AudioState = {
  phase: 'starting' | 'on' | 'off' | 'failed'
  result?: StartResult
  error?: string
}

export type ListOutputsReply = { ok: true; outputs: OutputDevice[] } | { ok: false; error: string }
export type TestToneReply = { ok: true } | { ok: false; error: string }
export type StatusReply = { ok: true; status: EngineStatus } | { ok: false; error: string }

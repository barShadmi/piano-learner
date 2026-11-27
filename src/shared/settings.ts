// The sound settings Bar chooses, and the rules that keep them valid.
// It only describes data and checks it. It never reads or writes files.
import type { AudioState, Backend, StartConfig } from './audio'

export type SoundSettings = {
  // The output Bar picked. Missing means the Windows default output (his headphones).
  deviceId?: string
  backend: Backend
  bufferFrames: 64 | 128 | 256 | 512
  // 0 to 1.
  volume: number
  // True lets the piano's own speakers play too (Local Control on).
  pianoSpeakers: boolean
}

// What the main process answers for settings:set.
export type SettingsSetReply = { ok: true; settings: SoundSettings; state: AudioState } | { ok: false; error: string }

const backends: readonly Backend[] = ['wasapi-exclusive', 'wasapi-shared', 'asio', 'cpal']
const bufferChoices: readonly number[] = [64, 128, 256, 512]
const maxDeviceIdLength = 1024
const defaultVolume = 0.8

// The starting values: Windows uses the fastest exclusive mode; other systems use cpal.
export function defaultSettings(platform: string): SoundSettings {
  return {
    backend: platform === 'win32' ? 'wasapi-exclusive' : 'cpal',
    bufferFrames: 128,
    volume: defaultVolume,
    pianoSpeakers: false
  }
}

function isPlainObject(input: unknown): input is Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false
  const proto = Object.getPrototypeOf(input)
  return proto === Object.prototype || proto === null
}

// For input from the screen: refuses anything that is not a plain object, otherwise returns the valid set.
export function checkSettings(input: unknown, platform: string): { ok: true; value: SoundSettings } | { ok: false; error: string } {
  if (!isPlainObject(input)) return { ok: false, error: 'Those settings are not valid.' }
  return { ok: true, value: parseSettings(input, platform) }
}

// Always returns a valid set. Anything missing or wrong becomes its default, and unknown keys are ignored.
export function parseSettings(input: unknown, platform: string): SoundSettings {
  const fallback = defaultSettings(platform)
  if (!isPlainObject(input)) return fallback

  const result: SoundSettings = {
    backend: backends.includes(input['backend'] as Backend) ? (input['backend'] as Backend) : fallback.backend,
    bufferFrames: bufferChoices.includes(input['bufferFrames'] as number)
      ? (input['bufferFrames'] as SoundSettings['bufferFrames'])
      : fallback.bufferFrames,
    volume: parseVolume(input['volume'], fallback.volume),
    pianoSpeakers: typeof input['pianoSpeakers'] === 'boolean' ? input['pianoSpeakers'] : fallback.pianoSpeakers
  }
  const device = input['deviceId']
  if (typeof device === 'string' && device.length > 0 && device.length <= maxDeviceIdLength) {
    result.deviceId = device
  }
  return result
}

function parseVolume(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

// The part of the settings the sound engine starts with: output, mode and buffer.
// The device is left out entirely when none is chosen.
export function startConfigFor(settings: SoundSettings): StartConfig {
  const config: StartConfig = { backend: settings.backend, bufferFrames: settings.bufferFrames }
  if (settings.deviceId !== undefined) config.deviceId = settings.deviceId
  return config
}

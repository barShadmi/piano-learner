import type { AudioState, Backend, MidiEvent, MidiStatusReply, OutputDevice, PianoSound } from '../../../shared/audio'

// The way sound is played, in words a beginner can read.
export function backendWords(backend: string): string {
  switch (backend) {
    case 'wasapi-exclusive':
      return 'exclusive mode'
    case 'wasapi-shared':
      return 'shared mode'
    case 'asio':
      return 'ASIO'
    case 'cpal':
      return 'standard mode'
    default:
      return backend
  }
}

// One short sentence about the sound, for the top of the Sound screen.
export function statusLine(state: AudioState): string {
  switch (state.phase) {
    case 'starting':
      return 'Starting sound…'
    case 'off':
      return 'Sound is off.'
    case 'failed':
      return 'Sound could not start.'
    case 'on': {
      const r = state.result
      if (!r) return 'Sound is on.'
      const parts = [r.deviceName, backendWords(r.backend), `${r.bufferFrames} samples`]
      if (r.outputLatencyMs > 0) parts.push(`about ${r.outputLatencyMs.toFixed(1)} ms`)
      return `Sound is on. ${parts.join(', ')}.`
    }
  }
}

const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

// The line under a sound that fell back to another mode. It names the mode the sound uses now.
export function fallbackLine(backend: string): string {
  if (backend === 'wasapi-shared') {
    return 'Exclusive mode is busy, so the app is using shared mode. Close other apps that use sound and press Try again.'
  }
  return `Exclusive mode did not work, so the app is using ${backendWords(backend)}. Close other apps that use sound and press Try again.`
}

// The name of a key, like C4 for middle C (MIDI 60). Anything that is not a MIDI note gives '?'.
export function noteName(note: number): string {
  if (!Number.isInteger(note) || note < 0 || note > 127) return '?'
  const octave = Math.floor(note / 12) - 1
  return `${noteNames[note % 12]}${octave}`
}

// The piano line for the Sound screen. `undefined` means the first answer has not come yet.
export function pianoLine(reply: MidiStatusReply | undefined): string {
  if (!reply) return 'Looking for the piano…'
  if (!reply.ok) return 'The piano could not be checked.'
  if (reply.status.connected) return `Piano connected: ${reply.status.portName ?? 'piano'}`
  return 'No piano found.'
}

// The help under the headline when no piano is found. Nothing when there is nothing to fix.
export function pianoHelp(reply: MidiStatusReply | undefined): string | undefined {
  if (!reply || !reply.ok || reply.status.connected) return undefined
  return 'Check that the piano is on and the USB cable is plugged in.'
}

// The reason the piano could not be opened, if there is one, for the screen to show.
export function pianoProblem(reply: MidiStatusReply | undefined): string | undefined {
  if (!reply) return undefined
  if (!reply.ok) return reply.error
  return reply.status.error
}

// The last key pressed down in a batch (key releases are skipped), if any.
export function latestKeyDown(events: readonly MidiEvent[]): MidiEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === 'on') return events[i]
  }
  return undefined
}

// The line about the last key played. Empty before any key.
export function lastKeyLine(event: MidiEvent | undefined): string {
  if (!event) return ''
  return `Last key: ${noteName(event.note)}, loudness ${event.velocity} of 127`
}

// The line about the sampled piano sound. Without it a simple tone plays.
export function pianoSoundLine(piano: PianoSound): string {
  switch (piano) {
    case 'loading':
      return 'Piano sound is loading…'
    case 'ready':
      return 'Piano sound is ready.'
    case 'failed':
      return 'Piano sound could not load. You hear a simple tone instead.'
  }
}

// The thanks the sample licence asks for.
export const PIANO_SOUND_CREDIT = 'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0).'

// The line under the piano status, shown only while the piano is connected.
// 'on' shows nothing: Bar chose to let the piano's speakers play too.
export function localControlLine(reply: MidiStatusReply | undefined): string | undefined {
  if (!reply || !reply.ok || !reply.status.connected) return undefined
  switch (reply.status.localControl) {
    case 'off':
      return "The piano's own speakers are off, so you hear the PC."
    case 'unknown':
      return "The piano's own speakers may still be on."
    default:
      return undefined
  }
}

// The tip for when the sound is heard twice (the piano's speakers are still on).
export const LOCAL_CONTROL_TIP =
  'If you hear the sound twice, hold METRONOME and RHYTHM on the piano and press the C5 key.'

// The name of a sound mode in the Mode list, in plain words.
export function modeLabel(backend: Backend): string {
  switch (backend) {
    case 'wasapi-exclusive':
      return 'Fastest (exclusive)'
    case 'wasapi-shared':
      return 'Shared with other apps'
    case 'asio':
      return 'ASIO driver'
    case 'cpal':
      return 'Standard mode'
  }
}

// The modes to offer, in a fixed order: only those the outputs list has, plus the saved one.
const modeOrder: readonly Backend[] = ['wasapi-exclusive', 'wasapi-shared', 'asio', 'cpal']

export function modeChoices(outputs: readonly OutputDevice[], current: Backend): Backend[] {
  const listed = new Set<string>(outputs.map((output) => output.backend))
  return modeOrder.filter((backend) => listed.has(backend) || backend === current)
}

// The hint under the Buffer field, in plain words.
export const BUFFER_HINT = 'Smaller is faster. If you hear crackles, pick a bigger one.'

// The buffer size with its time, at 48000 Hz (samples divided by 48 gives milliseconds).
export function bufferLabel(frames: number): string {
  const ms = frames / 48
  return `${frames} samples, about ${ms.toFixed(1)} ms`
}

// The device name in the Output list. A headphone device is marked, so Bar can find his headphones.
export function outputLabel(name: string): string {
  return /headphone/i.test(name) ? `${name} (headphones)` : name
}

// The two WASAPI modes share one list of devices, so they count as one family.
export function outputFamily(backend: string): string {
  return backend.startsWith('wasapi') ? 'wasapi' : backend
}

// The Output list for a mode: the Windows default first, then each device of that mode once.
// A saved device that is not listed is kept as its own choice, so the screen does not hide it.
export function outputChoices(
  outputs: readonly OutputDevice[],
  backend: Backend,
  savedId?: string
): { value: string; label: string }[] {
  const seen = new Set<string>()
  const choices = [{ value: '', label: 'Windows default output' }]
  for (const output of outputs) {
    if (outputFamily(output.backend) !== outputFamily(backend) || seen.has(output.id)) continue
    seen.add(output.id)
    choices.push({ value: output.id, label: outputLabel(output.name) })
  }
  if (savedId !== undefined && !seen.has(savedId)) {
    choices.push({ value: savedId, label: 'Saved output (not connected)' })
  }
  return choices
}

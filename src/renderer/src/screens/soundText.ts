import type { AudioState, MidiEvent, MidiStatusReply, PianoSound } from '../../../shared/audio'

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
  return 'No piano found. Check that the piano is on and the USB cable is plugged in.'
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

import type { AudioState } from '../../../shared/audio'

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

import type { Backend } from './audio'

// The name of each way of playing sound. These are the words of the Mode list on the Sound
// screen. The Sound screen, the delay test and the reports all use these names, so they agree.
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

const backends: readonly string[] = ['wasapi-exclusive', 'wasapi-shared', 'asio', 'cpal']

// The same name for any mode string the engine reports. '' means no sound output is running.
// An unknown mode is shown as it is.
export function modeWords(backend: string): string {
  if (backend === '') return 'Not running'
  if (backends.includes(backend)) return modeLabel(backend as Backend)
  return backend
}

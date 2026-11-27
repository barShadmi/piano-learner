import { isSongId } from '../../shared/songs'

// The screens the app knows about. Anything else is 'not-found'.
export type Screen = 'library' | 'sound' | 'latency' | 'play' | 'not-found'

// An empty hash, a lone '#' or '#/' is the start page (the library).
// '#/play' is the Play screen with the sample song; '#/play/<song id>' plays a song from the library.
export function screenFor(hash: string): Screen {
  if (hash === '' || hash === '#' || hash === '#/') return 'library'
  if (hash === '#/sound') return 'sound'
  if (hash === '#/latency') return 'latency'
  if (hash === '#/play') return 'play'
  if (songIdFor(hash) !== undefined) return 'play'
  return 'not-found'
}

// The name shown in the window title for each screen.
const SCREEN_NAMES: Record<Screen, string> = {
  library: 'Your songs',
  sound: 'Sound',
  latency: 'Delay test',
  play: 'Play',
  'not-found': 'Screen not found'
}

// The text for document.title, e.g. "Sound · PianoLearner".
export function documentTitle(screen: Screen): string {
  return `${SCREEN_NAMES[screen]} · PianoLearner`
}

// The song id in '#/play/<song id>', or undefined for '#/play' and anything else.
export function songIdFor(hash: string): string | undefined {
  const prefix = '#/play/'
  if (!hash.startsWith(prefix)) return undefined
  const id = hash.slice(prefix.length)
  return isSongId(id) ? id : undefined
}

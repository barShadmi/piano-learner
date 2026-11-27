// The screens the app knows about. Anything else is 'not-found'.
export type Screen = 'library' | 'sound' | 'not-found'

// An empty hash, a lone '#' or '#/' is the start page (the library).
export function screenFor(hash: string): Screen {
  if (hash === '' || hash === '#' || hash === '#/') return 'library'
  if (hash === '#/sound') return 'sound'
  return 'not-found'
}

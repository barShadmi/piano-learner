// The screens the app knows about. Anything else is 'not-found'.
export type Screen = 'library' | 'not-found'

// An empty hash, a lone '#' or '#/' is the start page (the library).
export function screenFor(hash: string): Screen {
  return hash === '' || hash === '#' || hash === '#/' ? 'library' : 'not-found'
}

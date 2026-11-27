// Which colour each key shows: the song's hands, with Bar's own presses on top. Pure logic, no React.
import type { KeyLit } from './Keyboard'

/** The keys Bar presses win over the song's colours. Returns a new map. */
export function mergeLit(
  pressed: ReadonlySet<number>,
  song: ReadonlyMap<number, 'right' | 'left'>
): Map<number, KeyLit> {
  const lit = new Map<number, KeyLit>(song)
  for (const note of pressed) lit.set(note, 'pressed')
  return lit
}

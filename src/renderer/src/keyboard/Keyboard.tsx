import { memo } from 'react'
import styles from './Keyboard.module.css'
import { keyboardLayout, noteName, type KeyLayout } from './layout'

// How a key is lit. 'pressed' is what Bar plays; 'right' and 'left' are for the song's hands (task 9).
export type KeyLit = 'pressed' | 'right' | 'left'

const WHITE_KEYS = 52

// The layout never changes, so it is worked out once.
const LAYOUT = keyboardLayout()
// White keys first, then black keys, so the black keys sit on top in the page order too.
const DRAW_ORDER = [...LAYOUT.filter((k) => !k.black), ...LAYOUT.filter((k) => k.black)]
// Every C gets a label. Middle C (MIDI 60) also gets a small word.
const C_LABELS = LAYOUT.filter((k) => !k.black && k.note % 12 === 0)

const percent = (value: number) => `${(value / WHITE_KEYS) * 100}%`

// One key. Memoised so a new batch of events only redraws keys whose state changed.
const KeyView = memo(function KeyView({ k, lit }: { k: KeyLayout; lit: KeyLit | undefined }) {
  const state = lit ?? 'idle'
  const hand = lit === 'right' || lit === 'left' ? lit : undefined
  const classes = [styles.key, k.black ? styles.black : styles.white]
  return (
    <div
      className={classes.join(' ')}
      data-note={k.note}
      data-black={k.black}
      data-state={state}
      style={{ left: percent(k.x), width: percent(k.width) }}
    >
      {hand ? <span className={styles.bar} /> : null}
      {hand && !k.black ? <span className={styles.letter}>{hand === 'right' ? 'R' : 'L'}</span> : null}
      {lit === 'pressed' ? <span className={styles.dot} data-dot /> : null}
    </div>
  )
})

export default function Keyboard({ lit }: { lit: ReadonlyMap<number, KeyLit> }) {
  return (
    <div className={styles.keyboard}>
      <div className={styles.board} role="img" aria-label="Piano keyboard">
        {DRAW_ORDER.map((k) => (
          <KeyView key={k.note} k={k} lit={lit.get(k.note)} />
        ))}
      </div>
      <div className={styles.labels}>
        {C_LABELS.map((k) => (
          <span key={k.note} className={styles.cLabel} style={{ left: percent(k.x + 0.5) }}>
            {noteName(k.note)}
            {k.note === 60 ? <span className={styles.middle}>Middle C</span> : null}
          </span>
        ))}
      </div>
    </div>
  )
}

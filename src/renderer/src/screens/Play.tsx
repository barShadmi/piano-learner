import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MidiStatusReply } from '../../../shared/audio'
import { applyEvents, keysDownLine, type KeysState } from '../keyboard/keysDown'
import Keyboard, { type KeyLit } from '../keyboard/Keyboard'
import styles from './Play.module.css'
import { pianoLine } from './soundText'

// Nothing is down and the pedal is up. One object, so setting it again changes nothing.
const NOTHING_DOWN: KeysState = { down: new Set(), pedal: false }

export default function Play() {
  // undefined until the first answer from the main process.
  const [piano, setPiano] = useState<MidiStatusReply | undefined>(undefined)
  const [keys, setKeys] = useState<KeysState>(NOTHING_DOWN)

  // Check the piano now, and again every 2 seconds. When the piano is not connected, every key and the pedal go up.
  const askPiano = useCallback(() => {
    const show = (reply: MidiStatusReply) => {
      setPiano(reply)
      if (!reply.ok || !reply.status.connected) setKeys(NOTHING_DOWN)
    }
    window.pianoLearner.midi.status().then(show, () =>
      show({ ok: false, error: 'The piano did not answer.' })
    )
  }, [])

  useEffect(() => {
    askPiano()
    const timer = setInterval(askPiano, 2000)
    return () => clearInterval(timer)
  }, [askPiano])

  // Key presses and releases from the piano. The sound itself never comes through here.
  useEffect(() => {
    return window.pianoLearner.midi.onEvents((events) => {
      setKeys((now) => applyEvents(now, events))
    })
  }, [])

  const connected = piano?.ok === true && piano.status.connected
  const lit = useMemo(
    () => new Map<number, KeyLit>([...keys.down].map((note) => [note, 'pressed' as const])),
    [keys.down]
  )

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title} id="play-title">
          Play
        </h1>
        <a href="#/" className="button">
          Back to your songs
        </a>
      </div>

      <p className={styles.statusLine} role="status">
        {connected ? 'Piano connected.' : pianoLine(piano)}
      </p>

      <div className={styles.bottom}>
        <p className={styles.pedal}>
          <span aria-hidden="true" className={styles.glyph}>
            {keys.pedal ? '●' : '○'}
          </span>
          {keys.pedal ? 'Pedal: down' : 'Pedal: up'}
        </p>
        <Keyboard lit={lit} />
        <p className={styles.keysDown}>{keysDownLine(keys)}</p>
      </div>
    </main>
  )
}

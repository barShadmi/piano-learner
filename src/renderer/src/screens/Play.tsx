import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MidiStatusReply } from '../../../shared/audio'
import { validateSong, type Hand, type Song } from '../../../shared/song'
import sampleJson from '../../../shared/song/samples/canon-opening.json'
import { SongClock } from '../falling/clock'
import FallingNotes from '../falling/FallingNotes'
import { songLengthSeconds, songNotesInSeconds } from '../falling/songTime'
import { mergeLit } from '../keyboard/lit'
import { applyEvents, keysDownLine, type KeysState } from '../keyboard/keysDown'
import Keyboard from '../keyboard/Keyboard'
import styles from './Play.module.css'
import { pianoLine } from './soundText'

// Nothing is down and the pedal is up. One object, so setting it again changes nothing.
const NOTHING_DOWN: KeysState = { down: new Set(), pedal: false }

// The bundled sample song. It starts 2 seconds before its first note so the first notes can be seen falling in.
const LEAD_IN_S = 2
const NO_SONG_LIT: ReadonlyMap<number, Hand> = new Map()
const checked = validateSong(sampleJson)
const SONG: Song | undefined = checked.ok ? checked.song : undefined
const TIMED = SONG ? songNotesInSeconds(SONG) : undefined
const START_S = TIMED && TIMED.notes.length > 0 ? TIMED.notes[0].startS - LEAD_IN_S : 0
const END_S = SONG ? songLengthSeconds(SONG) : 0

export default function Play() {
  // undefined until the first answer from the main process.
  const [piano, setPiano] = useState<MidiStatusReply | undefined>(undefined)
  const [keys, setKeys] = useState<KeysState>(NOTHING_DOWN)
  const [songLit, setSongLit] = useState<ReadonlyMap<number, Hand>>(NO_SONG_LIT)
  const [clock] = useState(() => {
    const c = new SongClock()
    c.seek(START_S)
    return c
  })

  const start = useCallback(() => {
    // After the end, Start begins again from the lead-in.
    if (clock.nowSeconds() >= END_S) clock.seek(START_S)
    clock.play(1)
  }, [clock])
  const pause = useCallback(() => clock.pause(), [clock])
  const backToStart = useCallback(() => {
    clock.pause()
    clock.seek(START_S)
  }, [clock])
  const onEnd = useCallback(() => clock.pause(), [clock])

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
  const lit = useMemo(() => mergeLit(keys.down, songLit), [keys.down, songLit])

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

      {SONG && TIMED ? (
        <div className={styles.songStrip}>
          <p className={styles.songTitle}>Song: {SONG.title}</p>
          <button type="button" className="button" onClick={start}>
            Start
          </button>
          <button type="button" className="button" onClick={pause}>
            Pause
          </button>
          <button type="button" className="button" onClick={backToStart}>
            Back to the start
          </button>
        </div>
      ) : (
        <p className={styles.songTitle}>The sample song could not be loaded.</p>
      )}

      <div className={styles.bottom}>
        <p className={styles.pedal}>
          <span aria-hidden="true" className={styles.glyph}>
            {keys.pedal ? '●' : '○'}
          </span>
          {keys.pedal ? 'Pedal: down' : 'Pedal: up'}
        </p>
        <div className={styles.stage}>
          {TIMED ? (
            <>
              <p className={styles.legend}>Blue = right hand (R) · Orange = left hand (L)</p>
              <FallingNotes
                timed={TIMED}
                clock={clock}
                onSounding={setSongLit}
                endS={END_S}
                onEnd={onEnd}
              />
            </>
          ) : null}
          <Keyboard lit={lit} />
        </div>
        <p className={styles.keysDown}>{keysDownLine(keys)}</p>
      </div>
    </main>
  )
}

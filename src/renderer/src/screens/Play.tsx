import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MidiStatusReply } from '../../../shared/audio'
import { validateSong, type Hand, type Song } from '../../../shared/song'
import sampleJson from '../../../shared/song/samples/canon-opening.json'
import { SongClock } from '../falling/clock'
import FallingNotes from '../falling/FallingNotes'
import { correction } from '../falling/follow'
import { songEventsPlan } from '../falling/songEvents'
import { songLengthSeconds, songNotesInSeconds } from '../falling/songTime'
import { mergeLit } from '../keyboard/lit'
import { applyEvents, keysDownLine, type KeysState } from '../keyboard/keysDown'
import Keyboard from '../keyboard/Keyboard'
import styles from './Play.module.css'
import { pianoLine } from './soundText'

// Nothing is down and the pedal is up. One object, so setting it again changes nothing.
const NOTHING_DOWN: KeysState = { down: new Set(), pedal: false }

// The song starts 2 seconds before its first note so the first notes can be seen falling in.
const LEAD_IN_S = 2
const NO_SONG_LIT: ReadonlyMap<number, Hand> = new Map()

// The bundled sample song, checked once. Used when there is no song id in the route.
const sampleCheck = validateSong(sampleJson)
const SAMPLE: Song | undefined = sampleCheck.ok ? sampleCheck.song : undefined

type Loaded =
  | { kind: 'loading' }
  | { kind: 'ready'; song: Song }
  | { kind: 'missing'; message: string }

// The Play screen. With a song id it loads that song from the library; without one it plays the sample.
export default function Play({ songId }: { songId?: string }) {
  const [loaded, setLoaded] = useState<Loaded>(() => {
    if (songId !== undefined) return { kind: 'loading' }
    return SAMPLE ? { kind: 'ready', song: SAMPLE } : { kind: 'missing', message: 'The sample song could not be loaded.' }
  })

  useEffect(() => {
    if (songId === undefined) return
    let cancelled = false
    const show = (next: Loaded): void => {
      if (!cancelled) setLoaded(next)
    }
    window.pianoLearner.songs.get(songId).then(
      (reply) => show(reply.ok ? { kind: 'ready', song: reply.song } : { kind: 'missing', message: reply.error }),
      () => show({ kind: 'missing', message: 'This song could not be found.' })
    )
    return () => {
      cancelled = true
    }
  }, [songId])

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
      {loaded.kind === 'loading' ? (
        <p className={styles.statusLine} role="status">
          Loading the song…
        </p>
      ) : null}
      {loaded.kind === 'missing' ? (
        <p className={styles.statusLine} role="status">
          {loaded.message}
        </p>
      ) : null}
      {loaded.kind === 'ready' ? <PlaySong key={loaded.song.id} song={loaded.song} /> : null}
    </main>
  )
}

// One song on the Play screen: the piano status, the song controls, the falling notes and the keyboard.
// It is keyed by song id, so each song starts with its own clock.
function PlaySong({ song }: { song: Song }) {
  const timed = useMemo(() => songNotesInSeconds(song), [song])
  const plan = useMemo(() => songEventsPlan(timed), [timed])
  const songEvents = plan.events
  const startS = timed.notes.length > 0 ? timed.notes[0].startS - LEAD_IN_S : 0
  const endS = useMemo(() => songLengthSeconds(song), [song])

  // undefined until the first answer from the main process.
  const [piano, setPiano] = useState<MidiStatusReply | undefined>(undefined)
  const [keys, setKeys] = useState<KeysState>(NOTHING_DOWN)
  const [songLit, setSongLit] = useState<ReadonlyMap<number, Hand>>(NO_SONG_LIT)
  const [clock] = useState(() => {
    const c = new SongClock()
    c.seek(startS)
    return c
  })

  // Listen mode. `listening` is true while the engine is meant to be playing the song.
  // `session` changes whenever Listen starts or stops, so a late answer from an older press is ignored.
  // `leadInTimer` starts the engine song when the lead-in (before time 0) ends.
  const [listening, setListening] = useState(false)
  // Plain reason when the engine could not play the song. The notes keep falling.
  const [heard, setHeard] = useState<string | undefined>(undefined)
  const session = useRef(0)
  const leadInTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Stops the engine song and any start that is still waiting. Silent when nothing plays.
  const stopListening = useCallback(() => {
    session.current++
    clearTimeout(leadInTimer.current)
    leadInTimer.current = undefined
    setListening(false)
    setHeard(undefined)
    window.pianoLearner.song.stop().then(
      () => undefined,
      () => undefined
    )
  }, [])

  // Leaving the screen stops the engine song.
  useEffect(() => {
    return () => stopListening()
  }, [stopListening])

  const listen = useCallback(() => {
    const mine = ++session.current
    clearTimeout(leadInTimer.current)
    leadInTimer.current = undefined
    setHeard(undefined)
    setListening(true)

    let fromS = clock.nowSeconds()
    if (fromS >= endS) {
      clock.seek(startS)
      fromS = startS
    }

    // The clock is started whatever the engine says: the notes keep falling without sound.
    const answer = (reply: { ok: true } | { ok: false; error: string }): void => {
      if (mine !== session.current) return
      if (reply.ok) {
        setHeard(undefined)
      } else {
        setListening(false)
        setHeard(reply.error)
      }
      clock.play(1)
    }
    const send = (fromMs: number): void => {
      window.pianoLearner.song.play(songEvents, fromMs).then(answer, () =>
        answer({ ok: false, error: 'The song could not start.' })
      )
    }

    if (fromS < 0) {
      // In the lead-in the clock starts now, and the engine starts when the clock reaches 0.
      clock.play(1)
      leadInTimer.current = setTimeout(
        () => {
          leadInTimer.current = undefined
          if (mine !== session.current) return
          send(Math.max(0, clock.nowSeconds() * 1000))
        },
        -fromS * 1000
      )
    } else {
      send(fromS * 1000)
    }
  }, [clock, endS, startS, songEvents])

  const start = useCallback(() => {
    // Watch only: Start always silences a Listen that is on or waiting to begin.
    stopListening()
    // After the end, Start begins again from the lead-in.
    if (clock.nowSeconds() >= endS) clock.seek(startS)
    clock.play(1)
  }, [clock, startS, endS, stopListening])
  const pause = useCallback(() => {
    clock.pause()
    stopListening()
  }, [clock, stopListening])
  const backToStart = useCallback(() => {
    clock.pause()
    stopListening()
    clock.seek(startS)
  }, [clock, startS, stopListening])
  const onEnd = useCallback(() => {
    clock.pause()
    stopListening()
  }, [clock, stopListening])

  // While Listen plays, check the engine's position every second and move the clock if it drifted.
  useEffect(() => {
    if (!listening) return
    const timer = setInterval(() => {
      const mine = session.current
      const clockAtAsk = clock.nowSeconds()
      window.pianoLearner.song.position().then(
        (reply) => {
          if (!reply.ok || mine !== session.current || !clock.isPlaying) return
          const next = correction(clockAtAsk, reply.positionMs)
          if (next !== undefined) clock.seek(next)
        },
        () => undefined
      )
    }, 1000)
    return () => clearInterval(timer)
  }, [listening, clock])

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
    <>
      <p className={styles.statusLine} role="status">
        {connected ? 'Piano connected.' : pianoLine(piano)}
      </p>

      <div className={styles.songStrip}>
        <p className={styles.songTitle}>Song: {song.title}</p>
        <button type="button" className="button" onClick={start}>
          Start
        </button>
        <button type="button" className="button" onClick={listen}>
          Listen
        </button>
        <button type="button" className="button" onClick={pause}>
          Pause
        </button>
        <button type="button" className="button" onClick={backToStart}>
          Back to the start
        </button>
      </div>

      {listening && heard === undefined ? (
        <p className={styles.soundReason} role="status">
          Listening…
        </p>
      ) : null}
      {heard !== undefined ? (
        <div className={styles.soundLine}>
          <p className={styles.soundReason} role="status">
            {heard}
          </p>
          <a href="#/sound" className="button">
            Open Sound settings
          </a>
        </div>
      ) : null}
      {plan.cut ? (
        <p className={styles.soundReason} role="status">
          This song is too long to play to the end.
        </p>
      ) : null}

      <div className={styles.bottom}>
        <p className={styles.pedal}>
          <span aria-hidden="true" className={styles.glyph}>
            {keys.pedal ? '●' : '○'}
          </span>
          {keys.pedal ? 'Pedal: down' : 'Pedal: up'}
        </p>
        <div className={styles.stage}>
          <p className={styles.legend}>Blue = right hand (R) · Orange = left hand (L)</p>
          <FallingNotes timed={timed} clock={clock} onSounding={setSongLit} endS={endS} onEnd={onEnd} />
          <Keyboard lit={lit} />
        </div>
        <p className={styles.keysDown}>{keysDownLine(keys)}</p>
      </div>
    </>
  )
}

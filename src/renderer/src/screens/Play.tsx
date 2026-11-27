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
import { engineStart, leadInEnd, playView, type Activity } from './playState'
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
          {loaded.kind === 'ready' ? loaded.song.title : 'Play'}
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

// A dot before the word of the button that is on. The pressed state is also in aria-pressed.
function Dot({ on }: { on: boolean }) {
  return on ? (
    <span aria-hidden="true" className={styles.glyph}>
      ●
    </span>
  ) : null
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

  // What the song is doing. `listening` is true while the engine is meant to be playing the song.
  // `session` changes whenever Listen starts or stops, so a late answer from an older press is ignored.
  // `leadInTimer` starts the engine song when the lead-in (before time 0) ends.
  const [activity, setActivity] = useState<Activity>('idle')
  const listening = activity === 'listen'
  // Plain reason when the engine could not play the song. The notes keep falling.
  const [heard, setHeard] = useState<string | undefined>(undefined)
  const session = useRef(0)
  const leadInTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Stops the engine song and any start that is still waiting. Silent when nothing plays.
  const stopListening = useCallback(() => {
    session.current++
    clearTimeout(leadInTimer.current)
    leadInTimer.current = undefined
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
    // Already listening: nothing to do.
    if (activity === 'listen') return
    const mine = ++session.current
    clearTimeout(leadInTimer.current)
    leadInTimer.current = undefined
    setHeard(undefined)
    setActivity('listen')

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
        setActivity('watch')
        setHeard(reply.error)
      }
      clock.play(1)
    }
    const send = (fromMs: number): void => {
      window.pianoLearner.song.play(songEvents, fromMs).then(answer, () =>
        answer({ ok: false, error: 'The song could not start.' })
      )
    }

    const begin = engineStart(fromS)
    if (begin.kind === 'wait') {
      // In the lead-in the clock starts now, and the engine starts when the clock reaches 0.
      clock.play(1)
      leadInTimer.current = setTimeout(() => {
        leadInTimer.current = undefined
        if (mine !== session.current) return
        const first = leadInEnd()
        clock.seek(first.seekS)
        send(first.fromMs)
      }, begin.waitMs)
    } else {
      send(begin.fromMs)
    }
  }, [activity, clock, endS, startS, songEvents])

  const watch = useCallback(() => {
    if (activity === 'watch' && heard === undefined) return
    // Watch only: this always silences a Listen that is on or waiting to begin. The notes keep moving.
    stopListening()
    setActivity('watch')
    // After the end, Watch begins again from the lead-in.
    if (clock.nowSeconds() >= endS) clock.seek(startS)
    clock.play(1)
  }, [activity, heard, clock, startS, endS, stopListening])
  const view = playView({ activity, reason: heard })
  const pause = useCallback(() => {
    if (view.pauseDisabled) return
    clock.pause()
    stopListening()
    setActivity('paused')
  }, [view.pauseDisabled, clock, stopListening])
  const backToStart = useCallback(() => {
    clock.pause()
    stopListening()
    clock.seek(startS)
    setActivity('idle')
  }, [clock, startS, stopListening])
  const onEnd = useCallback(() => {
    clock.pause()
    stopListening()
    setActivity('finished')
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
      <div className={styles.infoLine}>
        <p className={styles.compact}>
          <span role="status">{connected ? 'Piano connected.' : pianoLine(piano)}</span>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <span aria-hidden="true" className={styles.glyph}>
            {keys.pedal ? '●' : '○'}
          </span>
          {keys.pedal ? 'Pedal: down' : 'Pedal: up'}
        </p>
      </div>

      <div className={styles.songStrip}>
        <button
          type="button"
          className="button"
          aria-pressed={view.listenPressed}
          aria-describedby="play-hint"
          onClick={listen}
        >
          <Dot on={view.listenPressed} />
          Listen
        </button>
        <button
          type="button"
          className="button button-secondary"
          aria-pressed={view.watchPressed}
          aria-describedby="play-hint"
          onClick={watch}
        >
          <Dot on={view.watchPressed} />
          Watch (no sound)
        </button>
        <button
          type="button"
          className="button button-secondary"
          aria-disabled={view.pauseDisabled}
          onClick={pause}
        >
          Pause
        </button>
        <button type="button" className="button button-secondary" onClick={backToStart}>
          Restart song
        </button>
        <p className={styles.hint} id="play-hint">
          Listen plays the song with sound. Watch shows the notes only.
        </p>
      </div>
      <div className={styles.soundLine}>
        <p className={styles.soundReason} role="status">
          {view.status}
        </p>
        {view.soundLink ? (
          <a href="#/sound" className="button button-secondary">
            Open Sound
          </a>
        ) : null}
      </div>
      {plan.cut ? (
        <p className={styles.compact}>Listen plays only the first part of this long song.</p>
      ) : null}

      <div className={styles.bottom}>
        <div className={styles.stage}>
          <p className={styles.legend}>Blue = right hand (R, or a stripe on the right edge) · Orange = left hand (L, or a stripe on the left edge)</p>
          <FallingNotes timed={timed} clock={clock} onSounding={setSongLit} endS={endS} onEnd={onEnd} />
          <Keyboard lit={lit} />
        </div>
        <p className={styles.keysDown}>{keysDownLine(keys)}</p>
      </div>
    </>
  )
}

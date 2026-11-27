import { useCallback, useEffect, useRef, useState } from 'react'
import type { AudioState, MidiEvent, MidiStatusReply } from '../../../shared/audio'
import styles from './Sound.module.css'
import {
  backendWords,
  lastKeyLine,
  latestKeyDown,
  LOCAL_CONTROL_TIP,
  localControlLine,
  PIANO_SOUND_CREDIT,
  pianoLine,
  pianoProblem,
  pianoSoundLine,
  statusLine
} from './soundText'

// What the screen shows when the main process does not answer.
const didNotAnswer = (now: AudioState): AudioState => ({
  phase: 'failed',
  error: 'The sound engine did not answer.',
  piano: now.piano,
  pianoError: now.pianoError
})

// Words and a shape for each phase, so colour is never the only signal.
const badge = {
  starting: { label: 'Starting', glyph: '…' },
  on: { label: 'On', glyph: '✓' },
  off: { label: 'Off', glyph: '○' },
  failed: { label: 'Problem', glyph: '▲' }
} as const

// The same idea for the piano sound.
const pianoSoundBadge = {
  loading: { label: 'Loading', glyph: '…' },
  ready: { label: 'Ready', glyph: '✓' },
  failed: { label: 'Problem', glyph: '▲' }
} as const

export default function Sound() {
  const [state, setState] = useState<AudioState>({ phase: 'starting', piano: 'loading' })
  const [beep, setBeep] = useState('')
  const busy = useRef(false)
  // undefined until the first answer from the main process.
  const [piano, setPiano] = useState<MidiStatusReply | undefined>(undefined)
  const [lastKey, setLastKey] = useState<MidiEvent | undefined>(undefined)

  const askPiano = useCallback(() => {
    window.pianoLearner.midi.status().then(
      (reply) => setPiano(reply),
      () => setPiano({ ok: false, error: 'The piano did not answer.' })
    )
  }, [])

  // Check the piano now, and again every 2 seconds so a plugged-in piano shows up by itself.
  useEffect(() => {
    askPiano()
    const timer = setInterval(askPiano, 2000)
    return () => clearInterval(timer)
  }, [askPiano])

  // Key presses for the "Last key" line. The sound itself never comes through here.
  useEffect(() => {
    return window.pianoLearner.midi.onEvents((events) => {
      const key = latestKeyDown(events)
      if (key) setLastKey(key)
    })
  }, [])

  const reconnectPiano = () => {
    window.pianoLearner.midi.reconnect().then(
      (reply) => {
        if (reply.ok) askPiano()
        else setPiano(reply)
      },
      () => setPiano({ ok: false, error: 'The piano did not answer.' })
    )
  }

  // Ask the main process what sound is doing now.
  useEffect(() => {
    let cancelled = false
    window.pianoLearner.audio.state().then(
      (next) => {
        if (!cancelled) setState(next)
      },
      () => {
        if (!cancelled) setState(didNotAnswer)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  // While sound is still opening or the piano sound is still loading (each can take a
  // while), keep asking.
  useEffect(() => {
    if (state.phase !== 'starting' && state.piano !== 'loading') return
    let cancelled = false
    const timer = setTimeout(() => {
      window.pianoLearner.audio.state().then(
        (next) => {
          if (!cancelled) setState(next)
        },
        () => {
          if (!cancelled) setState(didNotAnswer)
        }
      )
    }, 500)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [state])

  const startSound = () => {
    if (busy.current) return
    busy.current = true
    setBeep('')
    setState((now) => ({ phase: 'starting', piano: now.piano, pianoError: now.pianoError }))
    window.pianoLearner.audio
      .start()
      .then(setState, () => setState(didNotAnswer))
      .finally(() => {
        busy.current = false
      })
  }

  const playBeep = () => {
    if (state.phase !== 'on') return
    window.pianoLearner.audio.testTone().then(
      (reply) =>
        setBeep(
          reply.ok
            ? 'Playing a short beep. If you hear nothing, check your volume and cables.'
            : reply.error
        ),
      () => setBeep('The test sound could not play.')
    )
  }

  const canPlay = state.phase === 'on'
  const pianoSound = state.piano
  const result = state.result
  const connected = piano?.ok === true && piano.status.connected
  const pianoBadge = piano === undefined ? 'Checking' : connected ? 'Connected' : 'Not found'
  const pianoGlyph = piano === undefined ? '…' : connected ? '✓' : '○'
  const problem = pianoProblem(piano)
  const localLine = localControlLine(piano)

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title} id="sound-title">
          Sound
        </h1>
        <a href="#/" className="button">
          Back to your songs
        </a>
      </div>

      <section className={styles.panel} aria-labelledby="status-title">
        <h2 className={styles.sectionTitle} id="status-title">
          Sound status
        </h2>
        <p className={`${styles.badge} ${styles[state.phase]}`}>
          <span aria-hidden="true" className={styles.glyph}>
            {badge[state.phase].glyph}
          </span>
          {badge[state.phase].label}
        </p>
        <p className={styles.statusLine} role="status">
          {statusLine(state)}
        </p>

        {state.phase === 'on' && result?.fallbackReason ? (
          <p className={styles.note}>
            Exclusive mode did not work, so sound uses {backendWords(result.backend)} instead.
            Reason: {result.fallbackReason}
          </p>
        ) : null}

        {state.phase === 'failed' ? (
          <>
            <p className={styles.reason}>
              <strong>Reason:</strong> {state.error ?? 'No reason was given.'}
            </p>
            <p className={styles.note}>
              Check that your headphones or speakers are plugged in and not used by another app.
            </p>
            <button type="button" className="button" onClick={startSound}>
              Try again
            </button>
          </>
        ) : null}

        {state.phase === 'off' ? (
          <button type="button" className="button" onClick={startSound}>
            Start sound
          </button>
        ) : null}
      </section>

      <section className={styles.panel} aria-labelledby="piano-title">
        <h2 className={styles.sectionTitle} id="piano-title">
          Piano
        </h2>
        <p className={`${styles.badge} ${connected ? styles.on : ''}`}>
          <span aria-hidden="true" className={styles.glyph}>
            {pianoGlyph}
          </span>
          {pianoBadge}
        </p>
        <p className={styles.statusLine} role="status">
          {pianoLine(piano)}
        </p>
        {localLine ? (
          <>
            <p className={styles.note}>{localLine}</p>
            <p className={styles.note}>{LOCAL_CONTROL_TIP}</p>
          </>
        ) : null}
        {problem ? <p className={styles.reason}>Piano problem: {problem}</p> : null}
        <p className={styles.note}>{lastKeyLine(lastKey)}</p>
        <button type="button" className="button" onClick={reconnectPiano}>
          Reconnect piano
        </button>
      </section>

      <section className={styles.panel} aria-labelledby="piano-sound-title">
        <h2 className={styles.sectionTitle} id="piano-sound-title">
          Piano sound
        </h2>
        <p
          className={`${styles.badge} ${pianoSound === 'ready' ? styles.on : ''} ${pianoSound === 'failed' ? styles.failed : ''}`}
        >
          <span aria-hidden="true" className={styles.glyph}>
            {pianoSoundBadge[pianoSound].glyph}
          </span>
          {pianoSoundBadge[pianoSound].label}
        </p>
        <p className={styles.statusLine} role="status">
          {pianoSoundLine(pianoSound)}
        </p>
        {pianoSound === 'failed' ? (
          <p className={styles.reason}>
            <strong>Reason:</strong> {state.pianoError ?? 'No reason was given.'}
          </p>
        ) : null}
        <p className={styles.note}>{PIANO_SOUND_CREDIT}</p>
      </section>

      <section className={styles.panel} aria-labelledby="test-title">
        <h2 className={styles.sectionTitle} id="test-title">
          Test your sound
        </h2>
        <p className={styles.note}>
          Put on your headphones and turn the volume down a little, then press the button. You
          should hear a short beep.
        </p>
        <button
          type="button"
          className="button"
          aria-disabled={canPlay ? undefined : 'true'}
          aria-describedby={canPlay ? undefined : 'test-hint'}
          onClick={playBeep}
        >
          Play test sound
        </button>
        {canPlay ? null : (
          <p className={styles.note} id="test-hint">
            Sound has to be on before you can play a test sound.
          </p>
        )}
        <p className={styles.note} role="status">
          {beep}
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="delay-title">
        <h2 className={styles.sectionTitle} id="delay-title">
          Delay
        </h2>
        <p className={styles.note}>See how long a key takes to sound on this PC.</p>
        <a href="#/latency" className="button">
          Test the delay
        </a>
      </section>
    </main>
  )
}

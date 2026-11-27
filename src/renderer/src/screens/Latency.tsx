import { useCallback, useEffect, useState } from 'react'
import type { MidiStatusReply } from '../../../shared/audio'
import {
  KEYS_NEEDED,
  SOUND_OFF_LINE,
  resultLine,
  setupRows,
  soundIsOff,
  timingRows,
  verdict,
  verdictWords,
  type LatencyReply,
  type LatencySummary
} from '../../../shared/latency'
import styles from './Latency.module.css'

// The Delay test. The main process times the keys and the sound card; this screen only
// reads the numbers through the bridge. It never plays or times sound itself.
export default function Latency() {
  const [summary, setSummary] = useState<LatencySummary | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  // undefined until the first answer about the piano.
  const [piano, setPiano] = useState<MidiStatusReply | undefined>(undefined)
  const [saved, setSaved] = useState(false)
  const [message, setMessage] = useState('')

  const askSummary = useCallback(() => {
    window.pianoLearner.latency.summary().then(
      (reply: LatencyReply) => {
        if (reply.ok) {
          setSummary(reply.summary)
          setProblem(undefined)
        } else {
          setProblem(reply.error)
        }
      },
      () => setProblem('The delay numbers did not answer.')
    )
  }, [])

  const askPiano = useCallback(() => {
    window.pianoLearner.midi.status().then(
      (reply) => setPiano(reply),
      () => setPiano({ ok: false, error: 'The piano did not answer.' })
    )
  }, [])

  // Forget any old timings when the screen opens, then keep reading the numbers.
  // Each read also collects the keys played since the last one.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | undefined
    const begin = (): void => {
      if (cancelled) return
      askSummary()
      timer = setInterval(askSummary, 500)
    }
    window.pianoLearner.latency.clear().then(begin, begin)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [askSummary])

  // Check the piano now, and again every 2 seconds so a plugged-in piano shows up by itself.
  useEffect(() => {
    askPiano()
    const timer = setInterval(askPiano, 2000)
    return () => clearInterval(timer)
  }, [askPiano])

  const testAgain = (): void => {
    setSaved(false)
    setMessage('')
    window.pianoLearner.latency.clear().then(
      (reply) => {
        if (reply.ok) askSummary()
        else setProblem(reply.error)
      },
      () => setProblem('The delay numbers could not be cleared.')
    )
  }

  const reconnectPiano = (): void => {
    window.pianoLearner.midi.reconnect().then(askPiano, askPiano)
  }

  const saveReport = (): void => {
    window.pianoLearner.latency.save().then(
      (reply) => {
        if (reply.ok) {
          setSaved(true)
          setMessage('Saved latency-report.txt and latency-report.json.')
        } else {
          setMessage(reply.error)
        }
      },
      () => setMessage('The report could not be saved.')
    )
  }

  const showFile = (): void => {
    window.pianoLearner.latency.showFile().then(
      (reply) => {
        if (!reply.ok) setMessage(reply.error)
      },
      () => setMessage('The folder could not be opened.')
    )
  }

  const count = summary?.count ?? 0
  const shown = Math.min(count, KEYS_NEEDED)
  const connected = piano?.ok === true && piano.status.connected
  const full = summary !== undefined && count >= KEYS_NEEDED
  // The piano is there but no sound output runs, so no key can be timed.
  const soundOff = connected && summary !== undefined && soundIsOff(summary)
  const words = full ? verdictWords(verdict(summary)) : undefined

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title} id="latency-title">
          Delay test
        </h1>
        <a href="#/sound" className="button">
          Back to Sound
        </a>
      </div>

      <section className={styles.panel} aria-labelledby="latency-title">
        <p className={styles.note}>
          Play any key on the piano {KEYS_NEEDED} times, at any speed. The app measures how long each
          key takes to sound.
        </p>

        {piano !== undefined && !connected ? (
          <>
            <p className={styles.note}>Connect the piano to run the test.</p>
            <button type="button" className="button" onClick={reconnectPiano}>
              Reconnect piano
            </button>
          </>
        ) : null}

        {soundOff ? (
          <p className={styles.reason}>{SOUND_OFF_LINE}</p>
        ) : (
          <>
            <p className={styles.statusLine} id="progress-label">
              {`${shown} of ${KEYS_NEEDED} keys`}
            </p>
            <div
              className={styles.track}
              role="progressbar"
              aria-labelledby="progress-label"
              aria-valuemin={0}
              aria-valuemax={KEYS_NEEDED}
              aria-valuenow={shown}
            >
              <div className={styles.fill} style={{ width: `${(shown / KEYS_NEEDED) * 100}%` }} />
            </div>
          </>
        )}

        {problem ? <p className={styles.reason}>{problem}</p> : null}

        {summary && words ? (
          <>
            <p className={styles.big}>{resultLine(summary.medianMs)}</p>
            <p className={`${styles.verdict} ${styles[verdict(summary)]}`}>
              <span aria-hidden="true" className={styles.glyph}>
                {words.glyph}
              </span>
              {words.text}
            </p>
            {words.tips.length > 0 ? (
              <>
                <p className={styles.note}>What to try:</p>
                <ul className={styles.tips}>
                  {words.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </>
            ) : null}

            <h2 className={styles.sectionTitle} id="details-title">
              Details
            </h2>
            <table className={styles.table} aria-labelledby="details-title">
              <tbody>
                {[...timingRows(summary), ...setupRows(summary)].map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.note}>The sound card figure was measured when sound started.</p>
          </>
        ) : null}

        <div className={styles.actions}>
          <button type="button" className="button" onClick={testAgain}>
            Test again
          </button>
          <button type="button" className="button" onClick={saved ? showFile : saveReport}>
            {saved ? 'Saved. Show file' : 'Save report'}
          </button>
        </div>
        <p className={styles.note} role="status">
          {message}
        </p>
      </section>
    </main>
  )
}

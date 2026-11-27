/// <reference types="vite/client" />
import { useCallback, useEffect, useState } from 'react'
import sampleJson from '../../../shared/song/samples/canon-opening.json'
import type { SongSummary } from '../../../shared/songs'
import styles from './Library.module.css'

// The bundled sample is always first in the list. It is not stored in the songs folder.
const SAMPLE_TITLE = `${sampleJson.title} · sample`

export default function Library() {
  // undefined until the first answer from the main process.
  const [songs, setSongs] = useState<SongSummary[] | undefined>(undefined)
  const [listProblem, setListProblem] = useState<string | undefined>(undefined)
  const [importing, setImporting] = useState(false)
  // What the last import said: "Added …" or the reason it failed. Empty before any import.
  const [message, setMessage] = useState('')

  const refresh = useCallback(() => {
    window.pianoLearner.songs.list().then(
      (list) => {
        setSongs(list)
        setListProblem(undefined)
      },
      () => setListProblem('Your songs could not be read.')
    )
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const importFile = (): void => {
    if (importing) return
    setImporting(true)
    setMessage('')
    window.pianoLearner.songs
      .import()
      .then(
        (reply) => {
          if (reply.ok) {
            setMessage(`Added “${reply.song.title}”.`)
            refresh()
          } else if ('error' in reply) {
            setMessage(reply.error)
          }
          // A cancelled dialog says nothing.
        },
        () => setMessage('The file could not be imported.')
      )
      .finally(() => setImporting(false))
  }

  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title} id="songs-title">
          Your songs
        </h1>
        <div className={styles.actions}>
          <button type="button" className="button" aria-disabled={importing} onClick={importFile}>
            Import file
          </button>
          <a href="#/sound" className="button">
            Sound
          </a>
          <a href="#/play" className="button">
            Play the piano
          </a>
        </div>
      </div>
      <p className={styles.status} role="status">
        {importing ? 'Importing…' : message}
      </p>
      <section className={styles.panel} aria-labelledby="songs-title">
        <ul className={styles.list}>
          <li className={styles.row}>
            <span className={styles.rowTitle}>{SAMPLE_TITLE}</span>
            <a href="#/play" className="button" aria-label={`Play ${sampleJson.title}`}>
              Play
            </a>
          </li>
          {(songs ?? []).map((song) => (
            <li key={song.id} className={styles.row}>
              <span className={styles.rowTitle}>
                {song.title}
                {song.composer ? <span className={styles.rowMeta}> · {song.composer}</span> : null}
              </span>
              <a href={`#/play/${song.id}`} className="button" aria-label={`Play ${song.title}`}>
                Play
              </a>
            </li>
          ))}
        </ul>
        {listProblem ? <p className={styles.empty}>{listProblem}</p> : null}
        {songs && songs.length === 0 ? (
          <p className={styles.empty}>
            You have no songs of your own yet. You can import a MIDI or MusicXML file now. Sheet music
            photos and videos come later.
          </p>
        ) : null}
      </section>
    </main>
  )
}

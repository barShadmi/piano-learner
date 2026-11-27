/// <reference types="vite/client" />
import styles from './Library.module.css'

export default function Library() {
  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title} id="songs-title">
          Your songs
        </h1>
        <div className={styles.actions}>
          <div className={styles.action}>
            {/* Phase 2: wire up import. Drop aria-disabled and the hint below, and change the
                second panel line to "Import sheet music (a photo or PDF), a MIDI or MusicXML
                file, or a falling-note video to start playing." */}
            <button
              type="button"
              className="button"
              aria-disabled="true"
              aria-describedby="import-soon"
            >
              Import file
            </button>
            <p className={styles.hint} id="import-soon">
              Importing arrives in a later update.
            </p>
          </div>
          <a href="#/sound" className="button">
            Sound
          </a>
          <a href="#/play" className="button">
            Play the piano
          </a>
        </div>
      </div>
      <section className={styles.panel} aria-labelledby="songs-title">
        <p className={styles.emptyTitle}>No songs yet.</p>
        <p className={styles.empty}>
          You'll be able to import sheet music (a photo or PDF), a MIDI or MusicXML file, or a
          falling-note video.
        </p>
      </section>
    </main>
  )
}

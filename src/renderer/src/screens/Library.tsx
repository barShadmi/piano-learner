/// <reference types="vite/client" />
import styles from './Library.module.css'

export default function Library() {
  return (
    <main className={styles.screen}>
      <div className={styles.header}>
        <h1 className={styles.title}>Your songs</h1>
        {/* Import is wired up in phase 2. Then drop aria-disabled, the no-op click and the hint. */}
        <button
          type="button"
          className="button"
          aria-disabled="true"
          aria-describedby="import-soon"
          onClick={() => {}}
        >
          Import file
        </button>
      </div>
      <section className={styles.panel} aria-label="Song list">
        <p className={styles.empty}>
          No songs yet. Import sheet music (a photo or PDF), a MIDI or MusicXML file, or a
          falling-notes video to start playing.
        </p>
        <p className={styles.hint} id="import-soon">
          Importing arrives in a later update.
        </p>
      </section>
    </main>
  )
}

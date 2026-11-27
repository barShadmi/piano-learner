import styles from './NotFound.module.css'

export default function NotFound() {
  return (
    <main className={styles.screen}>
      <h1>Screen not found</h1>
      <p>This screen doesn't exist yet.</p>
      <a href="#/" className="button">
        Back to your songs
      </a>
    </main>
  )
}

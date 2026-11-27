// Import is not wired up yet, so the button is off. Its off look is the muted one.
const canImport = false

const screenStyle = {
  padding: 'var(--space-6)',
}

const headingStyle = {
  fontSize: 'var(--text-2xl)',
  margin: '0 0 var(--space-4)',
}

const emptyTextStyle = {
  color: 'var(--text-muted)',
  margin: '0 0 var(--space-5)',
}

const importButtonStyle = canImport
  ? {
      background: 'var(--accent)',
      color: 'var(--on-accent)',
      border: '1px solid var(--accent)',
    }
  : {
      background: 'var(--surface-raised)',
      color: 'var(--text-muted)',
      border: '1px solid var(--border)',
      cursor: 'not-allowed',
    }

const buttonBaseStyle = {
  font: 'inherit',
  minWidth: '44px',
  padding: 'var(--space-2) var(--space-5)',
  borderRadius: 'var(--radius-2)',
}

export default function Library() {
  return (
    <main style={screenStyle}>
      <h1 style={headingStyle}>Your songs</h1>
      <p style={emptyTextStyle}>
        No songs yet. Import a sheet, a MIDI or MusicXML file, or a video to begin.
      </p>
      <button
        type="button"
        disabled={!canImport}
        style={{ ...buttonBaseStyle, ...importButtonStyle }}
      >
        Import
      </button>
    </main>
  )
}

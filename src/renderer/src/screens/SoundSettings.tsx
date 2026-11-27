import { useEffect, useRef, useState } from 'react'
import type { AudioState, Backend, OutputDevice } from '../../../shared/audio'
import type { SettingsSetReply, SoundSettings as Settings } from '../../../shared/settings'
import styles from './SoundSettings.module.css'
import { modeLabel } from '../../../shared/modes'
import { BUFFER_HINT, bufferLabel, modeChoices, outputChoices, outputFamily } from './soundText'

const bufferChoices = [64, 128, 256, 512] as const

type Props = {
  // Set when the sound output was not found and the default is used. Shown once here.
  settingsNote?: string
  // Gives the Sound screen the sound state that came back with a save.
  onState: (state: AudioState) => void
}

// The Settings section of the Sound screen. Each change is saved at once.
export default function SoundSettings({ settingsNote, onState }: Props) {
  const [settings, setSettings] = useState<Settings | undefined>(undefined)
  const [outputs, setOutputs] = useState<OutputDevice[]>([])
  const [message, setMessage] = useState('')
  // The settings to change next: the newest one sent, or the last one saved.
  const draft = useRef<Settings | undefined>(undefined)
  // The last confirmed settings, to go back to when a save fails.
  const confirmed = useRef<Settings | undefined>(undefined)
  // The save that produced `confirmed`. A late answer to an older save never replaces a newer one.
  const confirmedId = useRef(0)
  // Counts the saves. Only the answer to the newest save changes what the screen shows.
  const requestId = useRef(0)
  // The timer that saves a volume move when the slider is not let go (see saveVolume).
  const volumeTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    window.pianoLearner.settings.get().then(
      (saved) => {
        if (cancelled || requestId.current !== 0) return
        confirmed.current = saved
        draft.current = saved
        setSettings(saved)
      },
      () => {
        if (!cancelled) setMessage('The settings could not be read.')
      }
    )
    window.pianoLearner.audio.listOutputs().then(
      (reply) => {
        if (!cancelled) setOutputs(reply.ok ? reply.outputs : [])
      },
      () => {
        if (!cancelled) setOutputs([])
      }
    )
    return () => {
      cancelled = true
      // A volume move that is still waiting is saved now, so closing the screen never loses it.
      if (volumeTimer.current !== undefined) {
        window.clearTimeout(volumeTimer.current)
        volumeTimer.current = undefined
        if (draft.current) void window.pianoLearner.settings.set(draft.current).catch(() => undefined)
      }
    }
  }, [])

  const save = (next: Settings) => {
    const id = ++requestId.current
    draft.current = next
    setSettings(next)
    setMessage('Saving…')
    window.pianoLearner.settings.set(next).then(
      (reply: SettingsSetReply) => {
        if (reply.ok && id >= confirmedId.current) {
          confirmedId.current = id
          confirmed.current = reply.settings
        }
        if (id !== requestId.current) return
        if (reply.ok) {
          // A volume move that is waiting, or made since this save was sent, is newer than the reply.
          const volumeMoved = volumeTimer.current !== undefined || draft.current !== next
          const shown = volumeMoved && draft.current ? { ...reply.settings, volume: draft.current.volume } : reply.settings
          draft.current = shown
          setSettings(shown)
          setMessage('Saved.')
          onState(reply.state)
        } else {
          revert(reply.error)
        }
      },
      () => {
        if (id === requestId.current) revert('The settings could not be saved.')
      }
    )
  }

  const revert = (reason: string) => {
    if (confirmed.current) {
      draft.current = confirmed.current
      setSettings(confirmed.current)
      // The engine followed the slider while it moved, so bring it back to the confirmed volume.
      void window.pianoLearner.audio.setVolume(confirmed.current.volume).catch(() => undefined)
    }
    setMessage(reason)
  }

  // Applies one change on top of the newest settings.
  const change = (patch: Partial<Settings>) => {
    const base = draft.current
    if (!base) return
    save({ ...base, ...patch })
  }

  // Saves a pending volume move. Called when the slider is let go (or loses focus), and after
  // 300 ms with no move. Does nothing when no move is waiting.
  const saveVolume = () => {
    if (volumeTimer.current === undefined) return
    window.clearTimeout(volumeTimer.current)
    volumeTimer.current = undefined
    if (draft.current) save(draft.current)
  }

  // The slider changes the level at once, without a save. The save waits for release.
  const moveVolume = (volume: number) => {
    const base = draft.current
    if (!base) return
    draft.current = { ...base, volume }
    setSettings(draft.current)
    void window.pianoLearner.audio.setVolume(volume).catch(() => undefined)
    if (volumeTimer.current !== undefined) window.clearTimeout(volumeTimer.current)
    volumeTimer.current = window.setTimeout(saveVolume, 300)
  }

  if (!settings) {
    return (
      <section className={styles.panel} aria-labelledby="settings-title">
        <h2 className={styles.sectionTitle} id="settings-title">
          Settings
        </h2>
        <p className={styles.note} role="status">
          {message || 'Loading the settings…'}
        </p>
      </section>
    )
  }

  const modes = modeChoices(outputs, settings.backend)
  const outputOptions = outputChoices(outputs, settings.backend, settings.deviceId)
  const volumePercent = Math.round(settings.volume * 100)

  return (
    <section className={styles.panel} aria-labelledby="settings-title">
      <h2 className={styles.sectionTitle} id="settings-title">
        Settings
      </h2>
      {settingsNote ? (
        <p className={styles.note} role="status">
          {settingsNote}
        </p>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sound-output">
          Output
        </label>
        <select
          id="sound-output"
          className={styles.select}
          value={settings.deviceId ?? ''}
          onChange={(event) => change({ deviceId: event.target.value === '' ? undefined : event.target.value })}
        >
          {outputOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sound-mode">
          Mode
        </label>
        <select
          id="sound-mode"
          className={styles.select}
          value={settings.backend}
          onChange={(event) => {
            const backend = event.target.value as Backend
            // A device list belongs to one mode family, so a new family starts from the default output.
            const sameFamily = outputFamily(backend) === outputFamily(settings.backend)
            change({ backend, deviceId: sameFamily ? settings.deviceId : undefined })
          }}
        >
          {modes.map((backend) => (
            <option key={backend} value={backend}>
              {modeLabel(backend)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="sound-buffer">
          Buffer
        </label>
        <select
          id="sound-buffer"
          className={styles.select}
          aria-describedby="sound-buffer-hint"
          value={settings.bufferFrames}
          onChange={(event) => change({ bufferFrames: Number(event.target.value) as Settings['bufferFrames'] })}
        >
          {bufferChoices.map((frames) => (
            <option key={frames} value={frames}>
              {bufferLabel(frames)}
            </option>
          ))}
        </select>
        <p className={styles.note} id="sound-buffer-hint">
          {BUFFER_HINT}
        </p>
      </div>

      <div className={styles.rangeRow}>
        <label className={styles.label} htmlFor="sound-volume">
          Volume
        </label>
        <input
          id="sound-volume"
          className={styles.range}
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumePercent}
          onChange={(event) => moveVolume(Number(event.target.value) / 100)}
          onPointerUp={saveVolume}
          onKeyUp={saveVolume}
          onBlur={saveVolume}
        />
        <output htmlFor="sound-volume" className={styles.note}>
          {volumePercent}%
        </output>
      </div>

      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={settings.pianoSpeakers}
          onChange={(event) => change({ pianoSpeakers: event.target.checked })}
        />
        <span className={styles.label}>Let the piano&apos;s own speakers play too</span>
      </label>

      <p className={styles.note} role="status">
        {message}
      </p>
    </section>
  )
}

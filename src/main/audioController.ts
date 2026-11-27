import {
  reportJson,
  reportText,
  type LatencyClearReply,
  type LatencyReply,
  type LatencyReportReply,
  type LatencySummary
} from '../shared/latency'
import type { SoundSettings } from '../shared/settings'
import { startConfigFor } from '../shared/settings'
import type {
  AudioState,
  EngineStatus,
  ListOutputsReply,
  MidiEvent,
  MidiReconnectReply,
  MidiStatus,
  MidiStatusReply,
  OutputDevice,
  PianoSound,
  SongEvent,
  SongPositionReply,
  SongReply,
  StartConfig,
  StartResult,
  StatusReply,
  TestToneReply,
  ToneArgs
} from '../shared/audio'

// The part of the native addon that the controller uses.
export type Engine = {
  start(config?: StartConfig): Promise<StartResult>
  stop(): void
  playTestTone(frequencyHz?: number, seconds?: number): void
  listOutputs(): Promise<OutputDevice[]>
  status(): EngineStatus
}

// The piano part of the native addon. It is optional: an older addon without it still
// lets sound work, and the Sound screen says the piano part is missing.
export type MidiEngine = {
  startMidi(): void
  stopMidi(): void
  reconnectMidi(): void
  // Older addons do not report localControl; the controller then says 'unknown'.
  midiStatus(): Omit<MidiStatus, 'localControl'> & { localControl?: MidiStatus['localControl'] }
  onMidiEvent(callback: (events: MidiEvent[]) => void): void
}

// The piano sound part of the native addon. Also optional.
export type PianoEngine = {
  loadPiano(folder: string): Promise<{ samples: number; seconds: number }>
}

// The delay part of the native addon. Also optional: an older addon has none.
export type LatencyEngine = {
  latencySummary(): LatencySummary
  clearLatency(): void
}

// The volume and piano speaker part of the native addon. Also optional: an older addon has none.
export type MixEngine = {
  setVolume(volume: number): void
  setLocalControlOff(off: boolean): void
}

// The song player part of the native addon. Also optional. The sound of a song is made by the engine.
export type SongEngine = {
  playSong(events: SongEvent[], fromMs: number): void
  stopSong(): void
  songPosition(): number | null
}

export type FullEngine = Engine &
  Partial<MidiEngine> &
  Partial<PianoEngine> &
  Partial<LatencyEngine> &
  Partial<MixEngine> &
  Partial<SongEngine>

const missingOutputNote = 'Your saved sound output was not found, so the default output is used.'
const delayMissing = 'The delay part of the sound engine is not available.'
const delayUnreadable = 'The delay numbers could not be read.'

// Checks the numbers from the engine before the screen sees them.
function isLatencySummary(value: unknown): value is LatencySummary {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const numbers = ['count', 'medianMs', 'p95Ms', 'maxMs', 'outputMs', 'bufferFrames', 'sampleRate', 'underruns']
  return typeof v['backend'] === 'string' && numbers.every((key) => typeof v[key] === 'number' && Number.isFinite(v[key]))
}

function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// Keeps the last start result or error so the Sound screen can ask for it at any time.
// It never throws to its callers: every answer is data. It does no sound work itself.
export function createAudioController(source: { engine?: FullEngine; loadError?: string }) {
  const engine = source.engine
  const missing = source.loadError ?? 'The sound engine is not available.'
  const midiMissing = 'The piano part of the sound engine is not available.'
  const pianoMissing = 'The piano sound is not part of this sound engine.'
  // The sound output and the piano sound are separate: one can fail without the other.
  let current: Omit<AudioState, 'piano' | 'pianoError'> = { phase: 'off' }
  let piano: PianoSound = engine ? 'loading' : 'failed'
  let pianoError: string | undefined = engine ? undefined : missing
  let pianoLoading: Promise<void> | undefined
  // The start settings of the sound that is running now (set only when a start worked).
  let runningConfig: StartConfig | undefined
  // The start that is opening now, if any. Settings wait for it to settle.
  let pendingStart: Promise<AudioState> | undefined
  // The newest settings Bar wants, and the pass that is working towards them (if any).
  let wanted: SoundSettings | undefined
  let applying: Promise<AudioState> | undefined
  // Set by retry: the next settle step starts sound even when the running sound matches. Read once, then cleared.
  let forceRestart = false
  // Set when the saved output was not found and the default output is used. Cleared by the next settings change.
  let settingsNote: string | undefined

  const view = (): AudioState => {
    const base = settingsNote ? { ...current, settingsNote } : current
    return pianoError ? { ...base, piano, pianoError } : { ...base, piano }
  }

  // Forgets the remembered key timings. Never throws.
  const forgetDelays = (): void => {
    if (!engine || typeof engine.clearLatency !== 'function') return
    try {
      engine.clearLatency()
    } catch (error) {
      console.error('The delay numbers could not be cleared:', error)
    }
  }

  const latencySummary = (): LatencyReply => {
    if (!engine || typeof engine.latencySummary !== 'function') return { ok: false, error: delayMissing }
    try {
      const summary = engine.latencySummary()
      return isLatencySummary(summary) ? { ok: true, summary } : { ok: false, error: delayUnreadable }
    } catch (error) {
      return { ok: false, error: reason(error, delayUnreadable) }
    }
  }

  // Opens the sound output through the one start path. Clears the delays before and after.
  // A call while a start is opening returns that start's answer; the settings pass runs again after it.
  const start = (config: StartConfig): Promise<AudioState> => {
    if (current.phase === 'starting') return Promise.resolve(view())
    if (!engine) {
      current = { phase: 'failed', error: missing }
      return Promise.resolve(view())
    }
    current = { phase: 'starting' }
    runningConfig = undefined
    // A new start means new settings, so the old key timings must not mix in. The engine can
    // keep unread timings from the old session, so forget again once the start has settled.
    forgetDelays()
    const run = openSound(config)
    pendingStart = run
    void run.then(() => {
      if (pendingStart === run) pendingStart = undefined
    })
    return run
  }

  const openSound = async (config: StartConfig): Promise<AudioState> => {
    try {
      current = { phase: 'on', result: await engine!.start(config) }
      runningConfig = config
    } catch (error) {
      current = { phase: 'failed', error: reason(error, 'Sound could not start.') }
    }
    forgetDelays()
    return view()
  }

  // The output the saved settings name, or the default when that output is not listed.
  // Returns the note to show when it falls back. If the outputs cannot be listed, the saved one is tried.
  const configFor = async (settings: SoundSettings): Promise<{ config: StartConfig; note?: string }> => {
    const config = startConfigFor(settings)
    if (config.deviceId === undefined || !engine || typeof engine.listOutputs !== 'function') return { config }
    let outputs: OutputDevice[]
    try {
      outputs = await engine.listOutputs()
    } catch {
      return { config }
    }
    if (outputs.some((output) => output.id === config.deviceId)) return { config }
    const fallback: StartConfig = { backend: config.backend, bufferFrames: config.bufferFrames }
    return { config: fallback, note: missingOutputNote }
  }

  // Works towards the newest wanted settings until a finished start matches them. Only the
  // latest settings count: a change during a start means one more start, not a queue.
  const settlePass = async (): Promise<AudioState> => {
    let target: SoundSettings
    for (;;) {
      target = wanted as SoundSettings
      const { config, note } = await configFor(target)
      if (pendingStart) await pendingStart
      if (target !== wanted) continue
      settingsNote = note
      const force = forceRestart
      forceRestart = false
      if (force || current.phase !== 'on' || !sameStart(runningConfig, config)) {
        await start(config)
      }
      if (target === wanted && !forceRestart) break
    }
    setVolume(target.volume)
    setPianoSpeakers(target.pianoSpeakers)
    return view()
  }

  // Sets the volume on the engine. Never throws; it does not restart anything.
  const setVolume = (volume: number): void => {
    if (!engine || typeof engine.setVolume !== 'function') return
    try {
      engine.setVolume(volume)
    } catch (error) {
      console.error('The volume could not be set:', error)
    }
  }

  // Piano speakers on means Local Control off is false. Never throws.
  const setPianoSpeakers = (on: boolean): void => {
    if (!engine || typeof engine.setLocalControlOff !== 'function') return
    try {
      engine.setLocalControlOff(!on)
    } catch (error) {
      console.error('The piano speakers could not be set:', error)
    }
  }

  // Applies the saved settings. Sound restarts only when the output, mode or buffer differ from
  // the running sound (or no sound is on). Volume and the piano speakers apply once it settles.
  // Settings sent while a start is opening are not lost: the newest ones are applied after it.
  const applySettings = (next: SoundSettings): Promise<AudioState> => {
    wanted = next
    if (applying) return applying
    applying = settlePass().finally(() => {
      applying = undefined
    })
    return applying
  }

  const songMissing = 'The song player of the sound engine is not available.'

  // Stops the song and releases its notes. Never throws; nothing playing is not an error.
  const stopSong = (): SongReply => {
    if (!engine || typeof engine.stopSong !== 'function') return { ok: true }
    try {
      engine.stopSong()
    } catch (error) {
      console.error('The song did not stop cleanly:', error)
    }
    return { ok: true }
  }

  return {
    state(): AudioState {
      return view()
    },

    // Loads the piano sound from `folder`. It never throws and never touches the sound output:
    // if it fails, the simple tone keeps playing. A second call while loading waits for the first.
    loadPiano(folder: string): Promise<void> {
      if (pianoLoading) return pianoLoading
      if (!engine) return Promise.resolve()
      if (typeof engine.loadPiano !== 'function') {
        piano = 'failed'
        pianoError = pianoMissing
        return Promise.resolve()
      }
      piano = 'loading'
      pianoError = undefined
      pianoLoading = engine.loadPiano(folder).then(
        () => {
          piano = 'ready'
          pianoLoading = undefined
        },
        (error: unknown) => {
          piano = 'failed'
          pianoError = reason(error, 'The piano sound could not load.')
          pianoLoading = undefined
        }
      )
      return pianoLoading
    },

    start,

    applySettings,

    // Try again: starts sound with these settings even when they match the running sound
    // (a failed start, or a fallback mode). While a pass is running it only asks that pass for a
    // start: the pass already works towards the newest settings, which must not be replaced by older ones.
    retry(next: SoundSettings): Promise<AudioState> {
      forceRestart = true
      if (applying) return applying
      return applySettings(next)
    },

    setVolume,
    setPianoSpeakers,

    stop(): void {
      if (!engine) return
      stopSong()
      try {
        engine.stop()
      } catch (error) {
        console.error('Sound did not stop cleanly:', error)
      }
      current = { phase: 'off' }
      runningConfig = undefined
    },

    testTone(args: ToneArgs): TestToneReply {
      if (!engine || current.phase !== 'on') return { ok: false, error: 'Sound is not on yet.' }
      try {
        engine.playTestTone(args.frequencyHz, args.seconds)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: reason(error, 'The test sound could not play.') }
      }
    },

    async listOutputs(): Promise<ListOutputsReply> {
      if (!engine) return { ok: false, error: missing }
      try {
        return { ok: true, outputs: await engine.listOutputs() }
      } catch (error) {
        return { ok: false, error: reason(error, 'The sound outputs could not be listed.') }
      }
    },

    status(): StatusReply {
      if (!engine) return { ok: false, error: missing }
      try {
        return { ok: true, status: engine.status() }
      } catch (error) {
        return { ok: false, error: reason(error, 'The sound status could not be read.') }
      }
    },

    // Starts the piano watcher and sends each batch of key events to `onBatch`.
    // The callback runs on the main process; a throw in `onBatch` is caught here.
    startMidi(onBatch: (events: MidiEvent[]) => void): void {
      if (!engine || typeof engine.startMidi !== 'function' || typeof engine.onMidiEvent !== 'function') return
      try {
        engine.startMidi()
        engine.onMidiEvent((events) => {
          try {
            onBatch(events)
          } catch (error) {
            console.error('A piano event could not be passed on:', error)
          }
        })
      } catch (error) {
        console.error('The piano could not be started:', error)
      }
    },

    stopMidi(): void {
      if (!engine || typeof engine.stopMidi !== 'function') return
      try {
        engine.stopMidi()
      } catch (error) {
        console.error('The piano did not stop cleanly:', error)
      }
    },

    midiStatus(): MidiStatusReply {
      if (!engine || typeof engine.midiStatus !== 'function') return { ok: false, error: midiMissing }
      try {
        const status = engine.midiStatus()
        return { ok: true, status: { ...status, localControl: status.localControl ?? 'unknown' } }
      } catch (error) {
        return { ok: false, error: reason(error, 'The piano status could not be read.') }
      }
    },

    reconnectMidi(): MidiReconnectReply {
      if (!engine || typeof engine.reconnectMidi !== 'function') return { ok: false, error: midiMissing }
      try {
        engine.reconnectMidi()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: reason(error, 'The piano could not be reconnected.') }
      }
    },

    // Listen mode. The engine plays the song; these only start it, stop it and read where it is.
    // The events were checked in the main process before they got here.
    playSong(events: SongEvent[], fromMs: number): SongReply {
      if (!engine || current.phase !== 'on') return { ok: false, error: 'Sound is not on yet.' }
      if (typeof engine.playSong !== 'function') return { ok: false, error: songMissing }
      try {
        engine.playSong(events, fromMs)
        return { ok: true }
      } catch (error) {
        return { ok: false, error: reason(error, 'The song could not start.') }
      }
    },

    stopSong,

    // Where the song is, in ms, or null when none plays.
    songPosition(): SongPositionReply {
      if (!engine) return { ok: false, error: missing }
      if (typeof engine.songPosition !== 'function') return { ok: false, error: songMissing }
      try {
        const positionMs = engine.songPosition()
        if (positionMs === null || (typeof positionMs === 'number' && Number.isFinite(positionMs))) {
          return { ok: true, positionMs }
        }
        return { ok: false, error: 'The song position could not be read.' }
      } catch (error) {
        return { ok: false, error: reason(error, 'The song position could not be read.') }
      }
    },

    // The delay test: the numbers so far, and a way to forget them.
    latencySummary,

    clearLatency(): LatencyClearReply {
      if (!engine || typeof engine.clearLatency !== 'function') return { ok: false, error: delayMissing }
      try {
        engine.clearLatency()
        return { ok: true }
      } catch (error) {
        return { ok: false, error: reason(error, 'The delay numbers could not be cleared.') }
      }
    },

    // The report text and JSON for the numbers now. Writing the files is the main process's job.
    latencyReport(now: Date): LatencyReportReply {
      const result = latencySummary()
      if (!result.ok) return result
      return { ok: true, text: reportText(result.summary, now), json: reportJson(result.summary, now) }
    }
  }
}

// Two start configs are the same sound when output, mode and buffer match.
function sameStart(a: StartConfig | undefined, b: StartConfig): boolean {
  return a !== undefined && a.deviceId === b.deviceId && a.backend === b.backend && a.bufferFrames === b.bufferFrames
}

export type AudioController = ReturnType<typeof createAudioController>

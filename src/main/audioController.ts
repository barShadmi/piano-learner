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

export type FullEngine = Engine & Partial<MidiEngine> & Partial<PianoEngine>

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

  const view = (): AudioState => (pianoError ? { ...current, piano, pianoError } : { ...current, piano })

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

    async start(config: StartConfig): Promise<AudioState> {
      if (current.phase === 'starting') return view()
      if (!engine) {
        current = { phase: 'failed', error: missing }
        return view()
      }
      current = { phase: 'starting' }
      try {
        current = { phase: 'on', result: await engine.start(config) }
      } catch (error) {
        current = { phase: 'failed', error: reason(error, 'Sound could not start.') }
      }
      return view()
    },

    stop(): void {
      if (!engine) return
      try {
        engine.stop()
      } catch (error) {
        console.error('Sound did not stop cleanly:', error)
      }
      current = { phase: 'off' }
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
    }
  }
}

export type AudioController = ReturnType<typeof createAudioController>

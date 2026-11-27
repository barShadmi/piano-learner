import type {
  AudioState,
  EngineStatus,
  ListOutputsReply,
  OutputDevice,
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

function reason(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

// Keeps the last start result or error so the Sound screen can ask for it at any time.
// It never throws to its callers: every answer is data. It does no sound work itself.
export function createAudioController(source: { engine?: Engine; loadError?: string }) {
  const engine = source.engine
  const missing = source.loadError ?? 'The sound engine is not available.'
  let current: AudioState = { phase: 'off' }

  return {
    state(): AudioState {
      return current
    },

    async start(config: StartConfig): Promise<AudioState> {
      if (current.phase === 'starting') return current
      if (!engine) {
        current = { phase: 'failed', error: missing }
        return current
      }
      current = { phase: 'starting' }
      try {
        current = { phase: 'on', result: await engine.start(config) }
      } catch (error) {
        current = { phase: 'failed', error: reason(error, 'Sound could not start.') }
      }
      return current
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
    }
  }
}

export type AudioController = ReturnType<typeof createAudioController>

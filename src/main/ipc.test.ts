import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../shared/settings'
import { createAudioController, type Engine } from './audioController'
import { registerAudioIpc } from './ipc'

// Records the handlers that ipc.ts registers, so a test can call them the way the renderer does.
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  app: { getPath: () => '' },
  shell: {},
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }
  }
}))

const fakeEngine: Engine = {
  start: async () => ({
    backend: 'wasapi-exclusive',
    deviceName: 'Headphones',
    sampleRate: 48000,
    bufferFrames: 128,
    outputLatencyMs: 2.7
  }),
  stop() {},
  playTestTone() {},
  listOutputs: async () => [],
  status: () => ({
    running: true,
    failed: false,
    sampleRate: 48000,
    bufferFrames: 128,
    callbacks: 1,
    underruns: 0,
    measuredLatencyMs: 0
  })
}

describe('audio:start', () => {
  beforeEach(() => {
    handlers.clear()
  })

  it('answers a refused start with a full AudioState, including the piano field', async () => {
    const audio = createAudioController({ engine: fakeEngine })
    registerAudioIpc(audio, () => defaultSettings(process.platform))
    const handler = handlers.get('audio:start')
    expect(handler).toBeDefined()

    // A bad start config (volume is not a start setting) is refused before the engine is called.
    const reply = await handler!({}, { volume: 1 })

    expect(reply).toEqual({ phase: 'failed', error: expect.any(String), piano: audio.state().piano })
  })
})

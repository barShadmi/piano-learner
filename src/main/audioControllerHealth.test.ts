import { describe, expect, it } from 'vitest'
import { createAudioController, type Engine } from './audioController'
import type { EngineStatus, StartConfig, StartResult } from '../shared/audio'
import type { SoundSettings } from '../shared/settings'

const goodResult: StartResult = {
  backend: 'wasapi-exclusive',
  deviceName: 'Headphones',
  sampleRate: 48000,
  bufferFrames: 512,
  outputLatencyMs: 2.7
}

const settings: SoundSettings = {
  backend: 'wasapi-exclusive',
  bufferFrames: 512,
  volume: 0.8,
  pianoSpeakers: false
}

const okStatus: EngineStatus = {
  running: true,
  failed: false,
  sampleRate: 48000,
  bufferFrames: 512,
  callbacks: 5,
  underruns: 0,
  measuredLatencyMs: 0
}
const failedStatus: EngineStatus = { ...okStatus, running: false, failed: true, underruns: 2 }

// An engine that stalls on demand. `stalled` is what status().failed reports; every start clears
// it, unless `stallAfterStart` is set (the device stalls again after each reopen). The first
// `startsThatFail` starts after the first one are refused.
function stallingEngine(opts: { stalled?: boolean; stallAfterStart?: boolean; startsThatFail?: number } = {}) {
  const starts: StartConfig[] = []
  const state = { stalled: opts.stalled ?? false, clears: 0 }
  const engine: Engine & { clearLatency(): void } = {
    start: async (config?: StartConfig) => {
      starts.push(config ?? {})
      if (starts.length > 1 && starts.length - 1 <= (opts.startsThatFail ?? 0)) throw new Error('Device busy.')
      state.stalled = opts.stallAfterStart ?? false
      return goodResult
    },
    stop() {},
    playTestTone() {},
    listOutputs: async () => [],
    status: () => (state.stalled ? failedStatus : okStatus),
    clearLatency() {
      state.clears++
    }
  }
  return { engine, starts, state }
}

describe('createAudioController launch', () => {
  it('says starting, not off, while the launch waits for the piano', () => {
    const { engine } = stallingEngine()
    const c = createAudioController({ engine })
    c.setLaunching(true)
    expect(c.state().phase).toBe('starting')
    c.setLaunching(false)
    expect(c.state().phase).toBe('off')
  })
})

describe('createAudioController stalled output', () => {
  const backoff = { restartBackoffMs: [0, 0, 0] }

  it('restarts the output by itself with the same settings when the device stalls', async () => {
    const { engine, starts, state } = stallingEngine()
    const c = createAudioController({ engine }, backoff)
    await c.applySettings(settings)
    state.stalled = true
    await c.checkHealth()
    expect(starts).toHaveLength(2)
    expect(starts[1]).toEqual(starts[0])
    expect(c.state().phase).toBe('on')
  })

  it('leaves a healthy output alone', async () => {
    const { engine, starts } = stallingEngine()
    const c = createAudioController({ engine }, backoff)
    await c.applySettings(settings)
    await c.checkHealth()
    expect(starts).toHaveLength(1)
  })

  it('tries at most three times, then shows the failure', async () => {
    const { engine, starts, state } = stallingEngine({ startsThatFail: 99 })
    const c = createAudioController({ engine }, backoff)
    await c.applySettings(settings)
    state.stalled = true
    await c.checkHealth()
    expect(starts).toHaveLength(4)
    expect(c.state()).toMatchObject({ phase: 'failed', error: 'Device busy.' })
  })

  it('reopens with the settings Bar has now when he changes Mode during the wait', async () => {
    const { engine, starts, state } = stallingEngine()
    const c = createAudioController({ engine }, { restartBackoffMs: [40] })
    await c.applySettings(settings)
    state.stalled = true
    const checking = c.checkHealth()
    await c.applySettings({ ...settings, backend: 'wasapi-shared' })
    await checking
    expect(starts.at(-1)?.backend).toBe('wasapi-shared')
    expect(c.state().phase).toBe('on')
  })

  it('shows a failure with a reason when the device stalls again after every restart', async () => {
    const { engine, starts, state } = stallingEngine({ stallAfterStart: true })
    const c = createAudioController({ engine }, backoff)
    await c.applySettings(settings)
    state.stalled = true
    await c.checkHealth()
    expect(starts).toHaveLength(4)
    expect(c.state()).toMatchObject({
      phase: 'failed',
      error: 'The sound device stopped responding. Press Try again, or set Mode to Shared with other apps.'
    })
  })

  it('keeps the delay numbers when it restarts by itself', async () => {
    const { engine, state } = stallingEngine()
    const c = createAudioController({ engine }, backoff)
    await c.applySettings(settings)
    const before = state.clears
    state.stalled = true
    await c.checkHealth()
    expect(state.clears).toBe(before)
  })
})

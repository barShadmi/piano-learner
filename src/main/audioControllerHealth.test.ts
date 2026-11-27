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

// An engine whose first `failedChecks` status answers say the device stalled.
// After the first start, the next `startsThatFail` starts are refused.
function stallingEngine(failedChecks: number, startsThatFail = 0) {
  const starts: StartConfig[] = []
  let checks = 0
  const engine: Engine = {
    start: async (config?: StartConfig) => {
      starts.push(config ?? {})
      if (starts.length > 1 && starts.length - 1 <= startsThatFail) throw new Error('Device busy.')
      return goodResult
    },
    stop() {},
    playTestTone() {},
    listOutputs: async () => [],
    status: () => {
      checks++
      return checks <= failedChecks ? failedStatus : okStatus
    }
  }
  return { engine, starts }
}

describe('createAudioController launch', () => {
  it('says starting, not off, while the launch waits for the piano', () => {
    const { engine } = stallingEngine(0)
    const c = createAudioController({ engine })
    c.setLaunching(true)
    expect(c.state().phase).toBe('starting')
    c.setLaunching(false)
    expect(c.state().phase).toBe('off')
  })
})

describe('createAudioController stalled output', () => {
  it('restarts the output by itself with the same settings when the device stalls', async () => {
    const { engine, starts } = stallingEngine(1)
    const c = createAudioController({ engine }, { restartBackoffMs: [0, 0, 0] })
    await c.applySettings(settings)
    await c.checkHealth()
    expect(starts).toHaveLength(2)
    expect(starts[1]).toEqual(starts[0])
    expect(c.state().phase).toBe('on')
  })

  it('leaves a healthy output alone', async () => {
    const { engine, starts } = stallingEngine(0)
    const c = createAudioController({ engine }, { restartBackoffMs: [0, 0, 0] })
    await c.applySettings(settings)
    await c.checkHealth()
    expect(starts).toHaveLength(1)
  })

  it('tries at most three times, then shows the failure', async () => {
    const { engine, starts } = stallingEngine(99, 99)
    const c = createAudioController({ engine }, { restartBackoffMs: [0, 0, 0] })
    await c.applySettings(settings)
    await c.checkHealth()
    expect(starts).toHaveLength(4)
    expect(c.state()).toMatchObject({ phase: 'failed', error: 'Device busy.' })
  })
})

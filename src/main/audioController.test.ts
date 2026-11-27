import { describe, expect, it } from 'vitest'
import { createAudioController, type Engine } from './audioController'
import type { StartResult } from '../shared/audio'

const goodResult: StartResult = {
  backend: 'wasapi-exclusive',
  deviceName: 'Headphones',
  sampleRate: 48000,
  bufferFrames: 128,
  outputLatencyMs: 2.7
}

function fakeEngine(over: Partial<Engine> = {}): Engine & { toneCalls: number; stopCalls: number } {
  const engine = {
    toneCalls: 0,
    stopCalls: 0,
    start: async () => goodResult,
    stop() {
      engine.stopCalls++
    },
    playTestTone() {
      engine.toneCalls++
    },
    listOutputs: async () => [],
    status: () => ({
      running: true,
      failed: false,
      sampleRate: 48000,
      bufferFrames: 128,
      callbacks: 1,
      underruns: 0,
      measuredLatencyMs: 0
    }),
    ...over
  }
  return engine
}

describe('createAudioController', () => {
  it('begins off', () => {
    const c = createAudioController({ engine: fakeEngine() })
    expect(c.state()).toEqual({ phase: 'off' })
  })

  it('is starting while the engine opens, then on with the result', async () => {
    let release: (r: StartResult) => void = () => {}
    const c = createAudioController({
      engine: fakeEngine({ start: () => new Promise<StartResult>((r) => (release = r)) })
    })
    const pending = c.start({})
    expect(c.state().phase).toBe('starting')
    release(goodResult)
    expect(await pending).toEqual({ phase: 'on', result: goodResult })
    expect(c.state()).toEqual({ phase: 'on', result: goodResult })
  })

  it('is failed with the reason when the engine rejects', async () => {
    const c = createAudioController({
      engine: fakeEngine({ start: async () => Promise.reject(new Error('No sound card found.')) })
    })
    expect(await c.start({})).toEqual({ phase: 'failed', error: 'No sound card found.' })
  })

  it('is failed with the load error when the engine is missing', async () => {
    const c = createAudioController({ loadError: 'The sound engine file is missing.' })
    expect(await c.start({})).toEqual({
      phase: 'failed',
      error: 'The sound engine file is missing.'
    })
  })

  it('does not start a second time while one is opening', async () => {
    let starts = 0
    let release: (r: StartResult) => void = () => {}
    const c = createAudioController({
      engine: fakeEngine({
        start: () => {
          starts++
          return new Promise<StartResult>((r) => (release = r))
        }
      })
    })
    const first = c.start({})
    const second = await c.start({})
    expect(second.phase).toBe('starting')
    expect(starts).toBe(1)
    release(goodResult)
    await first
  })

  it('can try again after a failure', async () => {
    let attempt = 0
    const c = createAudioController({
      engine: fakeEngine({
        start: async () => {
          attempt++
          if (attempt === 1) throw new Error('Device busy.')
          return goodResult
        }
      })
    })
    expect((await c.start({})).phase).toBe('failed')
    expect((await c.start({})).phase).toBe('on')
  })

  it('plays the test tone only when sound is on', async () => {
    const engine = fakeEngine()
    const c = createAudioController({ engine })
    expect(c.testTone({})).toEqual({ ok: false, error: 'Sound is not on yet.' })
    expect(engine.toneCalls).toBe(0)
    await c.start({})
    expect(c.testTone({})).toEqual({ ok: true })
    expect(engine.toneCalls).toBe(1)
  })

  it('turns an engine error from the tone into a plain reply', async () => {
    const c = createAudioController({
      engine: fakeEngine({
        playTestTone: () => {
          throw new Error('Sound is not running.')
        }
      })
    })
    await c.start({})
    expect(c.testTone({})).toEqual({ ok: false, error: 'Sound is not running.' })
  })

  it('stops the engine and goes off', async () => {
    const engine = fakeEngine()
    const c = createAudioController({ engine })
    await c.start({})
    c.stop()
    expect(engine.stopCalls).toBe(1)
    expect(c.state()).toEqual({ phase: 'off' })
  })

  it('does not throw when stopping without an engine', () => {
    const c = createAudioController({ loadError: 'x' })
    expect(() => c.stop()).not.toThrow()
  })

  it('answers list and status with replies, never by throwing', async () => {
    const none = createAudioController({ loadError: 'No engine.' })
    expect(await none.listOutputs()).toEqual({ ok: false, error: 'No engine.' })
    expect(none.status()).toEqual({ ok: false, error: 'No engine.' })

    const c = createAudioController({
      engine: fakeEngine({
        listOutputs: async () => Promise.reject(new Error('Could not list.')),
        status: () => {
          throw new Error('Broken.')
        }
      })
    })
    expect(await c.listOutputs()).toEqual({ ok: false, error: 'Could not list.' })
    expect(c.status()).toEqual({ ok: false, error: 'Broken.' })
  })
})

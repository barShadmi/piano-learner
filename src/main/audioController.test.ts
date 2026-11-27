import { describe, expect, it } from 'vitest'
import { createAudioController, type Engine, type MidiEngine } from './audioController'
import type { MidiEvent, MidiStatus, StartResult } from '../shared/audio'
import type { PianoEngine, LatencyEngine } from './audioController'
import type { LatencySummary } from '../shared/latency'

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
    expect(c.state()).toEqual({ phase: 'off', piano: 'loading' })
  })

  it('is starting while the engine opens, then on with the result', async () => {
    let release: (r: StartResult) => void = () => {}
    const c = createAudioController({
      engine: fakeEngine({ start: () => new Promise<StartResult>((r) => (release = r)) })
    })
    const pending = c.start({})
    expect(c.state().phase).toBe('starting')
    release(goodResult)
    expect(await pending).toEqual({ phase: 'on', result: goodResult, piano: 'loading' })
    expect(c.state()).toEqual({ phase: 'on', result: goodResult, piano: 'loading' })
  })

  it('is failed with the reason when the engine rejects', async () => {
    const c = createAudioController({
      engine: fakeEngine({ start: async () => Promise.reject(new Error('No sound card found.')) })
    })
    expect(await c.start({})).toEqual({
      phase: 'failed',
      error: 'No sound card found.',
      piano: 'loading'
    })
  })

  it('is failed with the load error when the engine is missing', async () => {
    const c = createAudioController({ loadError: 'The sound engine file is missing.' })
    expect(await c.start({})).toMatchObject({
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
    expect(c.state()).toEqual({ phase: 'off', piano: 'loading' })
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

const idle: MidiStatus = {
  connected: false,
  events: 0,
  droppedSound: 0,
  droppedScreen: 0,
  localControl: 'unknown'
}

function fakeMidi(over: Partial<MidiEngine> = {}) {
  const midi = {
    started: 0,
    stopped: 0,
    reconnects: 0,
    callback: undefined as undefined | ((events: MidiEvent[]) => void),
    startMidi() {
      midi.started++
    },
    stopMidi() {
      midi.stopped++
      midi.callback = undefined
    },
    reconnectMidi() {
      midi.reconnects++
    },
    midiStatus: (): MidiStatus => idle,
    onMidiEvent(cb: (events: MidiEvent[]) => void) {
      midi.callback = cb
    },
    ...over
  }
  return midi
}

const keyDown: MidiEvent = { kind: 'on', note: 60, velocity: 64, timeUs: 10 }

describe('createAudioController piano (MIDI)', () => {
  it('answers the piano status from the engine', () => {
    const c = createAudioController({ engine: { ...fakeEngine(), ...fakeMidi() } })
    expect(c.midiStatus()).toEqual({ ok: true, status: idle })
  })

  it('says the piano part is missing when the engine has none', () => {
    const c = createAudioController({ engine: fakeEngine() })
    expect(c.midiStatus()).toEqual({ ok: false, error: expect.any(String) })
    expect(c.reconnectMidi()).toEqual({ ok: false, error: expect.any(String) })
    expect(() => c.startMidi(() => {})).not.toThrow()
    expect(() => c.stopMidi()).not.toThrow()
  })

  it('starts the piano and sends each batch of key events to the caller, in order', () => {
    const midi = fakeMidi()
    const c = createAudioController({ engine: { ...fakeEngine(), ...midi } })
    const received: MidiEvent[] = []
    c.startMidi((batch) => received.push(...batch))
    expect(midi.started).toBe(1)
    const up: MidiEvent = { kind: 'off', note: 60, velocity: 0, timeUs: 20 }
    midi.callback?.([keyDown, up])
    expect(received).toEqual([keyDown, up])
  })

  it('never lets an error from the caller reach the piano side', () => {
    const midi = fakeMidi()
    const c = createAudioController({ engine: { ...fakeEngine(), ...midi } })
    c.startMidi(() => {
      throw new Error('Screen gone.')
    })
    expect(() => midi.callback?.([keyDown])).not.toThrow()
  })

  it('stops the piano and lets go of the callback', () => {
    const midi = fakeMidi()
    const c = createAudioController({ engine: { ...fakeEngine(), ...midi } })
    c.startMidi(() => {})
    c.stopMidi()
    expect(midi.stopped).toBe(1)
    expect(midi.callback).toBeUndefined()
  })

  it('passes on whether the piano speakers are off, as the engine reports it', () => {
    const off: MidiStatus = { ...idle, connected: true, portName: 'P-121', localControl: 'off' }
    const c = createAudioController({ engine: { ...fakeEngine(), ...fakeMidi({ midiStatus: () => off }) } })
    expect(c.midiStatus()).toEqual({ ok: true, status: off })
  })

  it('says unknown when an older engine does not report Local Control', () => {
    const older = { connected: true, portName: 'P-121', events: 0, droppedSound: 0, droppedScreen: 0 } as MidiStatus
    const c = createAudioController({ engine: { ...fakeEngine(), ...fakeMidi({ midiStatus: () => older }) } })
    expect(c.midiStatus()).toEqual({ ok: true, status: { ...older, localControl: 'unknown' } })
  })

  it('asks the engine to reconnect and says ok', () => {
    const midi = fakeMidi()
    const c = createAudioController({ engine: { ...fakeEngine(), ...midi } })
    expect(c.reconnectMidi()).toEqual({ ok: true })
    expect(midi.reconnects).toBe(1)
  })

  it('turns an error from the piano side into a plain reply', () => {
    const c = createAudioController({
      engine: {
        ...fakeEngine(),
        ...fakeMidi({
          midiStatus: () => {
            throw new Error('Broken.')
          }
        })
      }
    })
    expect(c.midiStatus()).toEqual({ ok: false, error: 'Broken.' })
  })
})

function fakePiano(over: Partial<PianoEngine> = {}) {
  const piano = {
    folders: [] as string[],
    loadPiano: async (folder: string) => {
      piano.folders.push(folder)
      return { samples: 120, seconds: 1.5 }
    },
    ...over
  }
  return piano
}

describe('createAudioController piano sound', () => {
  it('says loading until the piano sound has loaded, then ready', async () => {
    let release: () => void = () => {}
    const piano = fakePiano({
      loadPiano: () =>
        new Promise((resolve) => {
          release = () => resolve({ samples: 120, seconds: 1 })
        })
    })
    const c = createAudioController({ engine: { ...fakeEngine(), ...piano } })
    const pending = c.loadPiano('/songs/piano')
    expect(c.state().piano).toBe('loading')
    release()
    await pending
    expect(c.state()).toEqual({ phase: 'off', piano: 'ready' })
  })

  it('loads from the folder it is given', async () => {
    const piano = fakePiano()
    const c = createAudioController({ engine: { ...fakeEngine(), ...piano } })
    await c.loadPiano('/songs/piano')
    expect(piano.folders).toEqual(['/songs/piano'])
  })

  it('is failed with the reason when loading fails, and sound is not affected', async () => {
    const piano = fakePiano({ loadPiano: async () => Promise.reject(new Error('No piano sounds found.')) })
    const c = createAudioController({ engine: { ...fakeEngine(), ...piano } })
    await c.start({})
    await c.loadPiano('/nowhere')
    expect(c.state()).toEqual({
      phase: 'on',
      result: goodResult,
      piano: 'failed',
      pianoError: 'No piano sounds found.'
    })
  })

  it('keeps the piano answer when sound starts or stops afterwards', async () => {
    const c = createAudioController({ engine: { ...fakeEngine(), ...fakePiano() } })
    await c.loadPiano('/p')
    expect(await c.start({})).toMatchObject({ phase: 'on', piano: 'ready' })
    c.stop()
    expect(c.state()).toEqual({ phase: 'off', piano: 'ready' })
  })

  it('asks the engine once when told twice while loading', async () => {
    let release: () => void = () => {}
    let calls = 0
    const piano = fakePiano({
      loadPiano: () => {
        calls++
        return new Promise((resolve) => {
          release = () => resolve({ samples: 120, seconds: 1 })
        })
      }
    })
    const c = createAudioController({ engine: { ...fakeEngine(), ...piano } })
    const first = c.loadPiano('/p')
    const second = c.loadPiano('/p')
    release()
    await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(c.state().piano).toBe('ready')
  })

  it('says plainly that the piano sound is missing when the engine is old', async () => {
    const c = createAudioController({ engine: fakeEngine() })
    await c.loadPiano('/p')
    expect(c.state()).toMatchObject({ piano: 'failed', pianoError: expect.stringMatching(/\.$/) })
  })

  it('says failed when there is no engine at all', async () => {
    const c = createAudioController({ loadError: 'The sound engine file is missing.' })
    expect(c.state().piano).toBe('failed')
    await expect(c.loadPiano('/p')).resolves.toBeUndefined()
    expect(c.state().pianoError).toMatch(/\.$/)
  })
})

const summary: LatencySummary = {
  count: 20,
  medianMs: 4.2,
  p95Ms: 5.1,
  maxMs: 6,
  outputMs: 2.7,
  bufferFrames: 128,
  sampleRate: 48000,
  backend: 'wasapi-exclusive',
  underruns: 0
}

function fakeLatency(over: Partial<LatencyEngine> = {}) {
  const latency = {
    clears: 0,
    summaryCalls: 0,
    latencySummary: (): LatencySummary => {
      latency.summaryCalls++
      return summary
    },
    clearLatency() {
      latency.clears++
    },
    ...over
  }
  return latency
}

describe('createAudioController delay test', () => {
  it('answers the delay summary from the engine', () => {
    const c = createAudioController({ engine: { ...fakeEngine(), ...fakeLatency() } })
    expect(c.latencySummary()).toEqual({ ok: true, summary: summary })
  })

  it('says the delay part is missing when the engine has none', () => {
    const c = createAudioController({ engine: fakeEngine() })
    expect(c.latencySummary()).toEqual({ ok: false, error: expect.any(String) })
    expect(c.clearLatency()).toEqual({ ok: false, error: expect.any(String) })
  })

  it('refuses a summary with a number that is not a number, in plain words', () => {
    const c = createAudioController({
      engine: { ...fakeEngine(), ...fakeLatency({ latencySummary: () => ({ ...summary, p95Ms: Number.NaN }) }) }
    })
    expect(c.latencySummary()).toEqual({ ok: false, error: 'The delay numbers could not be read.' })
  })

  it('turns an error from the engine into a plain reply', () => {
    const c = createAudioController({
      engine: {
        ...fakeEngine(),
        ...fakeLatency({
          latencySummary: () => {
            throw new Error('Broken.')
          }
        })
      }
    })
    expect(c.latencySummary()).toEqual({ ok: false, error: 'Broken.' })
  })

  it('clears the remembered delays when the engine is asked to', () => {
    const latency = fakeLatency()
    const c = createAudioController({ engine: { ...fakeEngine(), ...latency } })
    expect(c.clearLatency()).toEqual({ ok: true })
    expect(latency.clears).toBe(1)
  })

  it('clears the remembered delays before and after every start, so no report mixes two settings', async () => {
    const order: string[] = []
    const engine = {
      ...fakeEngine({
        start: async () => {
          order.push('start')
          return goodResult
        }
      }),
      ...fakeLatency({
        clearLatency() {
          order.push('clear')
        }
      })
    }
    const c = createAudioController({ engine })
    await c.start({})
    expect(order).toEqual(['clear', 'start', 'clear'])
  })

  it('clears the remembered delays after a start that fails too', async () => {
    const order: string[] = []
    const engine = {
      ...fakeEngine({
        start: async () => {
          order.push('start')
          throw new Error('Device busy.')
        }
      }),
      ...fakeLatency({
        clearLatency() {
          order.push('clear')
        }
      })
    }
    const c = createAudioController({ engine })
    expect((await c.start({})).phase).toBe('failed')
    expect(order).toEqual(['clear', 'start', 'clear'])
  })

  it('still starts sound when the delay part is missing', async () => {
    const c = createAudioController({ engine: fakeEngine() })
    expect(await c.start({})).toMatchObject({ phase: 'on' })
  })

  it('builds the report text and JSON from the summary, saved at the given time', () => {
    const now = new Date('2026-11-27T13:50:00.000Z')
    const c = createAudioController({ engine: { ...fakeEngine(), ...fakeLatency() } })
    const report = c.latencyReport(now)
    expect(report).toEqual({ ok: true, text: expect.any(String), json: expect.any(String) })
    if (!report.ok) throw new Error('expected a report')
    expect(report.text).toContain('About 4.2 ms from key to sound')
    expect(JSON.parse(report.json)).toMatchObject({ savedAt: '2026-11-27T13:50:00.000Z', verdict: 'good' })
  })

  it('does not write a report when there is no delay part', () => {
    const c = createAudioController({ engine: fakeEngine() })
    expect(c.latencyReport(new Date())).toEqual({ ok: false, error: expect.any(String) })
  })
})

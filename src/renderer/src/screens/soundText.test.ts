import { describe, expect, it } from 'vitest'
import {
  backendWords,
  lastKeyLine,
  latestKeyDown,
  LOCAL_CONTROL_TIP,
  localControlLine,
  noteName,
  pianoLine,
  pianoProblem,
  pianoSoundLine,
  PIANO_SOUND_CREDIT,
  statusLine
} from './soundText'

describe('backendWords', () => {
  it('uses plain words for each way of playing', () => {
    expect(backendWords('wasapi-exclusive')).toBe('exclusive mode')
    expect(backendWords('wasapi-shared')).toBe('shared mode')
    expect(backendWords('asio')).toBe('ASIO')
    expect(backendWords('cpal')).toBe('standard mode')
    expect(backendWords('mystery')).toBe('mystery')
  })
})

describe('statusLine', () => {
  it('says what is happening for each phase', () => {
    expect(statusLine({ phase: 'starting', piano: 'loading' })).toBe('Starting sound…')
    expect(statusLine({ phase: 'off', piano: 'loading' })).toBe('Sound is off.')
    expect(statusLine({ phase: 'failed', error: 'No sound card.', piano: 'loading' })).toBe('Sound could not start.')
  })

  it('describes the device, mode, buffer and delay when on', () => {
    expect(
      statusLine({
        phase: 'on',
        piano: 'ready',
        result: {
          backend: 'wasapi-exclusive',
          deviceName: 'Headphones (Realtek)',
          sampleRate: 48000,
          bufferFrames: 128,
          outputLatencyMs: 2.66
        }
      })
    ).toBe('Sound is on. Headphones (Realtek), exclusive mode, 128 samples, about 2.7 ms.')
  })

  it('does not claim a delay when it is not known', () => {
    expect(
      statusLine({
        phase: 'on',
        piano: 'ready',
        result: {
          backend: 'cpal',
          deviceName: 'Speakers',
          sampleRate: 48000,
          bufferFrames: 256,
          outputLatencyMs: 0
        }
      })
    ).toBe('Sound is on. Speakers, standard mode, 256 samples.')
  })
})

describe('noteName', () => {
  it('gives the note name and octave for a key number', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(61)).toBe('C#4')
    expect(noteName(21)).toBe('A0')
    expect(noteName(108)).toBe('C8')
  })

  it('says ? for a number that is not a MIDI note', () => {
    expect(noteName(128)).toBe('?')
    expect(noteName(-1)).toBe('?')
  })
})

const piano = { connected: false, events: 0, droppedSound: 0, droppedScreen: 0, localControl: 'unknown' as const }

describe('pianoLine', () => {
  it('says the piano is connected and names it', () => {
    expect(
      pianoLine({ ok: true, status: { ...piano, connected: true, portName: 'Digital Piano' } })
    ).toBe('Piano connected: Digital Piano')
  })

  it('asks Bar to check the piano when none is found', () => {
    expect(pianoLine({ ok: true, status: piano })).toBe(
      'No piano found. Check that the piano is on and the USB cable is plugged in.'
    )
  })

  it('says it is still looking before the first answer, and that it cannot check', () => {
    expect(pianoLine(undefined)).toBe('Looking for the piano…')
    expect(pianoLine({ ok: false, error: 'No engine.' })).toBe('The piano could not be checked.')
  })
})

describe('pianoProblem', () => {
  it('passes on the reason the piano could not be opened', () => {
    expect(
      pianoProblem({ ok: true, status: { ...piano, error: 'The piano port is busy.' } })
    ).toBe('The piano port is busy.')
  })

  it('passes on a reply error, and is empty when there is no problem', () => {
    expect(pianoProblem({ ok: false, error: 'No engine.' })).toBe('No engine.')
    expect(pianoProblem({ ok: true, status: piano })).toBeUndefined()
  })
})

describe('latestKeyDown', () => {
  it('takes the last key pressed down in a batch, ignoring key releases', () => {
    const on60 = { kind: 'on', note: 60, velocity: 64, timeUs: 1 } as const
    const on62 = { kind: 'on', note: 62, velocity: 90, timeUs: 2 } as const
    const off62 = { kind: 'off', note: 62, velocity: 0, timeUs: 3 } as const
    expect(latestKeyDown([on60, off62, on62])).toEqual(on62)
    expect(latestKeyDown([off62])).toBeUndefined()
  })
})

describe('lastKeyLine', () => {
  it('says which key was played and how loud', () => {
    expect(lastKeyLine({ kind: 'on', note: 60, velocity: 64, timeUs: 1 })).toBe(
      'Last key: C4, loudness 64 of 127'
    )
  })

  it('is empty before any key is played', () => {
    expect(lastKeyLine(undefined)).toBe('')
  })
})

describe('pianoSoundLine', () => {
  it('says the piano sound is loading, ready, or could not load', () => {
    expect(pianoSoundLine('loading')).toBe('Piano sound is loading…')
    expect(pianoSoundLine('ready')).toBe('Piano sound is ready.')
    expect(pianoSoundLine('failed')).toBe(
      'Piano sound could not load. You hear a simple tone instead.'
    )
  })

  it('has the credit line for the sampled piano', () => {
    expect(PIANO_SOUND_CREDIT).toBe(
      'Piano sound: Salamander Grand Piano by Alexander Holm (CC BY 3.0).'
    )
  })
})

describe('localControlLine', () => {
  const connected = (localControl: 'off' | 'on' | 'unknown') => ({
    ok: true as const,
    status: { ...piano, connected: true, portName: 'Digital Piano', localControl }
  })

  it('says the piano speakers are off when Local Control is off', () => {
    expect(localControlLine(connected('off'))).toBe(
      "The piano's own speakers are off, so you hear the PC."
    )
  })

  it('says the piano speakers may still be on when it is unknown', () => {
    expect(localControlLine(connected('unknown'))).toBe(
      "The piano's own speakers may still be on."
    )
  })

  it('shows nothing when the piano is not connected', () => {
    expect(localControlLine({ ok: true, status: { ...piano, localControl: 'off' } })).toBeUndefined()
  })

  it('shows nothing before the first answer, on a reply error, or when Local Control is on', () => {
    expect(localControlLine(undefined)).toBeUndefined()
    expect(localControlLine({ ok: false, error: 'No engine.' })).toBeUndefined()
    expect(localControlLine(connected('on'))).toBeUndefined()
  })

  it('has the tip for hearing the sound twice, in the plan words', () => {
    expect(LOCAL_CONTROL_TIP).toBe(
      'If you hear the sound twice, hold METRONOME and RHYTHM on the piano and press the C5 key.'
    )
  })
})

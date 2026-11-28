import { describe, expect, it } from 'vitest'
import {
  BUFFER_HINT,
  bufferLabel,
  fallbackLine,
  lastKeyLine,
  latestKeyDown,
  LOCAL_CONTROL_TIP,
  localControlLine,
  modeChoices,
  noteName,
  outputChoices,
  outputLabel,
  pianoHelp,
  pianoLine,
  pianoProblem,
  pianoSoundLine,
  PIANO_SOUND_CREDIT,
  statusLine
} from './soundText'
import type { OutputDevice } from '../../../shared/audio'

describe('statusLine', () => {
  it('says what is happening for each phase', () => {
    expect(statusLine({ phase: 'starting', piano: 'ready' })).toBe('Starting sound…')
    expect(statusLine({ phase: 'starting', piano: 'loading' })).toBe('Getting the piano sound ready…')
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
    ).toBe('Sound is on. Headphones (Realtek), Fastest (exclusive), 128 samples, about 2.7 ms.')
  })

  it('names the sample rate and format when the engine knows them', () => {
    expect(
      statusLine({
        phase: 'on',
        piano: 'ready',
        result: {
          backend: 'wasapi-exclusive',
          deviceName: 'Headset',
          sampleRate: 48000,
          sampleFormat: '16-bit',
          bufferFrames: 512,
          outputLatencyMs: 10.7
        }
      })
    ).toBe('Sound is on. Headset, Fastest (exclusive), 48 kHz, 16-bit, 512 samples, about 10.7 ms.')
  })

  it('shows a rate such as 44.1 kHz without extra zeros', () => {
    expect(
      statusLine({
        phase: 'on',
        piano: 'ready',
        result: {
          backend: 'wasapi-shared',
          deviceName: 'Speakers',
          sampleRate: 44100,
          sampleFormat: '32-bit float',
          bufferFrames: 480,
          outputLatencyMs: 0
        }
      })
    ).toBe('Sound is on. Speakers, Shared with other apps, 44.1 kHz, 32-bit float, 480 samples.')
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
    ).toBe('Sound is on. Speakers, Standard mode, 256 samples.')
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

  it('says no piano is found, in a short headline', () => {
    expect(pianoLine({ ok: true, status: piano })).toBe('No piano found.')
  })

  it('gives the check-the-piano help apart from the headline, only when none is found', () => {
    expect(pianoHelp({ ok: true, status: piano })).toBe(
      'Check that the piano is on and the USB cable is plugged in.'
    )
    expect(pianoHelp({ ok: true, status: { ...piano, connected: true, portName: 'Digital Piano' } })).toBeUndefined()
    expect(pianoHelp(undefined)).toBeUndefined()
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
    expect(pianoSoundLine('loading', true)).toBe(
      'Piano sound: loading… (you hear a simple tone until it is ready)'
    )
    expect(pianoSoundLine('ready', true)).toBe('Piano sound: ready')
    expect(pianoSoundLine('failed', true)).toBe(
      'Piano sound: could not load. You hear a simple tone instead.'
    )
  })

  it('does not mention a tone while no sound is playing', () => {
    expect(pianoSoundLine('loading', false)).toBe('Piano sound: loading…')
    expect(pianoSoundLine('failed', false)).toBe('Piano sound: could not load.')
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

describe('fallbackLine', () => {
  it('says Fastest (exclusive) is busy and the app is on Shared with other apps', () => {
    expect(fallbackLine('wasapi-shared')).toBe(
      'Fastest (exclusive) is busy, so the app is using Shared with other apps. Close other apps that use sound and press Try again.'
    )
  })

  it('names the mode it fell back to when that is not shared mode', () => {
    expect(fallbackLine('cpal')).toBe(
      'Fastest (exclusive) did not work, so the app is using Standard mode. Close other apps that use sound and press Try again.'
    )
  })
})

describe('bufferLabel', () => {
  it('gives the samples and the about-time at 48000 Hz', () => {
    expect(bufferLabel(64)).toBe('64 samples, about 1.3 ms')
    expect(bufferLabel(128)).toBe('128 samples, about 2.7 ms')
    expect(bufferLabel(256)).toBe('256 samples, about 5.3 ms')
    expect(bufferLabel(512)).toBe('512 samples, about 10.7 ms')
  })
})

describe('BUFFER_HINT', () => {
  it('explains the Buffer in plain words, with what to do if there are crackles', () => {
    expect(BUFFER_HINT).toBe('Smaller is faster. If you hear crackles, pick a bigger one.')
  })
})

describe('outputLabel', () => {
  it('marks a headphone device, whatever the case of the word', () => {
    expect(outputLabel('Headphones (Realtek)')).toBe('Headphones (Realtek) (headphones)')
    expect(outputLabel('USB HEADPHONE SET')).toBe('USB HEADPHONE SET (headphones)')
  })

  it('leaves other device names as they are', () => {
    expect(outputLabel('Speakers (Realtek)')).toBe('Speakers (Realtek)')
  })
})

const windowsOutputs: OutputDevice[] = [
  { id: 'spk', name: 'Speakers (Realtek)', isDefault: true, backend: 'wasapi-exclusive' },
  { id: 'hp', name: 'Headphones (Realtek)', isDefault: false, backend: 'wasapi-exclusive' },
  { id: 'spk', name: 'Speakers (Realtek)', isDefault: true, backend: 'wasapi-shared' },
  { id: 'hp', name: 'Headphones (Realtek)', isDefault: false, backend: 'wasapi-shared' },
  { id: 'asio1', name: 'Interface ASIO', isDefault: false, backend: 'asio' }
]

describe('outputChoices', () => {
  it('starts with the Windows default output, then each device of this mode once', () => {
    expect(outputChoices(windowsOutputs, 'wasapi-shared')).toEqual([
      { value: '', label: 'Windows default output' },
      { value: 'spk', label: 'Speakers (Realtek)' },
      { value: 'hp', label: 'Headphones (Realtek) (headphones)' }
    ])
  })

  it('lists only the ASIO drivers in ASIO mode', () => {
    expect(outputChoices(windowsOutputs, 'asio')).toEqual([
      { value: '', label: 'Windows default output' },
      { value: 'asio1', label: 'Interface ASIO' }
    ])
  })

  it('keeps a saved device that is not listed, so the choice still shows', () => {
    expect(outputChoices(windowsOutputs, 'wasapi-exclusive', 'gone')).toContainEqual({
      value: 'gone',
      label: 'Saved output (not connected)'
    })
  })
})

describe('modeChoices', () => {
  it('offers the modes that the outputs list, in a fixed order', () => {
    expect(modeChoices(windowsOutputs, 'wasapi-exclusive')).toEqual(['wasapi-exclusive', 'wasapi-shared', 'asio'])
  })

  it('leaves out ASIO when no ASIO driver is listed', () => {
    expect(modeChoices(windowsOutputs.slice(0, 4), 'wasapi-exclusive')).toEqual([
      'wasapi-exclusive',
      'wasapi-shared'
    ])
  })

  it('offers the standard mode alone on a system without Windows audio, and keeps the saved mode', () => {
    expect(modeChoices([{ id: 'x', name: 'Speakers', isDefault: true, backend: 'cpal' }], 'cpal')).toEqual(['cpal'])
    expect(modeChoices([], 'cpal')).toEqual(['cpal'])
  })
})

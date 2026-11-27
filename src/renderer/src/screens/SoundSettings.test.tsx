// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SettingsSetReply, SoundSettings as Settings } from '../../../shared/settings'
import SoundSettings from './SoundSettings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const saved: Settings = { backend: 'wasapi-exclusive', bufferFrames: 128, volume: 0.8, pianoSpeakers: false }
const state = { phase: 'on', piano: 'ready' } as never

type Pending = { settings: Settings; resolve: (reply: SettingsSetReply) => void }

let root: Root
let host: HTMLElement
let sets: Pending[]
let volumes: number[]

beforeEach(() => {
  vi.useFakeTimers()
  sets = []
  volumes = []
  ;(window as unknown as { pianoLearner: unknown }).pianoLearner = {
    settings: {
      get: () => Promise.resolve(saved),
      set: (settings: Settings) => new Promise<SettingsSetReply>((resolve) => sets.push({ settings, resolve }))
    },
    audio: {
      listOutputs: () => Promise.resolve({ ok: true, outputs: [] }),
      setVolume: (volume: number) => {
        volumes.push(volume)
        return Promise.resolve({ ok: true })
      }
    }
  }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

async function show() {
  await act(async () => {
    root.render(<SoundSettings onState={() => undefined} />)
  })
}

const slider = () => host.querySelector<HTMLInputElement>('#sound-volume') as HTMLInputElement

function drag(percent: number) {
  const input = slider()
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(input, String(percent))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function pickBuffer(frames: number) {
  const select = host.querySelector<HTMLSelectElement>('#sound-buffer') as HTMLSelectElement
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, String(frames))
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('SoundSettings volume', () => {
  it('keeps the slider where it is when a save reply arrives during a volume move', async () => {
    await show()
    await pickBuffer(256)
    drag(30)
    await act(async () => {
      sets[0].resolve({ ok: true, settings: { ...saved, bufferFrames: 256 }, state })
    })
    expect(slider().value).toBe('30')
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    expect(sets[1].settings.volume).toBeCloseTo(0.3)
    expect(sets[1].settings.bufferFrames).toBe(256)
  })

  it('puts the engine volume back to the confirmed one when a save fails', async () => {
    await show()
    await pickBuffer(256)
    drag(30)
    expect(volumes).toEqual([0.3])
    await act(async () => {
      sets[0].resolve({ ok: false, error: 'Nope.' })
    })
    expect(volumes[volumes.length - 1]).toBe(0.8)
    expect(slider().value).toBe('80')
  })

  it('saves a waiting volume move at once when the screen closes', async () => {
    await show()
    drag(30)
    expect(sets.length).toBe(0)
    act(() => root.unmount())
    expect(sets.length).toBe(1)
    expect(sets[0].settings.volume).toBeCloseTo(0.3)
    root = createRoot(host)
    vi.advanceTimersByTime(1000)
    expect(sets.length).toBe(1)
  })
})

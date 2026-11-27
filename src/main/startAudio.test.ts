import { describe, expect, it } from 'vitest'
import { startAudio, type StartableAudio } from './startAudio'
import type { SoundSettings } from '../shared/settings'

const settings = { volume: 1 } as unknown as SoundSettings

function fakeAudio(loadResult: 'ok' | 'fail') {
  const log: string[] = []
  const applied: SoundSettings[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const audio: StartableAudio = {
    loadPiano: async (folder) => {
      log.push(`load ${folder}`)
      await gate
      log.push('load done')
      if (loadResult === 'fail') throw new Error('no piano')
    },
    applySettings: async (s) => {
      log.push('apply')
      applied.push(s)
      return {} as never
    },
    setLaunching: (on) => {
      log.push(on ? 'launching' : 'launched')
    }
  }
  return { audio, log, applied, release }
}

describe('startAudio', () => {
  it('opens the sound only after the piano load has settled', async () => {
    const { audio, log, release } = fakeAudio('ok')
    const done = startAudio(audio, () => settings, '/piano')
    await Promise.resolve()
    expect(log).toEqual(['launching', 'load /piano'])
    release()
    await done
    expect(log).toEqual(['launching', 'load /piano', 'load done', 'apply', 'launched'])
  })

  it('still opens the sound when the piano load fails', async () => {
    const { audio, log, release } = fakeAudio('fail')
    const done = startAudio(audio, () => settings, '/piano')
    release()
    await done
    expect(log).toEqual(['launching', 'load /piano', 'load done', 'apply', 'launched'])
  })

  it('opens the sound anyway when the piano load takes too long', async () => {
    const { audio, log } = fakeAudio('ok')
    await startAudio(audio, () => settings, '/piano', 10)
    expect(log).toEqual(['launching', 'load /piano', 'apply', 'launched'])
  })

  it('applies the settings Bar has now, not the ones from launch', async () => {
    const { audio, applied, release } = fakeAudio('ok')
    const launch = { volume: 0.8, backend: 'wasapi-exclusive' } as unknown as SoundSettings
    const changed = { volume: 0.3, backend: 'wasapi-shared' } as unknown as SoundSettings
    let current = launch
    const done = startAudio(audio, () => current, '/piano')
    current = changed // Bar changes them on the Sound screen during the load
    release()
    await done
    expect(applied).toEqual([changed])
  })
})

import { describe, expect, it } from 'vitest'
import { startAudio, type StartableAudio } from './startAudio'
import type { SoundSettings } from '../shared/settings'

const settings = { volume: 1 } as unknown as SoundSettings

function fakeAudio(loadResult: 'ok' | 'fail') {
  const log: string[] = []
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
    applySettings: async () => {
      log.push('apply')
      return {} as never
    }
  }
  return { audio, log, release }
}

describe('startAudio', () => {
  it('opens the sound only after the piano load has settled', async () => {
    const { audio, log, release } = fakeAudio('ok')
    const done = startAudio(audio, settings, '/piano')
    await Promise.resolve()
    expect(log).toEqual(['load /piano'])
    release()
    await done
    expect(log).toEqual(['load /piano', 'load done', 'apply'])
  })

  it('still opens the sound when the piano load fails', async () => {
    const { audio, log, release } = fakeAudio('fail')
    const done = startAudio(audio, settings, '/piano')
    release()
    await done
    expect(log).toEqual(['load /piano', 'load done', 'apply'])
  })

  it('opens the sound anyway when the piano load takes too long', async () => {
    const { audio, log } = fakeAudio('ok')
    await startAudio(audio, settings, '/piano', 10)
    expect(log).toEqual(['load /piano', 'apply'])
  })
})

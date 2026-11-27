import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings, type SoundSettings } from '../shared/settings'
import { loadSettings, saveSettings } from './settingsStore'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const chosen: SoundSettings = {
  deviceId: 'Headphones (Realtek)',
  backend: 'wasapi-shared',
  bufferFrames: 256,
  volume: 0.4,
  pianoSpeakers: true
}

describe('loadSettings', () => {
  it('gives the defaults when there is no file yet', () => {
    expect(loadSettings(dir, 'win32')).toEqual(defaultSettings('win32'))
  })

  it('gives the defaults when the file is broken JSON', () => {
    writeFileSync(join(dir, 'settings.json'), '{ not json', 'utf8')
    expect(loadSettings(dir, 'win32')).toEqual(defaultSettings('win32'))
  })

  it('validates what it reads, so a bad value falls back to its default', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ backend: 'web-audio', volume: 9 }), 'utf8')
    expect(loadSettings(dir, 'win32')).toEqual({ ...defaultSettings('win32'), volume: 1 })
  })
})

describe('saveSettings', () => {
  it('round trips: what is saved is what loads back', () => {
    saveSettings(dir, chosen)
    expect(loadSettings(dir, 'win32')).toEqual(chosen)
  })

  it('replaces an earlier save', () => {
    saveSettings(dir, chosen)
    saveSettings(dir, { ...chosen, bufferFrames: 512 })
    expect(loadSettings(dir, 'win32').bufferFrames).toBe(512)
  })

  it('leaves only the settings file behind, no temporary file', () => {
    saveSettings(dir, chosen)
    saveSettings(dir, defaultSettings('win32'))
    expect(readdirSync(dir).sort()).toEqual(['settings.json'])
  })

  it('keeps the original error when the temporary file cannot be cleaned up either', () => {
    // A folder in the way of the temporary file: writing fails, and so does removing it as a file.
    mkdirSync(join(dir, 'settings.json.tmp'))
    let thrown: unknown
    try {
      saveSettings(dir, chosen)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as NodeJS.ErrnoException).code).toBe('EISDIR')
  })

  it('creates the folder when it is missing', () => {
    const nested = join(dir, 'not', 'there')
    saveSettings(nested, chosen)
    expect(loadSettings(nested, 'win32')).toEqual(chosen)
  })
})

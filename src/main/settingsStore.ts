// Saves and loads the sound settings as one JSON file in the app's user data folder.
// Only the main process uses this. The file name is fixed here; nothing from the screen picks a path.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, parseSettings, type SoundSettings } from '../shared/settings'

const fileName = 'settings.json'
const tempName = 'settings.json.tmp'

// Reads the settings. A missing or broken file means the defaults. Every value is checked.
export function loadSettings(dir: string, platform: string = process.platform): SoundSettings {
  try {
    const text = readFileSync(join(dir, fileName), 'utf8')
    return parseSettings(JSON.parse(text), platform)
  } catch {
    return defaultSettings(platform)
  }
}

// Writes the settings to a temporary file first, then renames it over the real one,
// so a crash in the middle never leaves a half-written file behind.
// Throws if the file cannot be written; the caller tells Bar.
export function saveSettings(dir: string, settings: SoundSettings, platform: string = process.platform): void {
  const clean = parseSettings(settings, platform)
  const target = join(dir, fileName)
  const temp = join(dir, tempName)
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(temp, JSON.stringify(clean, null, 2), 'utf8')
    renameSync(temp, target)
  } catch (error) {
    // Cleaning up is best effort: the original error is the one that matters.
    try {
      rmSync(temp, { force: true })
    } catch {
      // Nothing more to do; the caller gets the error below.
    }
    throw error
  }
}

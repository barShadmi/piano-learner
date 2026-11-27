import { app } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pickAddonFile } from './addonFile'
import type { FullEngine } from './audioController'

export type LoadedEngine = { engine: FullEngine; loadError?: undefined } | { engine?: undefined; loadError: string }

// Where the built sound engine file lives. In development it is next to its source.
// In the installed app it is copied to resources/native by the installer.
function addonFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native')
    : join(app.getAppPath(), 'native', 'audio-engine')
}

// Where the piano sound files live. In development they are in assets/piano.
// In the installed app they are copied to resources/piano by the installer.
export function pianoFolder(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'piano')
    : join(app.getAppPath(), 'assets', 'piano')
}

// Loads the Rust sound engine. If anything goes wrong it returns the reason instead of
// throwing, so the app still opens and the Sound screen can explain.
export function loadEngine(): LoadedEngine {
  try {
    const folder = addonFolder()
    const file = existsSync(folder) ? pickAddonFile(readdirSync(folder), process.platform, process.arch) : undefined
    if (!file) {
      return {
        loadError: 'The sound engine file is missing. Please reinstall the app.'
      }
    }
    const nodeRequire = createRequire(__filename)
    const addon = nodeRequire(join(folder, file)) as Partial<Record<keyof FullEngine, unknown>>
    for (const name of ['start', 'stop', 'playTestTone', 'listOutputs', 'status'] as const) {
      if (typeof addon[name] !== 'function') {
        return { loadError: 'The sound engine file is the wrong version.' }
      }
    }
    return { engine: addon as unknown as FullEngine }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { loadError: `The sound engine could not be loaded. ${detail}` }
  }
}

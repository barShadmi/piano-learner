import { ipcMain } from 'electron'
import type { AudioController } from './audioController'
import { parseStartConfig, parseToneArgs } from './audioValidate'

// Only the five sound questions the Sound screen may ask. Each one checks its input,
// and none of them rejects: a bad request comes back as a plain reply.
export function registerAudioIpc(audio: AudioController): void {
  ipcMain.handle('audio:state', () => audio.state())
  ipcMain.handle('audio:list-outputs', () => audio.listOutputs())
  ipcMain.handle('audio:start', (_event, input: unknown) => {
    const parsed = parseStartConfig(input)
    if (!parsed.ok) return { phase: 'failed', error: parsed.error }
    return audio.start(parsed.value)
  })
  ipcMain.handle('audio:test-tone', (_event, input: unknown) => {
    const parsed = parseToneArgs(input)
    if (!parsed.ok) return { ok: false, error: parsed.error }
    return audio.testTone(parsed.value)
  })
  ipcMain.handle('audio:status', () => audio.status())
}

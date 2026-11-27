import { ipcMain, type BrowserWindow } from 'electron'
import type { MidiEvent } from '../shared/audio'
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
  // The piano questions: the status, and a reconnect. Key events go to the screen by sendMidiEvents.
  ipcMain.handle('midi:status', () => audio.midiStatus())
  ipcMain.handle('midi:reconnect', () => audio.reconnectMidi())
}

// Copies each batch of key events to the screen. Does nothing when there is no window.
// The screen is told only the events; the sound never waits for it.
export function sendMidiEvents(getWindow: () => BrowserWindow | null): (events: MidiEvent[]) => void {
  return (events) => {
    const win = getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    win.webContents.send('midi:event', events)
  }
}

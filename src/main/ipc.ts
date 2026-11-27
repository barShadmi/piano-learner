import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MidiEvent } from '../shared/audio'
import type { LatencySaveReply } from '../shared/latency'
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
  registerLatencyIpc(audio)
}

// The delay test. The renderer only asks; no input from it is used. The report files always
// have these two fixed names in the app's user data folder, and the folder is opened only for
// the file this process saved.
function registerLatencyIpc(audio: AudioController): void {
  let savedReport: string | undefined
  ipcMain.handle('latency:summary', () => audio.latencySummary())
  ipcMain.handle('latency:clear', () => audio.clearLatency())
  ipcMain.handle('latency:save', (): LatencySaveReply => {
    const report = audio.latencyReport(new Date())
    if (!report.ok) return report
    const folder = app.getPath('userData')
    const textPath = join(folder, 'latency-report.txt')
    try {
      writeFileSync(textPath, report.text, 'utf8')
      writeFileSync(join(folder, 'latency-report.json'), report.json, 'utf8')
    } catch (error) {
      console.error('The delay report could not be saved:', error)
      return { ok: false, error: 'The report could not be saved.' }
    }
    savedReport = textPath
    return { ok: true, path: textPath }
  })
  ipcMain.handle('latency:open-folder', () => {
    if (!savedReport) return { ok: false, error: 'Save the report first.' }
    shell.showItemInFolder(savedReport)
    return { ok: true }
  })
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

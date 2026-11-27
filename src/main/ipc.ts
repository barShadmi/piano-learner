import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MidiEvent } from '../shared/audio'
import type { LatencySaveReply } from '../shared/latency'
import type { VolumeReply } from '../shared/audio'
import { checkSettings, type SettingsSetReply, type SoundSettings } from '../shared/settings'
import { isSongId, type SongGetReply, type SongImportReply, type SongSummary } from '../shared/songs'
import type { AudioController } from './audioController'
import { parseSongPlay, parseStartConfig, parseToneArgs, parseVolume } from './audioValidate'
import type { ImportResult } from './import'
import { getSong, listSongs, saveSong } from './songStore'
import { saveSettings } from './settingsStore'

export interface SongsIpcOptions {
  /** The songs folder in the user data folder. */
  folder: string
  /** Shows the file dialog. Resolves to the chosen path, or undefined when Bar cancels. */
  chooseFile: () => Promise<string | undefined>
  /** Imports one file (in a worker thread). */
  importFile: (path: string) => Promise<ImportResult>
}

// The song library questions. The renderer never gives a path: the import dialog is opened here,
// and a song is only read by its id (checked to be a UUID).
export function registerSongsIpc({ folder, chooseFile, importFile }: SongsIpcOptions): void {
  ipcMain.handle('songs:list', (): SongSummary[] => listSongs(folder))
  ipcMain.handle('songs:get', (_event, id: unknown): SongGetReply => {
    const song = isSongId(id) ? getSong(folder, id) : undefined
    return song ? { ok: true, song } : { ok: false, error: 'This song could not be found.' }
  })
  ipcMain.handle('songs:import', async (): Promise<SongImportReply> => {
    const picked = await chooseFile()
    if (picked === undefined) return { ok: false, cancelled: true }
    const result = await importFile(picked)
    if (!result.ok) return { ok: false, error: result.error }
    try {
      return { ok: true, song: saveSong(folder, result.song) }
    } catch (error) {
      console.error('The song could not be saved:', error)
      return { ok: false, error: 'The song could not be saved.' }
    }
  })
}

// Only the sound questions the Sound screen may ask. Each one checks its input,
// and none of them rejects: a bad request comes back as a plain reply.
// `currentSettings` is the saved settings. A start with no input (Start sound, Try again) uses them.
export function registerAudioIpc(audio: AudioController, currentSettings: () => SoundSettings): void {
  ipcMain.handle('audio:state', () => audio.state())
  ipcMain.handle('audio:list-outputs', () => audio.listOutputs())
  ipcMain.handle('audio:start', (_event, input: unknown) => {
    if (input === undefined || input === null) return audio.retry(currentSettings())
    const parsed = parseStartConfig(input)
    if (!parsed.ok) return { phase: 'failed', error: parsed.error }
    return audio.start(parsed.value)
  })
  // The volume while Bar drags the slider. It only changes the level; the saved setting is written by settings:set.
  ipcMain.handle('audio:set-volume', (_event, input: unknown): VolumeReply => {
    const parsed = parseVolume(input)
    if (!parsed.ok) return parsed
    audio.setVolume(parsed.value)
    return { ok: true }
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
  // Listen mode: the engine plays the song. The events are checked here before they reach the engine.
  ipcMain.handle('song:play', (_event, input: unknown) => {
    const parsed = parseSongPlay(input)
    if (!parsed.ok) return parsed
    return audio.playSong(parsed.value.events, parsed.value.fromMs)
  })
  ipcMain.handle('song:stop', () => audio.stopSong())
  ipcMain.handle('song:position', () => audio.songPosition())
  registerLatencyIpc(audio)
}

// The sound settings. The renderer only sends the whole set; it is checked with checkSettings and
// saved to the fixed settings file in `folder` (the user data folder). Then the sound is applied.
// `initial` is what was loaded at start, so settings:get answers without reading the disk.
// Returns a function that gives the settings saved now (used by the sound start).
export function registerSettingsIpc(audio: AudioController, folder: string, initial: SoundSettings): () => SoundSettings {
  let current = initial
  ipcMain.handle('settings:get', (): SoundSettings => current)
  ipcMain.handle('settings:set', async (_event, input: unknown): Promise<SettingsSetReply> => {
    const checked = checkSettings(input, process.platform)
    if (!checked.ok) return checked
    const next = checked.value
    try {
      saveSettings(folder, next)
    } catch (error) {
      console.error('The sound settings could not be saved:', error)
      return { ok: false, error: 'The settings could not be saved.' }
    }
    current = next
    const state = await audio.applySettings(next)
    return { ok: true, settings: next, state }
  })
  return () => current
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

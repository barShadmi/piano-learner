import { contextBridge, ipcRenderer } from 'electron'
import type { MidiEvent, StartConfig, ToneArgs } from '../shared/audio'
import type { SoundSettings } from '../shared/settings'

// The main process passes a forced theme as a command-line argument.
const themeArg = process.argv.find((arg) => arg.startsWith('--piano-theme='))
const themeValue = themeArg?.slice('--piano-theme='.length)
const forcedTheme = themeValue === 'light' || themeValue === 'dark' ? themeValue : undefined

// The screens may only ask these sound questions. The main process checks every input.
// Live playing sound never goes through here: it stays inside the native engine.
const audio = {
  state: () => ipcRenderer.invoke('audio:state'),
  listOutputs: () => ipcRenderer.invoke('audio:list-outputs'),
  start: (config?: StartConfig) => ipcRenderer.invoke('audio:start', config),
  testTone: (args?: ToneArgs) => ipcRenderer.invoke('audio:test-tone', args),
  status: () => ipcRenderer.invoke('audio:status'),
  setVolume: (volume: number) => ipcRenderer.invoke('audio:set-volume', volume)
}

// The sound settings Bar chooses. The main process checks the whole set it is sent and saves it.
const settings = {
  get: () => ipcRenderer.invoke('settings:get'),
  set: (next: SoundSettings) => ipcRenderer.invoke('settings:set', next)
}

// The piano. Key events arrive in batches. onEvents returns a function that stops listening.
// The screens never get ipcRenderer itself.
const midi = {
  status: () => ipcRenderer.invoke('midi:status'),
  reconnect: () => ipcRenderer.invoke('midi:reconnect'),
  onEvents: (callback: (events: MidiEvent[]) => void): (() => void) => {
    const listener = (_event: unknown, events: MidiEvent[]): void => callback(events)
    ipcRenderer.on('midi:event', listener)
    return () => {
      ipcRenderer.removeListener('midi:event', listener)
    }
  }
}

// The delay test asks for the numbers, forgets them, and saves or shows the report. It never plays or times sound.
const latency = {
  summary: () => ipcRenderer.invoke('latency:summary'),
  clear: () => ipcRenderer.invoke('latency:clear'),
  save: () => ipcRenderer.invoke('latency:save'),
  showFile: () => ipcRenderer.invoke('latency:open-folder')
}

// forcedTheme is added only when it is set, so a normal launch exposes just version, audio, latency, midi and settings.
const api = {
  version: '0.0.1',
  audio,
  latency,
  midi,
  settings,
  ...(forcedTheme ? { forcedTheme } : {})
}

contextBridge.exposeInMainWorld('pianoLearner', api)

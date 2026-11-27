import { contextBridge, ipcRenderer } from 'electron'
import type { StartConfig, ToneArgs } from '../shared/audio'

// The main process passes a forced theme as a command-line argument.
const themeArg = process.argv.find((arg) => arg.startsWith('--piano-theme='))
const themeValue = themeArg?.slice('--piano-theme='.length)
const forcedTheme = themeValue === 'light' || themeValue === 'dark' ? themeValue : undefined

// The screens may only ask these five sound questions. The main process checks every input.
// Live playing sound never goes through here: it stays inside the native engine.
const audio = {
  state: () => ipcRenderer.invoke('audio:state'),
  listOutputs: () => ipcRenderer.invoke('audio:list-outputs'),
  start: (config?: StartConfig) => ipcRenderer.invoke('audio:start', config),
  testTone: (args?: ToneArgs) => ipcRenderer.invoke('audio:test-tone', args),
  status: () => ipcRenderer.invoke('audio:status')
}

// forcedTheme is added only when it is set, so a normal launch exposes just version and audio.
const api = {
  version: '0.0.1',
  audio,
  ...(forcedTheme ? { forcedTheme } : {})
}

contextBridge.exposeInMainWorld('pianoLearner', api)

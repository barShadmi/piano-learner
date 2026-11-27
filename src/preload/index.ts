import { contextBridge } from 'electron'

// The main process passes a forced theme as a command-line argument.
const themeArg = process.argv.find((arg) => arg.startsWith('--piano-theme='))
const themeValue = themeArg?.slice('--piano-theme='.length)
const forcedTheme = themeValue === 'light' || themeValue === 'dark' ? themeValue : undefined

const api = {
  version: '0.0.1',
  forcedTheme
}

contextBridge.exposeInMainWorld('pianoLearner', api)

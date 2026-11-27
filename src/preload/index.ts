import { contextBridge } from 'electron'

// The main process passes a forced theme as a command-line argument.
const themeArg = process.argv.find((arg) => arg.startsWith('--piano-theme='))
const themeValue = themeArg?.slice('--piano-theme='.length)
const forcedTheme = themeValue === 'light' || themeValue === 'dark' ? themeValue : undefined

// forcedTheme is added only when it is set, so a normal launch exposes just the version.
const api: { version: string; forcedTheme?: 'light' | 'dark' } = {
  version: '0.0.1',
  ...(forcedTheme ? { forcedTheme } : {})
}

contextBridge.exposeInMainWorld('pianoLearner', api)

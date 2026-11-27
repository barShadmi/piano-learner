export {}

declare global {
  interface Window {
    pianoLearner: {
      version: string
      forcedTheme?: 'light' | 'dark'
    }
  }
}

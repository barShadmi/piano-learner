export type Theme = 'light' | 'dark'

// A stored 'light' or 'dark' wins. Anything else (null, or an invalid value)
// falls back to the system preference.
export function getInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

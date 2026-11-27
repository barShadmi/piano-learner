import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import '../styles/base.css'
import App from './App'
import { applyTheme, getInitialTheme } from './theme'

// Set the theme before the first render so the screen never flashes the wrong one.
function readStoredTheme(): string | null {
  try {
    return localStorage.getItem('theme')
  } catch {
    return null
  }
}

applyTheme(
  getInitialTheme(readStoredTheme(), window.matchMedia('(prefers-color-scheme: dark)').matches)
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

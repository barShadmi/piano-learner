import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

const rendererUrl = process.env['ELECTRON_RENDERER_URL']

// Only the app's own pages may load in the window. Anything else is refused.
function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (rendererUrl) return parsed.origin === new URL(rendererUrl).origin
    return parsed.protocol === 'file:'
  } catch {
    return false
  }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: 'PianoLearner',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  // Deny every new window, including window.open.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (rendererUrl) {
    void win.loadURL(rendererUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})

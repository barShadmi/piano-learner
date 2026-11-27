import { app, BrowserWindow, Menu, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

// These three are for development and the screenshot script only.
// A packaged app ignores them, so nobody can steer an installed app with them.
const rendererUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']

// Used by the screenshot script. Empty means the normal start page.
const rawScreen = app.isPackaged ? '' : (process.env['PIANO_SCREEN'] ?? '')
const screenHash = /^[a-z0-9/-]*$/.test(rawScreen) ? rawScreen : ''

// Only 'light' or 'dark' force a theme. Anything else is ignored.
const rawTheme = app.isPackaged ? undefined : process.env['PIANO_THEME']
const forcedTheme = rawTheme === 'light' || rawTheme === 'dark' ? rawTheme : undefined

const rendererFile = join(__dirname, '../renderer/index.html')
const rendererFileUrl = pathToFileURL(rendererFile).href

// Only the app's own page may load in a window. Anything else is refused.
// The part after '#' is the app's own screen route, so it is ignored.
function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (rendererUrl) return parsed.origin === new URL(rendererUrl).origin
    parsed.hash = ''
    return parsed.href === rendererFileUrl
  } catch {
    return false
  }
}

let mainWindow: BrowserWindow | null = null

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
      sandbox: true,
      devTools: !app.isPackaged,
      additionalArguments: forcedTheme ? [`--piano-theme=${forcedTheme}`] : []
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('The screen process stopped:', details.reason)
  })

  const loading = rendererUrl
    ? win.loadURL(screenHash ? `${rendererUrl}#/${screenHash}` : rendererUrl)
    : win.loadFile(rendererFile, { hash: screenHash ? `/${screenHash}` : undefined })
  loading.catch((error: unknown) => {
    console.error('The app page could not load:', error)
    app.quit()
  })
}

// Must be called before the app is ready. It also overrides --no-sandbox, which
// the tests need when they run as root (CI containers). So the one escape hatch is
// an explicit --no-sandbox on a development run; a packaged app is always sandboxed.
// Windows still get `sandbox: true` in their own settings either way.
if (app.isPackaged || !process.argv.includes('--no-sandbox')) app.enableSandbox()

// Guards for every web contents, present and future.
app.on('web-contents-created', (_created, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  // Deny every new window, including window.open.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
})

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app
    .whenReady()
    .then(() => {
      // The app asks for no permissions (camera, microphone, MIDI and so on yet).
      const ses = session.defaultSession
      ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      ses.setPermissionCheckHandler(() => false)
      ses.setDevicePermissionHandler(() => false)

      if (app.isPackaged) Menu.setApplicationMenu(null)
      createWindow()
    })
    .catch((error: unknown) => {
      console.error('The app could not start:', error)
      app.quit()
    })
}

app.on('window-all-closed', () => {
  app.quit()
})

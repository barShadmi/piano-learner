import { app, BrowserWindow, dialog, Menu, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isAppUrl } from './appUrl'
import { loadEngine, pianoFolder } from './audio'
import { createAudioController } from './audioController'
import { registerAudioIpc, registerSettingsIpc, registerSongsIpc, sendMidiEvents } from './ipc'
import { runImportInWorker } from './import/runInWorker'
import { loadSettings } from './settingsStore'

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

const appUrlConfig = { rendererUrl, rendererFileUrl }

// The file types the import dialog offers. The importer checks the extension again.
const SONG_FILE_EXTENSIONS = ['mid', 'midi', 'musicxml', 'xml', 'mxl']

// Used by the import tests only: a file to import instead of showing the dialog.
// A packaged app ignores it, so the dialog is always shown there.
const e2eImportFile =
  !app.isPackaged && process.env['PIANO_LEARNER_E2E'] === '1' ? process.env['PIANO_LEARNER_E2E_IMPORT'] : undefined

let mainWindow: BrowserWindow | null = null

// Loading can fail (no engine file). The controller then reports it and the app still opens.
const audio = createAudioController(loadEngine())

// Shows the "Import file" dialog. Resolves to the chosen path, or undefined when Bar cancels.
async function chooseSongFile(): Promise<string | undefined> {
  if (e2eImportFile) return e2eImportFile
  const options = {
    title: 'Import file',
    properties: ['openFile' as const],
    filters: [{ name: 'Music files', extensions: SONG_FILE_EXTENSIONS }]
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? undefined : result.filePaths[0]
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
      sandbox: true,
      devTools: !app.isPackaged,
      additionalArguments: forcedTheme ? [`--piano-theme=${forcedTheme}`] : []
    }
  })
  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  // Windows shutdown or log off skips before-quit, so give the piano its speakers back here too.
  win.on('session-end', () => {
    audio.stopSong()
    audio.stopMidi()
    audio.stop()
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    console.error('The screen process stopped:', details.reason)
  })

  const loading = rendererUrl
    ? win.loadURL(screenHash ? `${rendererUrl}#/${screenHash}` : rendererUrl)
    : win.loadFile(rendererFile, { hash: screenHash ? `/${screenHash}` : undefined })
  // No menu means no zoom shortcuts, so handle them here. Key down only.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control) return
    const wc = win.webContents
    if (input.key === '=' || input.key === '+') {
      wc.setZoomLevel(Math.min(3, wc.getZoomLevel() + 0.5))
    } else if (input.key === '-') {
      wc.setZoomLevel(Math.max(-1, wc.getZoomLevel() - 0.5))
    } else if (input.key === '0') {
      wc.setZoomLevel(0)
    } else {
      return
    }
    event.preventDefault()
  })

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
    if (!isAppUrl(url, appUrlConfig)) event.preventDefault()
  })
  contents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, appUrlConfig)) event.preventDefault()
  })
  // Deny every new window, including window.open.
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // Deny the Bluetooth device picker. The other pickers are session events (see whenReady).
  contents.on('select-bluetooth-device', (event, _devices, callback) => {
    event.preventDefault()
    callback('')
  })
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
      // Deny the serial, USB and HID pickers. Registered once, on the one session.
      ses.on('select-serial-port', (event, _ports, _wc, callback) => {
        event.preventDefault()
        callback('')
      })
      ses.on('select-usb-device', (event, _details, callback) => {
        event.preventDefault()
        callback('')
      })
      ses.on('select-hid-device', (event, _details, callback) => {
        event.preventDefault()
        callback()
      })

      if (app.isPackaged) Menu.setApplicationMenu(null)
      // The saved sound settings (defaults when there is no file). Read once here, in the main process.
      const settingsFolder = app.getPath('userData')
      const settings = loadSettings(settingsFolder)
      const currentSettings = registerSettingsIpc(audio, settingsFolder, settings)
      registerAudioIpc(audio, currentSettings)
      // The song library. Each import runs in a worker thread (built next to this file).
      registerSongsIpc({
        folder: join(settingsFolder, 'songs'),
        chooseFile: chooseSongFile,
        importFile: (path) => runImportInWorker(path, { workerFile: join(__dirname, 'importWorker.js') })
      })
      createWindow()
      // Open the sound output after the window exists, so it never delays the window.
      // The result (or the reason it failed) is kept for the Sound screen. The saved volume
      // and piano speaker choice are applied with it.
      void audio.applySettings(settings)
      // Load the piano sound on a background thread. It does not wait for the output:
      // until it is ready (and if it fails) a simple tone plays, and the Sound screen says so.
      void audio.loadPiano(pianoFolder())
      // Start the piano watcher after the window exists. Key events go to the screen as they come.
      audio.startMidi(sendMidiEvents(() => mainWindow))
    })
    .catch((error: unknown) => {
      console.error('The app could not start:', error)
      app.quit()
    })
}

app.on('before-quit', () => {
  audio.stopSong()
  audio.stopMidi()
  audio.stop()
})

app.on('window-all-closed', () => {
  app.quit()
})

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  clipboard,
  nativeImage,
  desktopCapturer,
  shell
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'

// Must be called before app.whenReady()
app.disableHardwareAcceleration()

const store = new Store()

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null

const DEFAULT_KEYBINDS = { screenshot: 'CmdOrCtrl+Shift+S', record: 'CmdOrCtrl+Shift+R' }
let currentKeybinds = {
  screenshot: (store.get('keybind.screenshot') as string | undefined) ?? DEFAULT_KEYBINDS.screenshot,
  record: (store.get('keybind.record') as string | undefined) ?? DEFAULT_KEYBINDS.record
}

// ─── Windows ────────────────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 550,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Minimize to tray on close instead of quitting
  win.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function createOverlayWindow(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().bounds

  const win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true)
  win.setFullScreenable(false)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?view=overlay`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      query: { view: 'overlay' }
    })
  }

  // ESC cancels the capture
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') {
      closeOverlay()
    }
  })

  return win
}

function closeOverlay(): void {
  overlayWindow?.close()
  overlayWindow = null
}

// ─── Shortcuts ──────────────────────────────────────────────────────────────

function registerShortcuts(): { ok: boolean; error?: string } {
  globalShortcut.unregisterAll()
  if (!globalShortcut.register(currentKeybinds.screenshot, startCapture)) {
    return { ok: false, error: `Could not register ${currentKeybinds.screenshot} — it may already be in use` }
  }
  if (!globalShortcut.register(currentKeybinds.record, startRecording)) {
    globalShortcut.unregister(currentKeybinds.screenshot)
    return { ok: false, error: `Could not register ${currentKeybinds.record} — it may already be in use` }
  }
  return { ok: true }
}

// ─── Tray ───────────────────────────────────────────────────────────────────

function buildTrayMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Screenshot', accelerator: currentKeybinds.screenshot, click: startCapture },
    { label: 'Record', accelerator: currentKeybinds.record, click: startRecording },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    {
      label: 'Settings', click: () => {
        mainWindow?.show()
        mainWindow?.focus()
        mainWindow?.webContents.send('navigate', 'settings')
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } }
  ])
}

function refreshTrayMenu(): void {
  tray?.setContextMenu(buildTrayMenu())
}

function setupTray(): void {
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setContextMenu(buildTrayMenu())
  tray.setToolTip('CaptureApp')
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus() })
  tray.on('double-click', startCapture)
}

// ─── Capture / Record ───────────────────────────────────────────────────────

function startCapture(): void {
  if (overlayWindow) return // already open
  mainWindow?.hide() // hide main window so it's not in the screenshot
  overlayWindow = createOverlayWindow()
  overlayWindow.once('closed', () => {
    overlayWindow = null
  })
}

type CaptureRect = { x: number; y: number; width: number; height: number }

async function captureAndSend(rect: CaptureRect): Promise<void> {
  const display = screen.getPrimaryDisplay()
  const { scaleFactor } = display
  const { width: logW, height: logH } = display.bounds

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(logW * scaleFactor),
      height: Math.round(logH * scaleFactor)
    }
  })

  if (!sources.length) return

  const thumbnail = sources[0].thumbnail
  const { width: imgW, height: imgH } = thumbnail.getSize()

  const x = Math.max(0, Math.round(rect.x * scaleFactor))
  const y = Math.max(0, Math.round(rect.y * scaleFactor))
  const w = Math.min(Math.round(rect.width * scaleFactor), imgW - x)
  const h = Math.min(Math.round(rect.height * scaleFactor), imgH - y)

  if (w <= 0 || h <= 0) return

  const cropped = thumbnail.crop({ x, y, width: w, height: h })
  mainWindow?.webContents.send('open-editor', cropped.toDataURL())
}

function startRecording(): void {
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.webContents.send('navigate', 'record')
}

// ─── IPC handlers ───────────────────────────────────────────────────────────

function setupIPC(): void {
  // Renderer → trigger capture overlay from main window button
  ipcMain.on('start-capture', () => startCapture())

  // Overlay → region selected: hide overlay, screenshot, send to editor
  ipcMain.on('capture-region', (_event, rect: CaptureRect) => {
    overlayWindow?.hide()
    setTimeout(async () => {
      try {
        await captureAndSend(rect)
      } finally {
        closeOverlay()
        mainWindow?.show()
        mainWindow?.focus()
      }
    }, 200)
  })

  // Overlay → user cancelled
  ipcMain.on('capture-cancel', () => {
    closeOverlay()
    mainWindow?.show()
    mainWindow?.focus()
  })

  // Renderer → clipboard
  ipcMain.on('copy-to-clipboard', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.on('copy-image-to-clipboard', (_event, dataUrl: string) => {
    const img = nativeImage.createFromDataURL(dataUrl)
    clipboard.writeImage(img)
  })

  // Persistent store (auth tokens, settings)
  ipcMain.handle('store-get', (_event, key: string) => store.get(key))
  ipcMain.handle('store-set', (_event, key: string, value: unknown) => {
    store.set(key, value)
  })
  ipcMain.handle('store-delete', (_event, key: string) => store.delete(key))

  // Open external links
  ipcMain.on('open-external', (_event, url: string) => shell.openExternal(url))

  // Window controls
  ipcMain.on('minimize-window', () => mainWindow?.minimize())
  ipcMain.on('hide-window', () => mainWindow?.hide())

  // Keybind management
  ipcMain.handle('get-keybinds', () => ({ ...currentKeybinds }))

  ipcMain.handle('set-keybinds', (_event, binds: typeof currentKeybinds) => {
    const prev = { ...currentKeybinds }
    currentKeybinds = { ...binds }
    const result = registerShortcuts()
    if (result.ok) {
      store.set('keybind.screenshot', binds.screenshot)
      store.set('keybind.record', binds.record)
      refreshTrayMenu()
    } else {
      currentKeybinds = prev
      registerShortcuts()
    }
    return result
  })
}

// ─── Auto-updater ───────────────────────────────────────────────────────────

function setupAutoUpdater(): void {
  autoUpdater.checkForUpdatesAndNotify()
  autoUpdater.on('update-downloaded', () => {
    mainWindow?.webContents.send('update-ready')
  })
  ipcMain.on('install-update', () => autoUpdater.quitAndInstall())
}

// ─── App lifecycle ──────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Electron {
    interface App {
      isQuitting?: boolean
    }
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('site.geanyl.captureapp')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  setupIPC()
  mainWindow = createMainWindow()
  setupTray()

  registerShortcuts()

  if (!is.dev) setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Keep app alive in tray when all windows are hidden
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit — stay in tray
  }
})

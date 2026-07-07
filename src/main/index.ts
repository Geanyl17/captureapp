import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
  screen,
  session,
  clipboard,
  nativeImage,
  desktopCapturer,
  shell
} from 'electron'
import { join } from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { tmpdir } from 'os'
import { unlink } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'

const execAsync = promisify(exec)

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

  win.on('ready-to-show', () => {
    win.show()
    if (is.dev) win.webContents.openDevTools({ mode: 'right' })
  })

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[main] failed to load:', code, desc, url)
  })

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
  // Use the full bounds (including x/y offset) so the overlay lands on the primary
  // display even in multi-monitor setups where it isn't at virtual (0, 0).
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    backgroundColor: '#00000000',
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

function trayIconPath(): string {
  // resources/ is two levels up from out/main/ during dev, and at process.resourcesPath when packaged
  return app.isPackaged
    ? join(process.resourcesPath, 'tray.png')
    : join(__dirname, '../../resources/tray.png')
}

function setupTray(): void {
  const icon = nativeImage.createFromPath(trayIconPath())
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

function onWayland(): boolean {
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
}

async function captureAndSend(rect: CaptureRect): Promise<void> {
  if (onWayland()) {
    await captureWayland(rect)
  } else {
    await captureDesktop(rect)
  }
}

// Wayland: capture full screen with spectacle then crop — no portal dialog
async function captureWayland(rect: CaptureRect): Promise<void> {
  const tmp = join(tmpdir(), `captureapp-${Date.now()}.png`)

  try {
    // -b background, -n no notification, -f full screen, -o output file
    await execAsync(`spectacle -b -n -f -o "${tmp}"`)
  } catch {
    mainWindow?.webContents.send('capture-error', 'Screenshot failed — spectacle must be installed.')
    return
  }

  try {
    const img = nativeImage.createFromPath(tmp)
    const { scaleFactor } = screen.getPrimaryDisplay()
    const cropped = img.crop({
      x: Math.round(rect.x * scaleFactor),
      y: Math.round(rect.y * scaleFactor),
      width: Math.round(rect.width * scaleFactor),
      height: Math.round(rect.height * scaleFactor)
    })
    mainWindow?.webContents.send('open-editor', cropped.toDataURL())
  } finally {
    unlink(tmp).catch(() => {})
  }
}

// X11 / Windows: use Electron's desktopCapturer
async function captureDesktop(rect: CaptureRect): Promise<void> {
  const display = screen.getPrimaryDisplay()
  const { width: logW, height: logH } = display.bounds

  // Request generously large so Electron returns the native physical resolution.
  // Don't rely on scaleFactor — it can be misreported on Windows (e.g. fractional DPI).
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: logW * 4, height: logH * 4 }
  })

  if (!sources.length) return

  // Match the primary display's source when display_id is available (multi-monitor safety)
  const primarySource =
    sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]

  const thumbnail = primarySource.thumbnail
  const { width: imgW, height: imgH } = thumbnail.getSize()

  // Derive actual pixel-to-logical scale from the real thumbnail dimensions
  const scaleX = imgW / logW
  const scaleY = imgH / logH

  const x = Math.max(0, Math.round(rect.x * scaleX))
  const y = Math.max(0, Math.round(rect.y * scaleY))
  const w = Math.min(Math.round(rect.width * scaleX), imgW - x)
  const h = Math.min(Math.round(rect.height * scaleY), imgH - y)

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

  // Recording — source picker + getDisplayMedia handler
  ipcMain.handle('get-record-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 }
    })
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
  })

  let pendingSourceId: string | null = null
  ipcMain.on('set-record-source', (_e, id: string) => { pendingSourceId = id })

  // Upload — routed through main to bypass renderer CORS restrictions
  ipcMain.handle(
    'upload-file',
    async (_e, { buffer, filename, mimeType, token, baseUrl }: { buffer: Uint8Array; filename: string; mimeType: string; token: string; baseUrl: string }) => {
      const form = new FormData()
      form.append('file', new Blob([buffer], { type: mimeType }), filename)
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(err.error ?? `Upload failed (${res.status})`)
      }
      const { url } = await res.json() as { url: string }
      return url
    }
  )

  // History (last 50 captures)
  type HistoryItem = { id: string; url: string; filename: string; thumbnail: string; timestamp: number }

  ipcMain.handle('history-add', (_e, item: HistoryItem) => {
    const list = (store.get('history') as HistoryItem[] | undefined) ?? []
    store.set('history', [item, ...list].slice(0, 50))
  })
  ipcMain.handle('history-get', () => (store.get('history') as HistoryItem[] | undefined) ?? [])
  ipcMain.handle('history-delete', (_e, id: string) => {
    const list = (store.get('history') as HistoryItem[] | undefined) ?? []
    store.set('history', list.filter((i) => i.id !== id))
  })
  ipcMain.handle('history-clear', () => store.set('history', []))

  // Expose pendingSourceId to the display-media handler (set up in app.whenReady)
  return { getPendingSourceId: () => { const id = pendingSourceId; pendingSourceId = null; return id } }
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

  const { getPendingSourceId } = setupIPC()
  mainWindow = createMainWindow()
  setupTray()

  registerShortcuts()

  // Let renderer's getDisplayMedia() use a source chosen via our source picker
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    const id = getPendingSourceId()
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      const source = (id ? sources.find((s) => s.id === id) : null) ?? sources[0]
      callback({ video: source, audio: 'loopback' })
    })
  })

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

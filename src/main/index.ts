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

// NOTE: we intentionally do NOT call app.disableHardwareAcceleration(). It forces
// software 2D-canvas rendering, which mis-scales the editor's fabric canvas (the
// "image zoomed into a corner" bug). The GPU path renders the canvas correctly —
// it's how the user's other Electron apps (VS Code, Discord) work on this Wayland.

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

  // Forward the renderer's [editor]/[capture] console logs to the terminal so
  // capture + display diagnostics show up in one place. (Electron changed this
  // event's signature across versions, so read the message defensively.)
  win.webContents.on('console-message', (...args: unknown[]) => {
    const first = args[0] as { message?: string } | undefined
    const message = typeof first === 'object' && first?.message !== undefined ? first.message : (args[2] as string)
    if (typeof message === 'string' && (message.startsWith('[editor]') || message.startsWith('[capture]'))) {
      console.log('[renderer]', message)
    }
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

function createOverlayWindow(display: Electron.Display): BrowserWindow {
  const { x, y, width, height } = display.bounds

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    // This overlay now displays an opaque frozen screenshot (not the live desktop),
    // so it does not need to be transparent — an opaque borderless window covering the
    // display is more reliable on Windows. Position/size come from the display bounds;
    // on X11 Linux we also request fullscreen to be safe.
    fullscreen: process.platform === 'linux',
    transparent: false,
    backgroundColor: '#000000',
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

// Bring the main window forward to show a capture in the editor. (We tried maximize()
// and setFullScreen() to show captures larger, but maximize() snaps back on KWin and
// fullscreen leaves the window un-draggable — and neither addresses the underlying
// "window paints into a quarter of the surface" bug, which has to be fixed first.)
function showEditorWindow(): void {
  const win = mainWindow
  if (!win) return
  win.show()
  win.focus()
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
  if (overlayWindow) return
  mainWindow?.hide()
  if (onWayland()) {
    // On Wayland we can't position a transparent overlay reliably (the compositor
    // decides where fullscreen windows go), so we hand region selection to
    // spectacle's own selector, which the compositor draws correctly. See
    // captureWaylandRegion() for why the `-i` flag matters.
    captureWaylandRegion()
  } else {
    captureFrozenAndSelect()
  }
}

function onWayland(): boolean {
  return !!(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === 'wayland')
}

// Windows / X11: the flow real screenshot tools use — grab the frozen screen FIRST,
// then let the user select a region on that frozen bitmap. The overlay just displays
// the captured image; the crop is a single displayed→physical ratio done in the
// renderer (see Overlay.tsx). This avoids reconciling the three coordinate systems
// (overlay CSS px, virtual-desktop logical px, capture physical px) that the old
// select-then-capture flow tried to line up — the source of the "content in a quarter,
// rest blank" bug on HiDPI/scaled displays.
async function captureFrozenAndSelect(): Promise<void> {
  // Let the main window actually hide before we grab the screen, so it isn't in the shot.
  await new Promise((r) => setTimeout(r, 120))

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  // Capture at the display's *physical* resolution (logical size × scaleFactor).
  const physW = Math.round(display.size.width * display.scaleFactor)
  const physH = Math.round(display.size.height * display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physW, height: physH }
  })
  const source =
    sources.find((s) => String(s.display_id) === String(display.id)) ??
    sources.find((s) => {
      const sz = s.thumbnail.getSize()
      return Math.abs(sz.width - physW) <= 4 && Math.abs(sz.height - physH) <= 4
    }) ??
    sources[0]

  if (!source || source.thumbnail.isEmpty()) {
    mainWindow?.show()
    mainWindow?.focus()
    return
  }

  const shot = source.thumbnail.toDataURL()
  console.log('[capture] frozen shot', source.thumbnail.getSize(), 'for display', display.id, `${display.size.width}x${display.size.height}@${display.scaleFactor}`)

  overlayWindow = createOverlayWindow(display)
  overlayWindow.once('closed', () => { overlayWindow = null })
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow?.webContents.send('selection-image', shot)
  })
}

// Wayland: let spectacle's own selector handle region selection, then read the
// resulting PNG.
//
// The bug this fixes: the user runs spectacle for other things, so it is resident
// on D-Bus (org.kde.Spectacle). Without `-i`, a plain `spectacle -b -r …` call is
// handed off to that resident instance and the CLI process returns *immediately* —
// before the screenshot is written. We then read a half-written PNG, which decodes
// to the top slice of the image with the rest black (the "small snippet on a dark
// background" symptom). `-i` starts an isolated instance that does NOT register on
// D-Bus, so `-b` blocks until the file is fully written before execAsync resolves.
async function captureWaylandRegion(): Promise<void> {
  const tmp = join(tmpdir(), `captureapp-${Date.now()}.png`)
  const restore = (): void => { mainWindow?.show(); mainWindow?.focus() }

  try {
    // -i: isolated instance (don't touch the user's resident spectacle / D-Bus)
    // -b: exit after capture, no editor GUI   -n: no notification
    // -r: interactive rectangular region selector
    await execAsync(`spectacle -i -b -n -r -o "${tmp}"`)
  } catch (e) {
    // spectacle exits non-zero when the user presses ESC to cancel — that's not an
    // error. Only surface a message if spectacle isn't installed at all.
    const msg = (e as { message?: string }).message ?? ''
    if (/not found|ENOENT|\b127\b/.test(msg)) {
      mainWindow?.webContents.send('capture-error', 'Screenshot failed — is spectacle installed?')
      restore()
      return
    }
  }

  try {
    const img = nativeImage.createFromPath(tmp)
    const sz = img.getSize()
    console.log('[capture] spectacle region →', `${sz.width}×${sz.height}`, 'empty=', img.isEmpty())
    if (!img.isEmpty()) {
      // Open the editor fullscreen so the capture is shown at a proper size instead of
      // a small thumbnail in the default 1100×720 window.
      showEditorWindow()
      mainWindow?.webContents.send('open-editor', img.toDataURL())
    } else {
      // Empty (with no exec error) means the user cancelled — just restore the window.
      restore()
    }
  } finally {
    unlink(tmp).catch(() => {})
  }
}

function startRecording(): void {
  mainWindow?.show()
  mainWindow?.focus()
  mainWindow?.webContents.send('navigate', 'record')
}

// ─── IPC handlers ───────────────────────────────────────────────────────────

function setupIPC(): { getPendingSourceId: () => string | null } {
  // Renderer → trigger capture overlay from main window button
  ipcMain.on('start-capture', () => startCapture())

  // Overlay → region already cropped from the frozen screenshot in the renderer.
  // No coordinate math here: the renderer selected on the exact bitmap it displayed,
  // so we just forward the finished PNG to the editor.
  ipcMain.on('crop-done', (_event, croppedDataUrl: string) => {
    closeOverlay()
    showEditorWindow()
    mainWindow?.webContents.send('open-editor', croppedDataUrl)
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
  // Renderer leaves the editor → drop out of the fullscreen we entered for the capture
  ipcMain.on('set-fullscreen', (_e, flag: boolean) => mainWindow?.setFullScreen(flag))

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
      form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), filename)
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

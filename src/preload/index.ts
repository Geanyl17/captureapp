import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  // Capture
  startCapture: () => ipcRenderer.send('start-capture'),
  captureRegion: (rect: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.send('capture-region', rect),
  captureCancel: () => ipcRenderer.send('capture-cancel'),

  // Clipboard
  copyText: (text: string) => ipcRenderer.send('copy-to-clipboard', text),
  copyImage: (dataUrl: string) => ipcRenderer.send('copy-image-to-clipboard', dataUrl),

  // Persistent store
  storeGet: (key: string) => ipcRenderer.invoke('store-get', key),
  storeSet: (key: string, value: unknown) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key: string) => ipcRenderer.invoke('store-delete', key),

  // Keybinds
  getKeybinds: (): Promise<{ screenshot: string; record: string }> =>
    ipcRenderer.invoke('get-keybinds'),
  setKeybinds: (binds: { screenshot: string; record: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('set-keybinds', binds),

  // Shell
  openExternal: (url: string) => ipcRenderer.send('open-external', url),

  // Window
  minimize: () => ipcRenderer.send('minimize-window'),
  hide: () => ipcRenderer.send('hide-window'),

  // Events from main → renderer
  onNavigate: (cb: (view: string) => void) =>
    ipcRenderer.on('navigate', (_e, view) => cb(view)),
  onOpenEditor: (cb: (imageDataUrl: string) => void) =>
    ipcRenderer.on('open-editor', (_e, dataUrl) => cb(dataUrl)),
  onUpdateReady: (cb: () => void) =>
    ipcRenderer.on('update-ready', () => cb()),

  installUpdate: () => ipcRenderer.send('install-update')
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}

export type API = typeof api

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  isElectron: true,
  pickFolder: () => ipcRenderer.invoke('jarvis:pick-folder'),
  pickFile: (filters) => ipcRenderer.invoke('jarvis:pick-file', filters),
  portalOpen: (url) => ipcRenderer.invoke('jarvis:portal-open', url),
  portalCapture: () => ipcRenderer.invoke('jarvis:portal-capture'),
  portalSyncPages: (urls) => ipcRenderer.invoke('jarvis:portal-sync', urls),
  desktopPrefsChanged: () => ipcRenderer.invoke('jarvis:desktop-prefs-changed'),
  relaunch: () => ipcRenderer.invoke('jarvis:relaunch')
})

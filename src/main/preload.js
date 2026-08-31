const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('jared', {
  chat: (text, mode) => ipcRenderer.invoke('chat', { text, mode }),
  planTask: task => ipcRenderer.invoke('task:plan', { task }),
  runTask: task => ipcRenderer.invoke('task:run', { task }),
  stopTask: () => ipcRenderer.invoke('task:stop'),
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSave: data => ipcRenderer.invoke('settings:save', data),
  auditGet: () => ipcRenderer.invoke('audit:get'),
  openLog: () => ipcRenderer.invoke('audit:open'),
  hidePanel: () => ipcRenderer.invoke('panel:hide'),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  onStatus: cb => ipcRenderer.on('status', (_, data) => cb(data)),
  onAudit: cb => ipcRenderer.on('audit', (_, data) => cb(data)),
  onOverlay: cb => ipcRenderer.on('overlay', (_, data) => cb(data))
});

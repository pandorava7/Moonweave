const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('moonweave', {
  chooseAudio: () => ipcRenderer.invoke('audio:choose'),
  saveChart: (payload) => ipcRenderer.invoke('chart:save', payload),
  loadChart: () => ipcRenderer.invoke('chart:load'),
})

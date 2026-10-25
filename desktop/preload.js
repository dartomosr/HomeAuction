const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('homeAuction', {
  getState: () => ipcRenderer.invoke('homeauction:get-state'),
  getWindowMode: () => ipcRenderer.invoke('homeauction:get-window-mode'),
  toggleFullscreen: () => ipcRenderer.invoke('homeauction:toggle-fullscreen'),
  exitFullscreen: () => ipcRenderer.invoke('homeauction:exit-fullscreen'),
  onWindowMode(callback) {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on('homeauction:window-mode', listener);
    return () => ipcRenderer.removeListener('homeauction:window-mode', listener);
  },
  startTunnel: () => ipcRenderer.invoke('homeauction:start-tunnel'),
  stopTunnel: () => ipcRenderer.invoke('homeauction:stop-tunnel'),
  openAddress: (kind) => ipcRenderer.invoke('homeauction:open-address', kind),
  copyAddress: (kind) => ipcRenderer.invoke('homeauction:copy-address', kind),
  minimize: () => ipcRenderer.invoke('homeauction:minimize'),
  quit: () => ipcRenderer.invoke('homeauction:quit'),
  onState(callback) {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('homeauction:state', listener);
    return () => ipcRenderer.removeListener('homeauction:state', listener);
  }
});

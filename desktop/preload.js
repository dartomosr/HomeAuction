const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('homeAuction', {
  getState: () => ipcRenderer.invoke('homeauction:get-state'),
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

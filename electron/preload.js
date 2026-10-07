// ELECTRON — pont sécurisé entre l'interface et le système de fichiers
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  readSaves: () => ipcRenderer.invoke('saves:read'),
  writeSaves: (data) => ipcRenderer.invoke('saves:write', data),
  quit: () => ipcRenderer.invoke('app:quit'),
  toggleFullscreen: () => ipcRenderer.invoke('app:fullscreen'),
  net: {
    listen: (port) => ipcRenderer.invoke('net:listen', port),
    stop: () => ipcRenderer.invoke('net:stop'),
    connect: (host, port) => ipcRenderer.invoke('net:connect', host, port),
    send: (id, data) => ipcRenderer.invoke('net:send', id, data),
    close: (id) => ipcRenderer.invoke('net:close', id),
    addresses: () => ipcRenderer.invoke('net:addresses'),
    onEvent: (fn) => { const h = (_e, p) => fn(p); ipcRenderer.on('net:event', h); return () => ipcRenderer.removeListener('net:event', h); },
  },
  store: {
    list: (cat) => ipcRenderer.invoke('store:list', cat),
    read: (cat, id) => ipcRenderer.invoke('store:read', cat, id),
    write: (cat, id, data) => ipcRenderer.invoke('store:write', cat, id, data),
    remove: (cat, id) => ipcRenderer.invoke('store:delete', cat, id),
  },
});

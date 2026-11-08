'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const withProgress = (ch, fn) => async (arg, onProgress) => {
  const h = (e, d) => onProgress && onProgress(d);
  ipcRenderer.on(ch, h);
  try { return await fn(arg); } finally { ipcRenderer.removeListener(ch, h); }
};
contextBridge.exposeInMainWorld('api', {
  pickAudio: () => ipcRenderer.invoke('pickAudio'),
  readFile: p => ipcRenderer.invoke('readFile', p),
  align: withProgress('progress:align', a => ipcRenderer.invoke('align', a)),
  saveProject: (json, name) => ipcRenderer.invoke('saveProject', json, name),
  openProject: () => ipcRenderer.invoke('openProject'),
  loadUserPresets: () => ipcRenderer.invoke('loadUserPresets'),
  saveUserPresets: p => ipcRenderer.invoke('saveUserPresets', p),
  exportVideo: withProgress('progress:export', j => ipcRenderer.invoke('exportVideo', j)),
  cancelExport: () => ipcRenderer.invoke('cancelExport')
});

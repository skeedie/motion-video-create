'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const withProgress = (ch, fn) => async (arg, onProgress) => {
  const h = (e, d) => onProgress && onProgress(d);
  ipcRenderer.on(ch, h);
  try { return await fn(arg); } finally { ipcRenderer.removeListener(ch, h); }
};
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('api', {
  pickAudio: () => inv('pickAudio'),
  pickImage: () => inv('pickImage'),
  pickFont: () => inv('pickFont'),
  pickMedia: () => inv('pickMedia'),
  mediaUrl: p => 'app://media/?p=' + encodeURIComponent(p),
  readFile: p => inv('readFile', p),
  align: withProgress('progress:align', a => inv('align', a)),
  saveProject: (json, name, existing) => inv('saveProject', json, name, existing),
  openProject: p => inv('openProject', p),
  recent: () => inv('recent'),
  autosave: json => inv('autosave', json),
  loadAutosave: () => inv('loadAutosave'),
  clearAutosave: () => inv('clearAutosave'),
  loadUserPresets: () => inv('loadUserPresets'),
  saveUserPresets: p => inv('saveUserPresets', p),
  loadUserTemplates: () => inv('loadUserTemplates'),
  loadProfile: () => inv('loadProfile'),
  saveProfile: p => inv('saveProfile', p),
  saveBundle: (json, name) => inv('saveBundle', json, name),
  gpuInfo: () => inv('gpuInfo'),
  saveUserTemplates: p => inv('saveUserTemplates', p),
  exportPreset: (json, name) => inv('exportPreset', json, name),
  importPreset: () => inv('importPreset'),
  exportVideo: withProgress('progress:export', j => inv('exportVideo', j)),
  cancelExport: () => inv('cancelExport'),
  exportFrame: j => inv('exportFrame', j),
  pickFolder: () => inv('pickFolder'),
  showFile: p => inv('showFile', p),
  captureRect: r => inv('captureRect', r),
  log: (level, msg) => inv('log', level, msg),
  copyReport: extra => inv('copyReport', extra),
  openLogFolder: () => inv('openLogFolder'),
  version: () => inv('version'),
  checkUpdate: () => inv('checkUpdate'),
  installUpdate: withProgress('progress:update', info => inv('installUpdate', info)),
  openExternal: url => inv('openExternal', url)
});

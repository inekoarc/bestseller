'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel) => (cb) => {
  const listener = (_e, payload) => {
    try {
      cb(payload);
    } catch (err) {
      console.error('listener error', err);
    }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  platforms: () => ipcRenderer.invoke('platforms:list'),
  start: (cfg) => ipcRenderer.invoke('collect:start', cfg),
  stop: () => ipcRenderer.invoke('collect:stop'),
  pause: () => ipcRenderer.invoke('collect:pause'),
  resume: () => ipcRenderer.invoke('collect:resume'),
  pickOutputDir: () => ipcRenderer.invoke('dialog:pickOutputDir'),
  openFile: (p) => ipcRenderer.invoke('shell:openFile', p),
  showInFolder: (p) => ipcRenderer.invoke('shell:showInFolder', p),
  smsAction: (a) => ipcRenderer.invoke('collect:sms-action', a),
  resetLogin: (id) => ipcRenderer.invoke('collect:reset-login', id),
  onState: subscribe('collector:state'),
  onLog: subscribe('collector:log'),
  onQr: subscribe('collector:qr'),
  onProgress: subscribe('collector:progress'),
  onDone: subscribe('collector:done'),
  onError: subscribe('collector:error'),
});
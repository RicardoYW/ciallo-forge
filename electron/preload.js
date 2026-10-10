'use strict';

/**
 * 预加载脚本：给渲染层暴露少量原生能力。
 * contextIsolation 开着，渲染层拿不到 Node —— 只能通过这里列出的通道。
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cialloNative', {
  isElectron: true,
  getInfo: () => ipcRenderer.invoke('app-info'),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  showItem: (p) => ipcRenderer.invoke('show-item', p),
});

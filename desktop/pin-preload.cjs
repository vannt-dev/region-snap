/*! SPDX-License-Identifier: MIT | Copyright (c) 2026 vannt-dev | github.com/vannt-dev/region-snap */
const { contextBridge, ipcRenderer } = require("electron");

const number = (value) => (Number.isFinite(value) ? value : 0);

contextBridge.exposeInMainWorld("regionSnapPin", {
  close: () => ipcRenderer.send("pin-close"),
  copy: () => ipcRenderer.send("pin-copy"),
  dragEnd: () => ipcRenderer.send("pin-drag-end"),
  dragMove: (x, y) => ipcRenderer.send("pin-drag-move", { x: number(x), y: number(y) }),
  dragStart: (x, y) => ipcRenderer.send("pin-drag-start", { x: number(x), y: number(y) }),
  image: () => ipcRenderer.invoke("pin-image"),
  menu: () => ipcRenderer.send("pin-menu"),
  onNotice: (callback) => {
    ipcRenderer.on("pin-notice", (_event, message) => callback(String(message)));
  },
  opacity: (deltaY) => ipcRenderer.send("pin-opacity", number(deltaY)),
  resetZoom: () => ipcRenderer.send("pin-reset-zoom"),
  save: () => ipcRenderer.send("pin-save"),
  saveAs: () => ipcRenderer.send("pin-save-as"),
  zoom: (deltaY, anchorX, anchorY) =>
    ipcRenderer.send("pin-zoom", {
      deltaY: number(deltaY),
      x: number(anchorX),
      y: number(anchorY),
    }),
});

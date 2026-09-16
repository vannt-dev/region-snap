const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("regionSnapDesktop", {
  cancel: () => ipcRenderer.send("cancel-capture"),
  captureSources: (selection) => ipcRenderer.invoke("capture-sources", selection),
  onCaptureReady: (callback) => {
    ipcRenderer.once("capture-ready", (_event, payload) => callback(payload));
  },
  restore: () => ipcRenderer.send("restore-capture"),
  save: (dataUrl) => ipcRenderer.invoke("save-capture", dataUrl),
});

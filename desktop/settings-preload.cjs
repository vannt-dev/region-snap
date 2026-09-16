const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("regionSnapSettings", {
  chooseOutputDirectory: () => ipcRenderer.invoke("choose-output-directory"),
  get: () => ipcRenderer.invoke("get-settings"),
  save: (settings) => ipcRenderer.invoke("save-settings", settings),
});

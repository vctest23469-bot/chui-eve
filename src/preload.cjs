const { contextBridge, ipcRenderer, webUtils } = require("electron");
const api = {};
api.onShutdown = (fn) =>
  ipcRenderer.on("shutdown", async () => {
    try {
      await fn();
    } finally {
      await ipcRenderer.invoke("shutdown-complete");
    }
  });
for (const name of [
  "appearance",
  "model-settings",
  "model-settings-save",
  "model-test",
  "insights",
  "insights-cancel",
  "insights-text",
  "insights-export",
  "map-fullscreen",
  "state",
  "warm",
  "import",
  "start",
  "chunk",
  "stop",
  "cancel",
  "retry",
  "edit",
  "remove",
  "export",
  "folder",
  "settings",
  "availability",
])
  api[name] = (...args) => ipcRenderer.invoke(name, ...args);
api.onState = (fn) => {
  const handler = (_, data) => fn(data);
  ipcRenderer.on("state", handler);
  return () => ipcRenderer.removeListener("state", handler);
};
api.drop = (files) =>
  ipcRenderer.invoke(
    "drop",
    Array.from(files).map((f) => webUtils.getPathForFile(f)),
  );
contextBridge.exposeInMainWorld("eve", api);

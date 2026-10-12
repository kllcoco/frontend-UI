const { contextBridge, ipcRenderer } = require("electron");

const COMMANDS = new Set(["new-chat", "search", "settings", "toggle-sidebar", "shortcuts", "about", "export-chat", "export-pdf", "focus-composer"]);

contextBridge.exposeInMainWorld("ciroDesktop", {
  platform: process.platform,
  version: ipcRenderer.sendSync("ciro:version"),
  setLanguage: (language) => {
    if (language === "zh-CN" || language === "en") ipcRenderer.send("ciro:set-language", language);
  },
  onCommand: (handler) => {
    const listener = (_event, command) => { if (COMMANDS.has(command)) handler(command); };
    ipcRenderer.on("ciro:command", listener);
    return () => ipcRenderer.removeListener("ciro:command", listener);
  },
  openExternal: (url) => ipcRenderer.send("ciro:open-external", String(url)),
  onUpdate: (handler) => {
    const listener = (_event, info) => handler(info);
    ipcRenderer.on("ciro:update", listener);
    return () => ipcRenderer.removeListener("ciro:update", listener);
  },
  updateAction: (action) => {
    if (["download", "install", "check"].includes(action)) ipcRenderer.send("ciro:update-action", action);
  },
  exportPdf: (name) => ipcRenderer.invoke("ciro:export-pdf", String(name || "Ciro"))
});

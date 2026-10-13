const { contextBridge, ipcRenderer } = require("electron");

const COMMANDS = new Set(["new-chat", "search", "settings", "toggle-sidebar", "shortcuts", "about", "export-chat", "export-pdf", "focus-composer", "find"]);

contextBridge.exposeInMainWorld("ciroDesktop", {
  platform: process.platform,
  version: ipcRenderer.sendSync("ciro:version"),
  setLanguage: (language) => {
    if (language === "zh-CN" || language === "zh-TW" || language === "en") ipcRenderer.send("ciro:set-language", language);
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
  exportPdf: (name) => ipcRenderer.invoke("ciro:export-pdf", String(name || "Ciro")),
  openWindow: (chatId) => ipcRenderer.send("ciro:open-window", chatId ? String(chatId) : ""),
  // Work mode: native folder chooser for the folders this computer allows remote tasks in.
  pickFolder: () => ipcRenderer.invoke("ciro:pick-folder"),
  openConfig: () => ipcRenderer.send("ciro:open-config")
});

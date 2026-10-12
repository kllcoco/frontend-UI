const { contextBridge, ipcRenderer } = require("electron");

const COMMANDS = new Set(["new-chat", "search", "settings", "toggle-sidebar", "shortcuts", "about", "export-chat"]);

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
  openExternal: (url) => ipcRenderer.send("ciro:open-external", String(url))
});

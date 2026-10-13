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
  openConfig: () => ipcRenderer.send("ciro:open-config"),
  // Quick-ask window (global shortcut): clipboard text arrives with each show.
  onQuick: (handler) => {
    const listener = (_event, info) => handler({ clipboard: typeof info?.clipboard === "string" ? info.clipboard : "" });
    ipcRenderer.on("ciro:quick", listener);
    return () => ipcRenderer.removeListener("ciro:quick", listener);
  },
  quickHide: () => ipcRenderer.send("ciro:quick-hide"),
  quickContinue: (chatId) => ipcRenderer.send("ciro:quick-continue", String(chatId || "")),
  // Desktop pet window and the main window's signals to it.
  pet: {
    setIgnore: (ignore) => ipcRenderer.send("ciro:pet-ignore", Boolean(ignore)),
    drag: (phase) => { if (["start", "move", "end"].includes(phase)) ipcRenderer.send("ciro:pet-drag", phase); },
    action: (action) => { if (["open", "quick", "hide"].includes(action)) ipcRenderer.send("ciro:pet-action", action); },
    signal: (signal) => { if (["thinking", "done", "error"].includes(signal)) ipcRenderer.send("ciro:pet-signal", signal); },
    visible: () => ipcRenderer.sendSync("ciro:pet-state"),
    toggle: (on) => ipcRenderer.send("ciro:pet-toggle", Boolean(on)),
    command: (cmd) => ipcRenderer.send("ciro:pet-command", { mood: String(cmd?.mood || ""), say: String(cmd?.say || "").slice(0, 40) }),
    onCommand: (handler) => {
      const listener = (_event, p) => handler({ mood: typeof p?.mood === "string" ? p.mood : undefined, say: typeof p?.say === "string" ? p.say : undefined });
      ipcRenderer.on("ciro:pet-command", listener);
      return () => ipcRenderer.removeListener("ciro:pet-command", listener);
    },
    onCursor: (handler) => {
      const listener = (_event, p) => { if (Number.isFinite(p?.x) && Number.isFinite(p?.y)) handler({ x: p.x, y: p.y }); };
      ipcRenderer.on("ciro:pet-cursor", listener);
      return () => ipcRenderer.removeListener("ciro:pet-cursor", listener);
    },
    onSignal: (handler) => {
      const listener = (_event, p) => handler({ signal: String(p?.signal || ""), focused: Boolean(p?.focused) });
      ipcRenderer.on("ciro:pet-signal", listener);
      return () => ipcRenderer.removeListener("ciro:pet-signal", listener);
    }
  },
  onOpenChat: (handler) => {
    const listener = (_event, id) => { if (typeof id === "string") handler(id); };
    ipcRenderer.on("ciro:open-chat", listener);
    return () => ipcRenderer.removeListener("ciro:open-chat", listener);
  }
});

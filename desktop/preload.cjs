const { contextBridge, ipcRenderer } = require("electron");

const COMMANDS = new Set(["open-work", "new-chat", "search", "settings", "toggle-sidebar", "shortcuts", "about", "export-chat", "export-pdf", "focus-composer", "find"]);

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
  // Work mode on this computer when the window shows the official service (see ciro:local-api in main.cjs).
  localApi: (path, body) => ipcRenderer.invoke("ciro:local-api", { path: String(path || ""), ...(body === undefined ? {} : { body }) }),
  pet: {
    setIgnore: (ignore) => ipcRenderer.send("ciro:pet-ignore", Boolean(ignore)),
    drag: (phase) => { if (["start", "move", "end"].includes(phase)) ipcRenderer.send("ciro:pet-drag", phase); },
    action: (action) => { if (["open", "quick", "hide", "work"].includes(action)) ipcRenderer.send("ciro:pet-action", action); },
    setQuiet: (on) => ipcRenderer.send("ciro:pet-quiet", Boolean(on)),
    onQuiet: (handler) => {
      const listener = (_event, on) => handler(Boolean(on));
      ipcRenderer.on("ciro:pet-quiet", listener);
      return () => ipcRenderer.removeListener("ciro:pet-quiet", listener);
    },
    signal: (signal) => { if (["thinking", "done", "error"].includes(signal)) ipcRenderer.send("ciro:pet-signal", signal); },
    visible: () => ipcRenderer.sendSync("ciro:pet-state"),
    toggle: (on) => ipcRenderer.send("ciro:pet-toggle", Boolean(on)),
    resize: (scale) => { const v = Number(scale); if (Number.isFinite(v)) ipcRenderer.send("ciro:pet-resize", v); },
    move: (dx, done) => { const v = Number(dx); if (Number.isFinite(v)) ipcRenderer.send("ciro:pet-move", { dx: Math.max(-40, Math.min(40, v)), done: Boolean(done) }); },
    onScale: (handler) => {
      const listener = (_event, v) => handler(Number(v));
      ipcRenderer.on("ciro:pet-scale", listener);
      return () => ipcRenderer.removeListener("ciro:pet-scale", listener);
    },
    expand: (on) => ipcRenderer.send("ciro:pet-expand", Boolean(on)),
    stream: (s) => ipcRenderer.send("ciro:pet-stream", { id: String(s?.id || "").slice(0, 80), text: String(s?.text || "").slice(-4000),
      done: Boolean(s?.done), error: Boolean(s?.error), title: String(s?.title || "").slice(0, 80) }),
    onStream: (handler) => {
      const listener = (_event, s) => handler(s);
      ipcRenderer.on("ciro:pet-stream", listener);
      return () => ipcRenderer.removeListener("ciro:pet-stream", listener);
    },
    toEdge: () => ipcRenderer.send("ciro:pet-edge", "auto"),
    unedge: () => ipcRenderer.send("ciro:pet-edge", "none"),
    onEdge: (handler) => {
      const listener = (_event, edge) => handler(edge || null);
      ipcRenderer.on("ciro:pet-edge", listener);
      return () => ipcRenderer.removeListener("ciro:pet-edge", listener);
    },
    progress: (p) => ipcRenderer.send("ciro:pet-progress", {
      text: String(p?.text || "").slice(0, 60), percent: Number.isFinite(p?.percent) ? Number(p.percent) : undefined,
      done: Boolean(p?.done), ok: p?.ok === false ? false : true, attention: Boolean(p?.attention), source: String(p?.source || "").slice(0, 20) }),
    onProgress: (handler) => {
      const listener = (_event, p) => handler(p);
      ipcRenderer.on("ciro:pet-progress", listener);
      return () => ipcRenderer.removeListener("ciro:pet-progress", listener);
    },
    command: (cmd) => ipcRenderer.send("ciro:pet-command", { mood: String(cmd?.mood || ""), say: String(cmd?.say || "").slice(0, 40), action: String(cmd?.action || "") }),
    onCommand: (handler) => {
      const listener = (_event, p) => handler({ mood: typeof p?.mood === "string" ? p.mood : undefined, say: typeof p?.say === "string" ? p.say : undefined,
        action: typeof p?.action === "string" ? p.action : undefined });
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

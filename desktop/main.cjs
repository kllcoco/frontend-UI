// Ciro desktop shell: runs the bundled Node API + web UI on a private loopback port.
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, shell } = require("electron");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { strings, pickLanguage } = require("./menu-i18n.cjs");

const REPO_URL = "https://github.com/kllcoco/frontend-UI";
const isMac = process.platform === "darwin";
let mainWindow = null;
let serverOrigin = null;
let language = "en";
let tray = null;
let isQuitting = false;
let trayHintShown = false;
let updater = null;
let manualUpdateCheck = false;
const HOTKEY = isMac ? "Alt+Space" : "Alt+Space";
// Quick ask: a small always-on-top window; text copied just before is brought along.
const QUICK_HOTKEY = "CommandOrControl+Shift+Space";
let quickWindow = null;

app.setName("Ciro");
if (!app.requestSingleInstanceLock()) app.quit();

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function dataDir() {
  const dir = path.join(app.getPath("userData"), "workspace");
  mkdirSync(dir, { recursive: true });
  const env = path.join(dir, ".env");
  if (!existsSync(env)) {
    writeFileSync(env, [
      "# Ciro desktop configuration. Restart Ciro after editing.",
      "# Connect an OpenAI-compatible chat completions endpoint:",
      "CIRO_API_BASE_URL=",
      "CIRO_API_PATH=/chat/completions",
      "CIRO_MODEL=ciro",
      "CIRO_MODELS=",
      "CIRO_API_KEY=",
      "# Forward the thinking-depth slider as reasoning_effort (on/off)",
      "CIRO_REASONING_EFFORT=on",
      ""
    ].join("\n"));
  }
  return dir;
}

async function startServer() {
  const dir = dataDir();
  process.chdir(dir); // dotenv + runtime state live in the per-user workspace, never inside the app bundle
  const port = await freePort();
  process.env.PORT = String(port);
  process.env.HOST = "127.0.0.1";
  process.env.CIRO_WORKSPACE_DATA_DIR = process.env.CIRO_WORKSPACE_DATA_DIR || path.join(dir, ".ciro-runtime");
  await import(pathToFileURL(path.join(__dirname, "..", "server", "index.mjs")).href);
  const origin = "http://127.0.0.1:" + port;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(origin + "/api/status");
      if (response.ok) return origin;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local API did not become ready on " + origin);
}

function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

/* ── Auto update (GitHub Releases via electron-updater) ── */
function setupUpdater() {
  if (!app.isPackaged || process.env.CIRO_DESKTOP_SMOKE) return;
  try { updater = require("electron-updater").autoUpdater; } catch { return; }
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-available", (info) => toRenderer("ciro:update", { state: "available", version: info.version }));
  updater.on("update-not-available", () => {
    if (manualUpdateCheck) {
      const s = strings(language);
      void dialog.showMessageBox({ type: "info", message: s.upToDate, detail: "Ciro " + app.getVersion() });
    }
    manualUpdateCheck = false;
  });
  updater.on("download-progress", (p) => toRenderer("ciro:update", { state: "downloading", percent: Math.round(p.percent || 0) }));
  updater.on("update-downloaded", (info) => toRenderer("ciro:update", { state: "ready", version: info.version }));
  updater.on("error", (error) => {
    toRenderer("ciro:update", { state: "error", message: String(error && error.message || error).slice(0, 200) });
    if (manualUpdateCheck) void shell.openExternal(REPO_URL + "/releases/latest");
    manualUpdateCheck = false;
  });
  setTimeout(() => { void updater.checkForUpdates().catch(() => {}); }, 8000);
  setInterval(() => { void updater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
}
function checkForUpdates() {
  if (!updater) { void shell.openExternal(REPO_URL + "/releases/latest"); return; }
  manualUpdateCheck = true;
  void updater.checkForUpdates().catch(() => {});
}

/* ── Tray + global shortcut ── */
function setupTray() {
  const s = strings(language);
  if (!tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, "..", "build", "icon.png")).resize({ width: isMac ? 18 : 20, height: isMac ? 18 : 20 });
    tray = new Tray(icon);
    tray.on("click", () => { if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) mainWindow.hide(); else showWindow(); });
  }
  tray.setToolTip("Ciro");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: s.showCiro, click: showWindow },
    { label: s.newChat, click: () => { showWindow(); send("new-chat"); } },
    { label: s.quickAsk, click: () => showQuick() },
    { label: s.pet, type: "checkbox", checked: petVisible(), click: (item) => { if (item.checked) showPet(); else hidePet(); } },
    { type: "separator" },
    { label: s.updates, click: checkForUpdates },
    { type: "separator" },
    { label: s.quit, click: () => { isQuitting = true; app.quit(); } }
  ]));
}
function showQuick() {
  if (!serverOrigin) return;
  if (!quickWindow || quickWindow.isDestroyed()) {
    quickWindow = new BrowserWindow({
      width: 680, height: 480, minWidth: 420, minHeight: 260, show: false, frame: false, resizable: true,
      alwaysOnTop: true, skipTaskbar: true, fullscreenable: false, title: "Ciro",
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#15120f" : "#f8f5ef",
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true }
    });
    quickWindow.on("blur", () => { if (quickWindow && !quickWindow.webContents.isDevToolsOpened()) quickWindow.hide(); });
    quickWindow.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) void shell.openExternal(url); return { action: "deny" }; });
    quickWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    void quickWindow.loadURL(serverOrigin + "/?quick=1");
  }
  // Centre on the display under the mouse, a little above the middle.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const { width, height } = quickWindow.getBounds();
  quickWindow.setPosition(Math.round(area.x + (area.width - width) / 2), Math.round(area.y + (area.height - height) / 3));
  const text = (clipboard.readText() || "").slice(0, 8000);
  const reveal = () => { quickWindow.show(); quickWindow.focus(); quickWindow.webContents.send("ciro:quick", { clipboard: text }); };
  if (quickWindow.webContents.isLoading()) quickWindow.webContents.once("did-finish-load", reveal); else reveal();
}
ipcMain.on("ciro:quick-hide", () => { if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide(); });
ipcMain.on("ciro:quick-continue", (_event, chatId) => {
  const id = typeof chatId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(chatId) ? chatId : "";
  if (quickWindow && !quickWindow.isDestroyed()) quickWindow.hide();
  showWindow();
  if (id) toRenderer("ciro:open-chat", id);
});

/* ── Desktop pet: chibi Ciro on the desktop (transparent, always on top, click-through outside her) ── */
let petWindow = null;
let petTimer = null;
const PET_SIZE = { width: 240, height: 340 };
const petFile = () => path.join(app.getPath("userData"), "pet.json");
// Off until the user turns it on (tray menu or Settings).
function petPrefs() {
  try { return { enabled: false, ...JSON.parse(readFileSync(petFile(), "utf8")) }; } catch { return { enabled: false }; }
}
function savePet(patch) {
  try { writeFileSync(petFile(), JSON.stringify({ ...petPrefs(), ...patch })); } catch { /* read-only profile */ }
}
function petVisible() { return Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()); }
function showPet() {
  if (!serverOrigin) return;
  if (!petWindow || petWindow.isDestroyed()) {
    const saved = petPrefs();
    const area = screen.getPrimaryDisplay().workArea;
    // Keep a saved spot only if it is still on some screen.
    const onScreen = Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some((d) => {
      const a = d.workArea; return saved.x > a.x - 150 && saved.x < a.x + a.width - 80 && saved.y > a.y - 100 && saved.y < a.y + a.height - 120;
    });
    petWindow = new BrowserWindow({
      ...PET_SIZE, x: onScreen ? saved.x : area.x + area.width - PET_SIZE.width - 24, y: onScreen ? saved.y : area.y + area.height - PET_SIZE.height,
      show: false, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: false, alwaysOnTop: true, title: "Ciro", backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    petWindow.setAlwaysOnTop(true, "floating");
    petWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: false });
    petWindow.setIgnoreMouseEvents(true, { forward: true });
    petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    petWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    petWindow.once("ready-to-show", () => petWindow.showInactive());
    petWindow.on("closed", () => { petWindow = null; if (petTimer) { clearInterval(petTimer); petTimer = null; } });
    void petWindow.loadURL(serverOrigin + "/?pet=1");
    // Her eyes follow the mouse anywhere on screen (only sent when it moves).
    let last = "";
    petTimer = setInterval(() => {
      if (!petVisible()) return;
      const c = screen.getCursorScreenPoint(), b = petWindow.getBounds();
      const key = c.x + "," + c.y;
      if (key === last) return;
      last = key;
      petWindow.webContents.send("ciro:pet-cursor", { x: c.x - b.x, y: c.y - b.y });
    }, 120);
  } else petWindow.showInactive();
  savePet({ enabled: true });
  setupTray();
}
function hidePet() {
  if (petWindow && !petWindow.isDestroyed()) petWindow.close();
  savePet({ enabled: false });
  setupTray();
}
function toPet(channel, payload) { if (petVisible()) petWindow.webContents.send(channel, payload); }
let petDrag = null;
ipcMain.on("ciro:pet-ignore", (_event, ignore) => { if (petWindow && !petWindow.isDestroyed()) petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true }); });
ipcMain.on("ciro:pet-drag", (_event, phase) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const c = screen.getCursorScreenPoint();
  if (phase === "start") { const b = petWindow.getBounds(); petDrag = { dx: c.x - b.x, dy: c.y - b.y }; return; }
  if (!petDrag) return;
  petWindow.setPosition(Math.round(c.x - petDrag.dx), Math.round(c.y - petDrag.dy));
  if (phase === "end") { petDrag = null; const b = petWindow.getBounds(); savePet({ x: b.x, y: b.y }); }
});
ipcMain.on("ciro:pet-action", (_event, action) => {
  if (action === "open") showWindow();
  else if (action === "quick") showQuick();
  else if (action === "hide") hidePet();
});
// The main window tells the pet what Ciro is doing (thinking / answered); the pet reacts.
ipcMain.on("ciro:pet-signal", (_event, signal) => {
  if (["thinking", "done", "error"].includes(signal)) toPet("ciro:pet-signal", { signal, focused: Boolean(mainWindow && mainWindow.isFocused()) });
});
// The model's <pet> tag: a mood and a short line.
ipcMain.on("ciro:pet-command", (_event, cmd) => {
  const mood = typeof cmd?.mood === "string" && /^[a-z]{2,8}$/.test(cmd.mood) ? cmd.mood : undefined;
  const say = typeof cmd?.say === "string" ? cmd.say.slice(0, 40) : undefined;
  const action = typeof cmd?.action === "string" && /^[a-z]{2,8}$/.test(cmd.action) ? cmd.action : undefined;
  if (mood || say || action) toPet("ciro:pet-command", { mood, say, action });
});
ipcMain.on("ciro:pet-state", (event) => { event.returnValue = petVisible(); });
ipcMain.on("ciro:pet-toggle", (_event, on) => { if (on) showPet(); else hidePet(); });

function setupHotkey() {
  try { globalShortcut.register(QUICK_HOTKEY, () => { if (quickWindow && quickWindow.isVisible()) quickWindow.hide(); else showQuick(); }); }
  catch { /* another app owns the shortcut */ }
  try {
    globalShortcut.register(HOTKEY, () => {
      if (mainWindow && mainWindow.isVisible() && mainWindow.isFocused()) { mainWindow.hide(); return; }
      showWindow();
      send("focus-composer");
    });
  } catch { /* another app owns the shortcut */ }
}

function send(command) {
  const target = BrowserWindow.getFocusedWindow() || mainWindow;
  if (!target) return;
  if (target.isMinimized()) target.restore();
  target.show();
  target.webContents.send("ciro:command", command);
}

function buildMenu() {
  const s = strings(language);
  const template = [
    ...(isMac ? [{
      label: "Ciro",
      submenu: [
        { label: s.about, click: () => send("about") },
        { label: s.updates, click: checkForUpdates },
        { type: "separator" },
        { label: s.settings, accelerator: "Cmd+,", click: () => send("settings") },
        { type: "separator" },
        { role: "services", label: s.services },
        { type: "separator" },
        { role: "hide", label: s.hide },
        { role: "hideOthers", label: s.hideOthers },
        { role: "unhide", label: s.unhide },
        { type: "separator" },
        { role: "quit", label: s.quit }
      ]
    }] : []),
    {
      label: s.file,
      submenu: [
        { label: s.newChat, accelerator: "CmdOrCtrl+Shift+O", click: () => send("new-chat") },
        { label: s.newWindow, accelerator: "CmdOrCtrl+Shift+N", click: () => createWindow("/") },
        { label: s.search, accelerator: "CmdOrCtrl+K", click: () => send("search") },
        { label: s.exportChat, accelerator: "CmdOrCtrl+Shift+E", click: () => send("export-chat") },
        { label: s.exportPdf, accelerator: "CmdOrCtrl+P", click: () => send("export-pdf") },
        { type: "separator" },
        { label: s.openConfig, click: () => shell.openPath(dataDir()) },
        { label: s.editEnv, click: () => shell.openPath(path.join(dataDir(), ".env")) },
        ...(isMac ? [] : [
          { type: "separator" },
          { label: s.settings, accelerator: "Ctrl+,", click: () => send("settings") },
          { type: "separator" },
          { role: "quit", label: s.quit, accelerator: "Ctrl+Q" }
        ]),
        ...(isMac ? [{ type: "separator" }, { role: "close", label: s.close }] : [])
      ]
    },
    {
      label: s.edit,
      submenu: [
        { role: "undo", label: s.undo },
        { role: "redo", label: s.redo },
        { type: "separator" },
        { role: "cut", label: s.cut },
        { role: "copy", label: s.copy },
        { role: "paste", label: s.paste },
        ...(isMac ? [{ role: "pasteAndMatchStyle", label: s.pasteMatch }] : []),
        { role: "delete", label: s.delete },
        { type: "separator" },
        { role: "selectAll", label: s.selectAll },
        { type: "separator" },
        { label: s.find, accelerator: "CmdOrCtrl+F", click: () => send("find") }
      ]
    },
    {
      label: s.view,
      submenu: [
        { label: s.toggleSidebar, accelerator: "CmdOrCtrl+Shift+S", click: () => send("toggle-sidebar") },
        { type: "separator" },
        { role: "reload", label: s.reload },
        { role: "forceReload", label: s.forceReload },
        { role: "toggleDevTools", label: s.devtools },
        { type: "separator" },
        { role: "resetZoom", label: s.resetZoom },
        { role: "zoomIn", label: s.zoomIn },
        { role: "zoomOut", label: s.zoomOut },
        { type: "separator" },
        { role: "togglefullscreen", label: s.fullscreen },
        { label: s.alwaysOnTop, type: "checkbox", checked: Boolean(BrowserWindow.getFocusedWindow()?.isAlwaysOnTop()),
          click: (item) => { const w = BrowserWindow.getFocusedWindow() || mainWindow; if (w) w.setAlwaysOnTop(item.checked, "floating"); } }
      ]
    },
    {
      label: s.window,
      submenu: [
        { role: "minimize", label: s.minimize },
        { role: "zoom", label: s.zoom },
        ...(isMac ? [{ type: "separator" }, { role: "front", label: s.front }] : [{ role: "close", label: s.close }])
      ]
    },
    {
      role: "help",
      label: s.help,
      submenu: [
        { label: s.shortcuts, accelerator: "CmdOrCtrl+/", click: () => send("shortcuts") },
        { label: s.website, click: () => shell.openExternal(REPO_URL) },
        { label: s.updates, click: checkForUpdates },
        { label: s.hotkeyHint + " (" + (isMac ? "⌥ Space" : "Alt+Space") + ")", enabled: false },
        { label: s.quickAsk + " (" + (isMac ? "⌘⇧ Space" : "Ctrl+Shift+Space") + ")", click: () => showQuick() },
        ...(isMac ? [] : [{ type: "separator" }, { label: s.about, click: () => send("about") }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (tray) setupTray();
}

function createWindow(route = "/") {
  const first = !mainWindow;
  const offset = first ? 0 : 28 * (BrowserWindow.getAllWindows().length % 6);
  const win = new BrowserWindow({
    ...(first ? {} : { x: (mainWindow.getBounds().x || 0) + offset + 28, y: (mainWindow.getBounds().y || 0) + offset + 28 }),
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Ciro",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#15120f" : "#f8f5ef",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 18 },
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true
    }
  });
  win.once("ready-to-show", () => win.show());
  // Smoke-test hook used by CI: capture the first rendered frame and exit.
  if (process.env.CIRO_DESKTOP_SMOKE) {
    win.webContents.once("did-finish-load", () => setTimeout(async () => {
      const image = await win.webContents.capturePage();
      writeFileSync(process.env.CIRO_DESKTOP_SMOKE, image.toPNG());
      const menu = Menu.getApplicationMenu();
      writeFileSync(process.env.CIRO_DESKTOP_SMOKE + ".menu.json", JSON.stringify({
        language, items: menu ? menu.items.map((item) => ({ label: item.label, sub: item.submenu ? item.submenu.items.map((x) => x.label).filter(Boolean) : [] })) : []
      }, null, 2));
      app.quit();
    }, 2500));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(serverOrigin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  // Closing the main window keeps Ciro in the tray (Windows/Linux) so the global shortcut still works.
  win.on("close", (event) => {
    if (!first || isQuitting || isMac || process.env.CIRO_DESKTOP_SMOKE || !tray) return;
    event.preventDefault();
    win.hide();
    if (!trayHintShown && tray.displayBalloon) {
      trayHintShown = true;
      tray.displayBalloon({ title: "Ciro", content: strings(language).trayHint });
    }
  });
  win.on("closed", () => { if (first) mainWindow = null; });
  if (first) mainWindow = win;
  void win.loadURL(serverOrigin + route);
  return win;
}

ipcMain.on("ciro:version", (event) => { event.returnValue = app.getVersion(); });
ipcMain.on("ciro:open-window", (_event, chatId) => {
  const id = typeof chatId === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(chatId) ? chatId : null;
  createWindow(id ? "/?chat=" + encodeURIComponent(id) : "/");
});
ipcMain.on("ciro:set-language", (_event, next) => {
  if ((next === "zh-CN" || next === "zh-TW" || next === "en") && next !== language) {
    language = next;
    buildMenu();
  }
});
ipcMain.on("ciro:update-action", (_event, action) => {
  if (!updater) { void shell.openExternal(REPO_URL + "/releases/latest"); return; }
  if (action === "download") void updater.downloadUpdate().catch(() => shell.openExternal(REPO_URL + "/releases/latest"));
  if (action === "install") { isQuitting = true; updater.quitAndInstall(); }
  if (action === "check") checkForUpdates();
});
ipcMain.handle("ciro:export-pdf", async (_event, name) => {
  if (!mainWindow) return false;
  const safe = String(name || "Ciro").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 80) || "Ciro";
  const target = await dialog.showSaveDialog(mainWindow, { defaultPath: safe + ".pdf", filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (target.canceled || !target.filePath) return false;
  const pdf = await mainWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4", margins: { marginType: "default" } });
  writeFileSync(target.filePath, pdf);
  void shell.showItemInFolder(target.filePath);
  return true;
});
// First-run card: open the model connection settings (.env) from the welcome screen.
ipcMain.on("ciro:open-config", () => { shell.openPath(path.join(dataDir(), ".env")); });

ipcMain.handle("ciro:pick-folder", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0] || null;
});
ipcMain.on("ciro:open-external", (_event, url) => {
  if (/^https:\/\//i.test(url)) void shell.openExternal(url);
});

app.on("second-instance", () => showWindow());

app.whenReady().then(async () => {
  language = pickLanguage(app.getPreferredSystemLanguages?.() || [app.getLocale()]);
  buildMenu();
  try {
    serverOrigin = await startServer();
  } catch (error) {
    dialog.showErrorBox(strings(language).startupError, String(error && error.stack || error));
    app.quit();
    return;
  }
  createWindow();
  if (!process.env.CIRO_DESKTOP_SMOKE) {
    try { setupTray(); } catch { tray = null; }
    setupHotkey();
    if (petPrefs().enabled) setTimeout(showPet, 1500);
  }
  setupUpdater();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showWindow(); });
});

app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => { globalShortcut.unregisterAll(); });
app.on("window-all-closed", () => { if (!isMac) app.quit(); });

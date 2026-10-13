// Ciro desktop shell: runs the bundled Node API + web UI on a private loopback port.
const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, session, shell } = require("electron");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { strings, pickLanguage } = require("./menu-i18n.cjs");

const REPO_URL = "https://github.com/kllcoco/frontend-UI";
const isMac = process.platform === "darwin";
let mainWindow = null;
let serverOrigin = null;
// The company's Ciro service, written into desktop/official.json at release time (repo variable CIRO_OFFICIAL_SERVER).
// When set, chats run there (accounts, CWU); the local server still drives the pet, work mode and quick tools.
const OFFICIAL = (() => {
  try {
    const v = String(JSON.parse(readFileSync(path.join(__dirname, "official.json"), "utf8")).server || "").trim().replace(/\/+$/, "");
    return /^https:\/\/[^/\s]+$/i.test(v) ? v : "";
  } catch { return ""; }
})();
/** Where the chat windows load from. */
const appOrigin = () => OFFICIAL || serverOrigin;
let language = "en";
let tray = null;
let isQuitting = false;
let trayHintShown = false;
let updater = null;
let manualUpdateCheck = ""; // "", "menu" or "app"
let downloading = false;
let downloadedVersion = "";
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
  // Work mode steps on this computer → the desktop pet tells you how it is going.
  try {
    const { activity } = await import(pathToFileURL(path.join(__dirname, "..", "server", "activity.mjs")).href);
    activity.on("progress", (p) => petProgress(p));
  } catch { /* older server bundle */ }
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
  updater.on("update-available", (info) => {
    manualUpdateCheck = "";
    if (downloadedVersion && downloadedVersion === info.version) { toRenderer("ciro:update", { state: "ready", version: info.version }); return; }
    if (!downloading) toRenderer("ciro:update", { state: "available", version: info.version });
  });
  updater.on("update-not-available", () => {
    if (manualUpdateCheck === "menu") {
      const s = strings(language);
      void dialog.showMessageBox({ type: "info", message: s.upToDate, detail: "Ciro " + app.getVersion() });
    }
    if (manualUpdateCheck) toRenderer("ciro:update", { state: "latest", version: app.getVersion() });
    manualUpdateCheck = "";
  });
  let lastPetPercent = -10;
  updater.on("download-progress", (p) => {
    downloading = true;
    const percent = Math.round(p.percent || 0);
    toRenderer("ciro:update", { state: "downloading", percent });
    if (percent - lastPetPercent >= 10) { lastPetPercent = percent; petProgress({ text: "正在下载新版本", percent, source: "update" }); }
  });
  updater.on("update-downloaded", (info) => {
    downloading = false; downloadedVersion = info.version; lastPetPercent = -10;
    toRenderer("ciro:update", { state: "ready", version: info.version });
    petProgress({ text: "新版本 " + info.version + " 下载好了，重启就能用", done: true, ok: true, source: "update" });
  });
  updater.on("error", (error) => {
    downloading = false;
    toRenderer("ciro:update", { state: "error", manual: Boolean(manualUpdateCheck), message: String(error && error.message || error).slice(0, 200) });
    if (manualUpdateCheck === "menu") void shell.openExternal(REPO_URL + "/releases/latest");
    manualUpdateCheck = "";
  });
  setTimeout(() => { void updater.checkForUpdates().catch(() => {}); }, 8000);
  setInterval(() => { void updater.checkForUpdates().catch(() => {}); }, 6 * 60 * 60 * 1000);
}
/** Manual check from the menu / tray ("menu": answers with a dialog) or from Settings ("app": answers in the page). */
function checkForUpdates(from = "menu") {
  if (!updater) { void shell.openExternal(REPO_URL + "/releases/latest"); return; }
  if (downloadedVersion) { toRenderer("ciro:update", { state: "ready", version: downloadedVersion }); return; }
  if (downloading) return;
  manualUpdateCheck = from === "app" ? "app" : "menu";
  toRenderer("ciro:update", { state: "checking" });
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
    { label: s.updates, click: () => checkForUpdates("menu") },
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
    void quickWindow.loadURL(appOrigin() + "/?quick=1");
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
// Window size follows her size (pinch / wheel); room above her for the speech bubble.
const petSize = (scale) => ({ width: Math.max(180, Math.round(186 * scale + 54)), height: Math.round(248 * scale + 96) });
const petScale = () => { const v = Number(petPrefs().scale); return Number.isFinite(v) ? Math.min(1.6, Math.max(0.5, v)) : 0.8; };
const displayAt = (b) => screen.getDisplayMatching(b).workArea;
// Dock to physical monitor boundaries, not the work area (which excludes a taskbar/dock).
const displayBoundsAt = (b) => screen.getDisplayMatching(b).bounds;
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
    const size = petSize(petScale());
    const area = screen.getPrimaryDisplay().workArea;
    // Keep a saved spot only if it is still on some screen.
    const onScreen = Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some((d) => {
      const a = d.workArea; return saved.x > a.x - size.width && saved.x < a.x + a.width && saved.y > a.y - 100 && saved.y < a.y + a.height;
    });
    petWindow = new BrowserWindow({
      ...size, x: onScreen ? saved.x : area.x + area.width - size.width - 24, y: onScreen ? saved.y : area.y + area.height - size.height,
      show: false, frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: true, hasShadow: false, alwaysOnTop: true, title: "Ciro", backgroundColor: "#00000000", enableLargerThanScreen: true,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }
    });
    petWindow.setAlwaysOnTop(true, "floating");
    petWindow.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: false });
    petWindow.setIgnoreMouseEvents(true, { forward: true });
    petWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    petWindow.webContents.on("will-navigate", (event) => event.preventDefault());
    petWindow.once("ready-to-show", () => petWindow.showInactive());
    petExpanded = false;
    petWindow.on("closed", () => { petWindow = null; petDrag = null; if (petDragTimer) { clearInterval(petDragTimer); petDragTimer = null; } if (petTimer) { clearInterval(petTimer); petTimer = null; } });
    const edge = ["left", "right", "bottom", "top"].includes(saved.edge) && onScreen ? saved.edge : "";
    void petWindow.loadURL(serverOrigin + "/?pet=1&scale=" + petScale() + (edge ? "&edge=" + edge : "") + (saved.quiet ? "&quiet=1" : ""));
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
let petDrag = null, petDragTimer = null;
function movePetUnderCursor() {
  if (!petDrag || !petWindow || petWindow.isDestroyed()) return;
  // The page never said "end" (reloaded or crashed mid-drag): stop following the cursor after a while.
  if (Date.now() - petDrag.at > 60_000) { petDrag = null; if (petDragTimer) { clearInterval(petDragTimer); petDragTimer = null; } return; }
  const cursor = screen.getCursorScreenPoint(), b = petWindow.getBounds();
  const x = Math.round(cursor.x - petDrag.dx), y = Math.round(cursor.y - petDrag.dy);
  if (b.x !== x || b.y !== y) petWindow.setPosition(x, y);
}
ipcMain.on("ciro:pet-ignore", (_event, ignore) => { if (petWindow && !petWindow.isDestroyed()) petWindow.setIgnoreMouseEvents(Boolean(ignore), { forward: true }); });
ipcMain.on("ciro:pet-drag", (_event, phase) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  if (phase === "start") {
    const b = petWindow.getBounds(), cursor = screen.getCursorScreenPoint();
    petDrag = { dx: cursor.x - b.x, dy: cursor.y - b.y, at: Date.now() };
    // Native cursor polling stays smooth even when moving the transparent window pauses DOM pointermove events.
    if (petDragTimer) clearInterval(petDragTimer);
    petDragTimer = setInterval(movePetUnderCursor, 16);
    return;
  }
  if (!petDrag) return;
  movePetUnderCursor();
  if (phase === "end") {
    petDrag = null;
    if (petDragTimer) { clearInterval(petDragTimer); petDragTimer = null; }
    // Detect docking against full physical monitor bounds, not taskbar-inset workArea.
    const b = petWindow.getBounds(), a = displayBoundsAt(b);
    const edge = b.x < a.x - b.width * 0.25 ? "left" : b.x + b.width > a.x + a.width + b.width * 0.25 ? "right"
      : b.y + b.height > a.y + a.height + b.height * 0.2 ? "bottom" : (isMac ? b.y <= a.y + 2 : b.y < a.y - b.height * 0.3) ? "top" : "";
    if (edge) snapPet(edge);
    else {
      const safe = displayAt(b);
      const x = Math.min(Math.max(b.x, safe.x - b.width / 2), safe.x + safe.width - b.width / 2);
      const y = Math.min(Math.max(b.y, safe.y), safe.y + safe.height - b.height);
      petWindow.setPosition(Math.round(x), Math.round(y));
      savePet({ x: Math.round(x), y: Math.round(y) + (petExpanded ? REPLY_ROOM.extra : 0), edge: "" });
      petWindow.webContents.send("ciro:pet-edge", null);
    }
  }
});
/** Puts the window flush against a screen edge; the page then shows only her head. */
function snapPet(edge) {
  const b = petWindow.getBounds(), a = displayBoundsAt(b);
  const x = edge === "left" ? a.x : edge === "right" ? a.x + a.width - b.width : Math.min(Math.max(b.x, a.x), a.x + a.width - b.width);
  const y = edge === "bottom" ? a.y + a.height - b.height : edge === "top" ? a.y : Math.min(Math.max(b.y, a.y), a.y + a.height - b.height);
  petWindow.setPosition(Math.round(x), Math.round(y));
  savePet({ x: Math.round(x), y: Math.round(y) + (petExpanded ? REPLY_ROOM.extra : 0), edge });
  petWindow.webContents.send("ciro:pet-edge", edge);
}
ipcMain.on("ciro:pet-edge", (_event, what) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const b = petWindow.getBounds(), a = displayAt(b);
  if (what === "auto") { const physical = displayBoundsAt(b); snapPet(b.x + b.width / 2 < physical.x + physical.width / 2 ? "left" : "right"); return; }
  // Coming out: step a little away from the side edge.
  const prev = petPrefs().edge;
  const x = prev === "left" ? a.x + 12 : prev === "right" ? a.x + a.width - b.width - 12 : b.x;
  // from the top she drops down onto her feet
  const y = prev === "top" ? a.y + Math.round(b.height * 0.25) : b.y;
  petWindow.setPosition(Math.round(x), y);
  savePet({ x: Math.round(x), y: y + (petExpanded ? REPLY_ROOM.extra : 0), edge: "" });
});
// Walking along the screen on her own: small horizontal steps, kept on the screen.
ipcMain.on("ciro:pet-move", (_event, m) => {
  if (!petWindow || petWindow.isDestroyed() || petDrag || !m) return;
  const b = petWindow.getBounds(), a = displayAt(b);
  const x = Math.min(Math.max(b.x + Math.round(Number(m.dx) || 0), a.x), a.x + a.width - b.width);
  petWindow.setPosition(x, b.y);
  if (m.done) savePet({ x, y: b.y + (petExpanded ? REPLY_ROOM.extra : 0) });
});
ipcMain.on("ciro:pet-resize", (_event, value) => {
  if (!petWindow || petWindow.isDestroyed()) return;
  const scale = Math.min(1.6, Math.max(0.5, Number(value) || 0.8));
  const b = petWindow.getBounds(), edge = petPrefs().edge;
  const base = petSize(scale), size = petExpanded ? { width: Math.max(base.width, REPLY_ROOM.width), height: base.height + REPLY_ROOM.extra } : base;
  // Grow from her feet (bottom centre); against a side edge, stay flush with it.
  let x = Math.round(b.x + b.width / 2 - size.width / 2);
  if (edge === "left") x = b.x; else if (edge === "right") x = b.x + b.width - size.width;
  const y = b.y + b.height - size.height;
  petWindow.setBounds({ x, y, ...size });
  savePet({ scale, x, y: petExpanded ? y + REPLY_ROOM.extra : y });
  toPet("ciro:pet-scale", scale); // when the size came from the settings slider in the main window
});
ipcMain.on("ciro:pet-action", (_event, action) => {
  if (action === "open") showWindow();
  else if (action === "quick") showQuick();
  else if (action === "hide") hidePet();
  else if (action === "work") { showWindow(); send("open-work"); } // a work step waits for your decision
});
// The main window tells the pet what Ciro is doing (thinking / answered); the pet reacts.
ipcMain.on("ciro:pet-signal", (_event, signal) => {
  if (["thinking", "done", "error"].includes(signal)) toPet("ciro:pet-signal", { signal, focused: Boolean(mainWindow && mainWindow.isFocused()) });
});
// The model's <pet> tag: a mood and a short line.
ipcMain.on("ciro:pet-command", (_event, cmd) => {
  const mood = typeof cmd?.mood === "string" && /^[a-z]{2,8}$/.test(cmd.mood) ? cmd.mood : undefined;
  const say = typeof cmd?.say === "string" ? cmd.say.slice(0, 40) : undefined;
  const action = typeof cmd?.action === "string" && /^[a-z]{2,12}$/.test(cmd.action) ? cmd.action : undefined;
  if (mood || say || action) toPet("ciro:pet-command", { mood, say, action });
});
// Progress of work in progress (work mode on this computer, a reply written while the window is hidden, schedules…).
function petProgress(p) {
  if (!p || typeof p.text !== "string" || !p.text) return;
  toPet("ciro:pet-progress", { text: p.text.slice(0, 60), percent: Number.isFinite(p.percent) ? p.percent : undefined,
    done: Boolean(p.done), ok: p.ok !== false, attention: Boolean(p.attention), source: String(p.source || "") });
}
ipcMain.on("ciro:pet-progress", (_event, p) => petProgress(p));
// 更少对话 from the settings in the main window.
ipcMain.on("ciro:pet-quiet", (_event, on) => { savePet({ quiet: Boolean(on) }); toPet("ciro:pet-quiet", Boolean(on)); });
// Work mode's "this computer" controls live on the local server; with the official service loaded in the window
// the page reaches them through here (main-process requests carry no Origin, so the loopback-only checks pass).
ipcMain.handle("ciro:local-api", async (event, req) => {
  // Only Ciro's own pages (the official service or the local server), never a page navigated to elsewhere.
  let from = "";
  try { from = new URL(event.senderFrame?.url || "").origin; } catch { /* no frame */ }
  if (!from || (from !== OFFICIAL && from !== serverOrigin)) return { status: 403, body: { error: "forbidden" } };
  const p = String(req?.path || "");
  if (!/^\/[a-z0-9/_-]{0,80}$/i.test(p) || !serverOrigin) return { status: 400, body: { error: "bad path" } };
  const post = req.body !== undefined;
  const res = await fetch(serverOrigin + "/api/remote/local" + p, { method: post ? "POST" : "GET",
    headers: { "X-Ciro-Local": "1", ...(post ? { "Content-Type": "application/json" } : {}) }, ...(post ? { body: JSON.stringify(req.body) } : {}) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
});
// The reply being written, mirrored in her bubble.
ipcMain.on("ciro:pet-stream", (_event, s) => { if (s && typeof s.text === "string") toPet("ciro:pet-stream", s); });
// Room above her for the reply bubble: the window grows upwards (and a little wider) while it is shown.
const REPLY_ROOM = { width: 300, extra: 170 };
let petExpanded = false;
ipcMain.on("ciro:pet-expand", (_event, on) => {
  if (!petWindow || petWindow.isDestroyed() || Boolean(on) === petExpanded) return;
  petExpanded = Boolean(on);
  const b = petWindow.getBounds(), base = petSize(petScale()), edge = petPrefs().edge;
  const size = petExpanded ? { width: Math.max(base.width, REPLY_ROOM.width), height: base.height + REPLY_ROOM.extra } : base;
  let x = Math.round(b.x + b.width / 2 - size.width / 2);
  if (edge === "left") x = b.x; else if (edge === "right") x = b.x + b.width - size.width;
  const a = displayAt(b);
  x = Math.min(Math.max(x, a.x - size.width / 2), a.x + a.width - size.width / 2);
  petWindow.setBounds({ x: Math.round(x), y: b.y + b.height - size.height, ...size });
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
        { label: s.updates, click: () => checkForUpdates("menu") },
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
        { label: s.updates, click: () => checkForUpdates("menu") },
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
    let origin = "";
    try { origin = new URL(url).origin; } catch { /* not a URL */ }
    if (origin !== new URL(appOrigin()).origin && (!serverOrigin || origin !== new URL(serverOrigin).origin)) {
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
  void win.loadURL(appOrigin() + route);
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
  if (action === "download" && !downloading && !downloadedVersion) { downloading = true; void updater.downloadUpdate().catch(() => { downloading = false; void shell.openExternal(REPO_URL + "/releases/latest"); }); }
  if (action === "install") { isQuitting = true; updater.quitAndInstall(); }
  if (action === "check") checkForUpdates("app");
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

// "我的模型": providers the user added by API. Some of them don't allow direct calls from an app page (CORS); for
// exactly those hosts (sent by the page, http(s) only) the desktop app answers the CORS checks itself.
let modelHosts = new Set();
ipcMain.on("ciro:model-hosts", (_event, hosts) => {
  modelHosts = new Set((Array.isArray(hosts) ? hosts : []).filter((h) => typeof h === "string" && /^https?:\/\/[^/\s]+$/i.test(h)).slice(0, 30));
});
function allowModelHosts() {
  const filter = { urls: ["http://*/*", "https://*/*"] };
  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    let origin = "";
    try { origin = new URL(details.url).origin; } catch { /* not a URL */ }
    if (!modelHosts.has(origin)) { callback({}); return; }
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (/^access-control-allow-/i.test(k)) delete headers[k];
    headers["Access-Control-Allow-Origin"] = ["*"];
    headers["Access-Control-Allow-Headers"] = ["*, Authorization"]; // "*" alone never covers Authorization (API keys)
    headers["Access-Control-Allow-Methods"] = ["GET, POST, OPTIONS"];
    callback(details.method === "OPTIONS" ? { responseHeaders: headers, statusLine: "HTTP/1.1 204 No Content" } : { responseHeaders: headers });
  });
}

app.whenReady().then(async () => {
  allowModelHosts();
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

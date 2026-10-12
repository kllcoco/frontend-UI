// Ciro desktop shell: runs the bundled Node API + web UI on a private loopback port.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require("electron");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { strings, pickLanguage } = require("./menu-i18n.cjs");

const REPO_URL = "https://github.com/kllcoco/frontend-UI";
const isMac = process.platform === "darwin";
let mainWindow = null;
let serverOrigin = null;
let language = "en";

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

function send(command) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.webContents.send("ciro:command", command);
}

function buildMenu() {
  const s = strings(language);
  const template = [
    ...(isMac ? [{
      label: "Ciro",
      submenu: [
        { label: s.about, click: () => send("about") },
        { label: s.updates, click: () => shell.openExternal(REPO_URL + "/releases/latest") },
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
        { label: s.search, accelerator: "CmdOrCtrl+K", click: () => send("search") },
        { label: s.exportChat, accelerator: "CmdOrCtrl+Shift+E", click: () => send("export-chat") },
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
        { role: "selectAll", label: s.selectAll }
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
        { role: "togglefullscreen", label: s.fullscreen }
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
        { label: s.updates, click: () => shell.openExternal(REPO_URL + "/releases/latest") },
        ...(isMac ? [] : [{ type: "separator" }, { label: s.about, click: () => send("about") }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Ciro",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1b19" : "#faf9f6",
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
  mainWindow.once("ready-to-show", () => mainWindow.show());
  // Smoke-test hook used by CI: capture the first rendered frame and exit.
  if (process.env.CIRO_DESKTOP_SMOKE) {
    mainWindow.webContents.once("did-finish-load", () => setTimeout(async () => {
      const image = await mainWindow.webContents.capturePage();
      writeFileSync(process.env.CIRO_DESKTOP_SMOKE, image.toPNG());
      app.quit();
    }, 2500));
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(serverOrigin)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    }
  });
  mainWindow.on("closed", () => { mainWindow = null; });
  void mainWindow.loadURL(serverOrigin + "/");
}

ipcMain.on("ciro:version", (event) => { event.returnValue = app.getVersion(); });
ipcMain.on("ciro:set-language", (_event, next) => {
  if ((next === "zh-CN" || next === "en") && next !== language) {
    language = next;
    buildMenu();
  }
});
ipcMain.on("ciro:open-external", (_event, url) => {
  if (/^https:\/\//i.test(url)) void shell.openExternal(url);
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

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
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (!isMac) app.quit(); });

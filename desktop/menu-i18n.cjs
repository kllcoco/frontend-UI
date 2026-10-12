// Native menu strings. Chosen from the in-app language, falling back to the OS language.
const zh = {
  file: "文件", edit: "编辑", view: "视图", window: "窗口", help: "帮助",
  newChat: "新对话", search: "搜索对话…", exportChat: "导出当前对话", settings: "设置…",
  openConfig: "打开配置文件夹", editEnv: "编辑模型连接配置 (.env)", quit: "退出 Ciro", close: "关闭窗口",
  undo: "撤销", redo: "重做", cut: "剪切", copy: "复制", paste: "粘贴", pasteMatch: "粘贴并匹配样式",
  delete: "删除", selectAll: "全选", toggleSidebar: "显示/隐藏侧栏", reload: "重新加载", forceReload: "强制重新加载",
  devtools: "开发者工具", resetZoom: "实际大小", zoomIn: "放大", zoomOut: "缩小", fullscreen: "切换全屏",
  minimize: "最小化", zoom: "缩放", front: "全部置于顶层", shortcuts: "键盘快捷键", about: "关于 Ciro",
  website: "访问 GitHub 仓库", updates: "检查更新…", hide: "隐藏 Ciro", hideOthers: "隐藏其他", unhide: "全部显示",
  services: "服务", startupError: "Ciro 本地服务启动失败", exportPdf: "导出为 PDF…", upToDate: "已是最新版本",
  showCiro: "显示 Ciro", trayHint: "Ciro 仍在后台运行，可从托盘图标或 Alt+Space 唤出。", hotkeyHint: "全局唤出快捷键", newWindow: "新建窗口", find: "在对话中查找", alwaysOnTop: "窗口置顶"
};
const en = {
  file: "File", edit: "Edit", view: "View", window: "Window", help: "Help",
  newChat: "New Chat", search: "Search Chats…", exportChat: "Export Current Chat", settings: "Settings…",
  openConfig: "Open Config Folder", editEnv: "Edit Model Connection (.env)", quit: "Quit Ciro", close: "Close Window",
  undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", pasteMatch: "Paste and Match Style",
  delete: "Delete", selectAll: "Select All", toggleSidebar: "Toggle Sidebar", reload: "Reload", forceReload: "Force Reload",
  devtools: "Developer Tools", resetZoom: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out", fullscreen: "Toggle Full Screen",
  minimize: "Minimize", zoom: "Zoom", front: "Bring All to Front", shortcuts: "Keyboard Shortcuts", about: "About Ciro",
  website: "Visit GitHub Repository", updates: "Check for Updates…", hide: "Hide Ciro", hideOthers: "Hide Others", unhide: "Show All",
  services: "Services", startupError: "Ciro could not start its local service", exportPdf: "Export as PDF…", upToDate: "You're up to date",
  showCiro: "Show Ciro", trayHint: "Ciro is still running. Open it from the tray icon or with Alt+Space.", hotkeyHint: "Global shortcut", newWindow: "New Window", find: "Find in Chat", alwaysOnTop: "Always on Top"
};
const zhTW = {
  file: "檔案", edit: "編輯", view: "檢視", window: "視窗", help: "說明",
  newChat: "新對話", search: "搜尋對話…", exportChat: "匯出目前對話", settings: "設定…",
  openConfig: "開啟設定資料夾", editEnv: "編輯模型連線設定 (.env)", quit: "結束 Ciro", close: "關閉視窗",
  undo: "復原", redo: "重做", cut: "剪下", copy: "複製", paste: "貼上", pasteMatch: "貼上並符合樣式",
  delete: "刪除", selectAll: "全選", toggleSidebar: "顯示/隱藏側欄", reload: "重新載入", forceReload: "強制重新載入",
  devtools: "開發者工具", resetZoom: "實際大小", zoomIn: "放大", zoomOut: "縮小", fullscreen: "切換全螢幕",
  minimize: "最小化", zoom: "縮放", front: "全部移到最前", shortcuts: "鍵盤快速鍵", about: "關於 Ciro",
  website: "前往 GitHub 儲存庫", updates: "檢查更新…", hide: "隱藏 Ciro", hideOthers: "隱藏其他", unhide: "全部顯示",
  services: "服務", startupError: "Ciro 本機服務啟動失敗", exportPdf: "匯出為 PDF…", upToDate: "已是最新版本",
  showCiro: "顯示 Ciro", trayHint: "Ciro 仍在背景執行，可從系統匣圖示或 Alt+Space 喚出。", hotkeyHint: "全域喚出快速鍵", newWindow: "開新視窗", find: "在對話中尋找", alwaysOnTop: "視窗置頂"
};
function pickLanguage(preferred) {
  for (const tag of preferred) {
    const lower = String(tag || "").toLowerCase();
    if (/^zh-(tw|hk|mo)|^zh-hant/.test(lower)) return "zh-TW";
    if (lower.startsWith("zh")) return "zh-CN";
    if (lower.startsWith("en")) return "en";
  }
  return "en";
}
module.exports = { strings: (lang) => (lang === "zh-CN" ? zh : lang === "zh-TW" ? zhTW : en), pickLanguage };

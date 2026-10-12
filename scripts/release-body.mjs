// Builds the GitHub release text: per-platform download sections (from the files actually being published),
// then docs/RELEASE_NOTES.md and the server install guide.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir = "out", tag = "v0.0.0", repo = "kllcoco/frontend-UI"] = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => statSync(join(dir, f)).isFile()).sort();
const link = (f) => "[" + f + "](https://github.com/" + repo + "/releases/download/" + tag + "/" + encodeURIComponent(f) + ")";
const size = (f) => { const mb = statSync(join(dir, f)).size / 1048576; return mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(mb * 1024)) + " KB"; };
const describe = (f) => {
  if (/\.exe$/.test(f)) return "安装版（推荐）";
  if (/^Windows-.*\.zip$/.test(f)) return "免安装版，解压即用";
  if (/arm64\.dmg$/.test(f)) return "Apple 芯片（M 系列）安装包";
  if (/x64\.dmg$/.test(f)) return "Intel 芯片安装包";
  if (/^Mac-.*arm64\.zip$/.test(f)) return "Apple 芯片压缩包";
  if (/^Mac-.*x64\.zip$/.test(f)) return "Intel 芯片压缩包";
  if (/\.AppImage$/.test(f)) return "通用版，赋予执行权限后直接运行";
  if (/\.deb$/.test(f)) return "Debian / Ubuntu 安装包";
  if (/\.tar\.gz$/.test(f)) return "压缩包";
  if (/\.apk$/.test(f)) return "Android 7.0 及以上";
  if (/install\.sh$/.test(f)) return "Linux 服务器一键安装 / 升级脚本（见下方部署教程）";
  if (/\.tgz$/.test(f)) return "npm 包离线安装文件";
  return "";
};
const SECTIONS = [
  ["Windows", (f) => f.startsWith("Windows-") && !f.endsWith(".blockmap")],
  ["macOS", (f) => f.startsWith("Mac-") && !f.endsWith(".blockmap")],
  ["Linux", (f) => f.startsWith("Linux-")],
  ["Android", (f) => f.startsWith("Android-")],
  ["服务器部署", (f) => f.startsWith("Server-")]
];
const out = ["# Ciro " + tag, "", "## 下载", ""];
for (const [title, match] of SECTIONS) {
  const list = files.filter(match);
  if (!list.length) continue;
  out.push("### " + title, "", "| 文件 | 说明 | 大小 |", "| --- | --- | --- |", ...list.map((f) => "| " + link(f) + " | " + describe(f) + " | " + size(f) + " |"), "");
}
out.push("### iOS / iPadOS", "", "用 Safari 打开部署好的 Ciro 网址 → 分享 → “添加到主屏幕”。", "");
out.push("> 校验文件：" + files.filter((f) => f.startsWith("checksums")).map(link).join(" · ") + "。`latest*.yml` 与 `.blockmap` 供桌面端自动更新使用，无需下载。", "");
// RELEASE_NOTES.md: drop its own title and static download table, keep the change log.
const notes = readFileSync("docs/RELEASE_NOTES.md", "utf8").replace(/^# .*\n+/, "").replace(/## 下载[\s\S]*?(?=\n## )/, "").trim();
out.push(notes, "", "---", "", readFileSync("docs/INSTALL_SERVER.md", "utf8").trim(), "");
process.stdout.write(out.join("\n"));

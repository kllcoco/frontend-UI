// What this computer is working on, for the desktop pet: work-mode steps turned into short progress lines.
// The Electron main process listens (`activity.on("progress", …)`); a plain server has no listener and nothing happens.
import { EventEmitter } from "node:events";
import { basename } from "node:path";

export const activity = new EventEmitter();
activity.setMaxListeners(20);

const short = (text, n) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

/** One work-mode event → a progress line (or null when it is not worth telling). */
export function describeWork(session, type, data = {}) {
  const kind = session.kind;
  if (type === "status" && data.status !== "running" && data.status !== "waiting") session.announced = false;
  if (type === "status" && data.status === "running" && !session.announced) { session.announced = true; return { text: "开始工作：" + short(session.title, 22) }; }
  if (type === "tool") {
    if (data.action === "list" || data.action === "read") return { text: "正在看 " + short(basename(String(data.path || ".")), 26) };
    if (data.action === "write") return { text: "正在写 " + short(basename(String(data.path || "")), 26) };
    if (data.action === "run") return { text: "正在运行 " + short(data.command, 26) };
  }
  if (type === "approval_request") return { text: "需要你在手机上批准一下", attention: true };
  if (type === "agent" && data.final) return { text: "完成：" + short(data.text, 30), done: true, ok: true };
  if (type === "exit" && kind === "shell") return { text: "命令结束" + (data.code === 0 ? "" : "（退出码 " + data.code + "）"), done: true, ok: data.code === 0 };
  if (type === "status" && data.status === "failed") return { text: "任务出错了", done: true, ok: false };
  if (type === "status" && data.status === "stopped") return { text: "任务已停止", done: true, ok: false };
  return null;
}

export function reportWork(session, type, data) {
  if (!activity.listenerCount("progress")) return;
  const p = describeWork(session, type, data);
  if (p) activity.emit("progress", { ...p, source: "work" });
}

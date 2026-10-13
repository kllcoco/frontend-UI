/* Timed tasks set by talking to Ciro ("每天早上 8 点告诉我今天的安排", "半小时后提醒我喝水"): the model ends its reply
   with a <task>{JSON}</task> tag, the app keeps the task on this device and, when it is due, runs it (asks the model
   the task's prompt, or just reminds) and the pet comes out to tell you the result. */

export type TaskRepeat = "none" | "hourly" | "daily" | "weekdays" | "weekly";
export type CiroTask = { id: string; title: string; prompt: string; next: number; repeat: TaskRepeat; createdAt: number;
  lastRun?: number; lastResult?: string; conversationId?: string };

const KEY = "ciro.tasks.v1";
const REPEATS: TaskRepeat[] = ["none", "hourly", "daily", "weekdays", "weekly"];
/** A task missed while the app was closed still runs when it opens again, if it is not older than this. */
export const CATCH_UP_MS = 12 * 3600_000;

export function loadTasks(): CiroTask[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as CiroTask[];
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && Number.isFinite(x.next)).slice(0, 50) : [];
  } catch { return []; }
}
export function saveTasks(list: CiroTask[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("ciro-tasks", { detail: list }));
}

/** The next run after `from` for a repeating task (null for a one-off). */
export function nextRun(t: Pick<CiroTask, "next" | "repeat">, from = Date.now()): number | null {
  if (t.repeat === "none") return null;
  const d = new Date(t.next);
  const step = () => {
    if (t.repeat === "hourly") d.setHours(d.getHours() + 1);
    else if (t.repeat === "weekly") d.setDate(d.getDate() + 7);
    else d.setDate(d.getDate() + 1);
  };
  let guard = 0;
  do { step(); while (t.repeat === "weekdays" && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1); }
  while (d.getTime() <= from && ++guard < 10_000);
  return d.getTime();
}

/** "2026-10-14 08:00" / "2026-10-14T08:00" in local time → ms (null if unreadable). */
export function parseLocalTime(s: unknown): number | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const TAG = /<task\b[^>]*>([\s\S]*?)<\/task>/gi;
export function stripTaskTags(text: string): string {
  if (!text.includes("<task")) return text;
  return text.replace(TAG, "").replace(/<task\b[\s\S]*$/i, "").trimEnd();
}

export type TaskChange = { kind: "add"; task: CiroTask } | { kind: "cancel"; ids: string[] };
/** Reads the task tags of a reply into changes (at most 5): new tasks and cancellations. */
export function taskChanges(text: string, existing: CiroTask[], now = Date.now()): TaskChange[] {
  const out: TaskChange[] = [];
  for (const m of text.matchAll(TAG)) {
    if (out.length >= 5) break;
    let v: Record<string, unknown>;
    try { v = JSON.parse(m[1].trim()); } catch { continue; }
    if (!v || typeof v !== "object") continue;
    if (v.cancel !== undefined) {
      const key = String(v.cancel).trim().toLowerCase();
      const ids = key === "all" ? existing.map((x) => x.id)
        : existing.filter((x) => x.id === key || x.title.toLowerCase() === key || (key.length >= 2 && x.title.toLowerCase().includes(key))).map((x) => x.id);
      if (ids.length) out.push({ kind: "cancel", ids });
      continue;
    }
    const title = String(v.title || "").replace(/\s+/g, " ").trim().slice(0, 60);
    let at = parseLocalTime(v.at);
    if (at === null && Number.isFinite(Number(v.inMinutes)) && Number(v.inMinutes) > 0) at = now + Math.min(Number(v.inMinutes), 525_600) * 60_000;
    if (!title || at === null) continue;
    const repeat = REPEATS.includes(v.repeat as TaskRepeat) ? v.repeat as TaskRepeat : "none";
    // A time already passed today for a repeating task starts at its next turn.
    if (at <= now - 60_000) { if (repeat === "none") continue; at = nextRun({ next: at, repeat }, now) ?? at; }
    // A weekday task asked on a weekend starts on Monday.
    if (repeat === "weekdays") { const d = new Date(at); while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1); at = d.getTime(); }
    out.push({ kind: "add", task: { id: Math.random().toString(36).slice(2, 10), title, prompt: String(v.prompt || "").trim().slice(0, 2000),
      next: at, repeat, createdAt: now } });
  }
  return out;
}

/** Applies changes; returns the new list. */
export function applyTaskChanges(list: CiroTask[], changes: TaskChange[]): CiroTask[] {
  let next = [...list];
  for (const c of changes) {
    if (c.kind === "add") next = [...next, c.task];
    else next = next.filter((x) => !c.ids.includes(x.id));
  }
  return next.slice(-50);
}

/** Whether a message is about timing / reminders, so the task instructions go along (keeps other chats lean). */
export function wantsTasks(text: string, hasTasks: boolean): boolean {
  return /提醒|定时|闹钟|分钟后|小时后|每天|每周|每小时|工作日|明天|后天|今晚|早上|晚上|中午|下午|点钟|\d+\s*点|任务|日程|remind|schedule|every\s+(day|week|hour|morning)|tomorrow|tonight|in\s+\d+\s*(min|hour)|at\s+\d/i.test(text)
    || (hasTasks && /取消|删掉|删除|不用|cancel|stop/i.test(text));
}

/** The instructions for the model (also used for your own models, which get no server prompt). */
/** "2026-10-14 08:00" in local time. */
export function localStamp(ms: number): string {
  const d = new Date(ms), p = (x: number) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
/** What the model is told about the current tasks. */
export const taskBrief = (list: CiroTask[]) => list.map((x) => ({ id: x.id, title: x.title, when: localStamp(x.next), repeat: x.repeat }));
export function taskPrompt(now: string, list: { id: string; title: string; when: string; repeat: string }[]): string {
  return "You can set timed tasks for the user inside the Ciro app (it runs them on time and the desktop pet reports back). Local time now: " + now + ". " +
    "When the user asks for a reminder or something to be done at a time or on a schedule, confirm briefly in your reply and put at the very end " +
    "<task>{\"title\":\"short name\",\"at\":\"YYYY-MM-DD HH:mm\",\"repeat\":\"none|hourly|daily|weekdays|weekly\",\"prompt\":\"...\"}</task>. " +
    "\"prompt\" is what you will be asked to do when it is due (e.g. \"总结今天的科技新闻\"); leave it empty for a plain reminder. " +
    "For \"in N minutes\" you may use \"inMinutes\":N instead of \"at\". To cancel: <task>{\"cancel\":\"title or id or all\"}</task>. " +
    "Never mention the tag. Current tasks: " + (list.length ? list.map((x) => x.id + " 「" + x.title + "」 " + x.when + " " + x.repeat).join("; ") : "none") + ".";
}

export function formatWhen(task: CiroTask, locale: string, t: (s: string) => string): string {
  const d = new Date(task.next);
  const time = d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (task.repeat === "none") return d.toLocaleDateString(locale, { month: "numeric", day: "numeric" }) + " " + time;
  if (task.repeat === "hourly") return t("每小时");
  if (task.repeat === "weekly") return d.toLocaleDateString(locale, { weekday: "short" }) + " " + time + " · " + t("每周");
  return t(task.repeat === "daily" ? "每天" : "工作日") + " " + time;
}

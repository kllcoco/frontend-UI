import { useEffect, useState } from "react";
import { AlarmClock, Trash2 } from "lucide-react";
import { formatWhen, loadTasks, saveTasks } from "../lib/tasks";
import type { CiroTask } from "../lib/tasks";

/** Settings → 桌宠 → 定时任务: what Ciro was asked to do on time (set by talking to her), with a way to remove each. */
export default function TaskList({ t, locale }: { t: (s: string) => string; locale: string }) {
  const [list, setList] = useState<CiroTask[]>(loadTasks);
  useEffect(() => {
    const changed = () => setList(loadTasks());
    window.addEventListener("ciro-tasks", changed);
    return () => window.removeEventListener("ciro-tasks", changed);
  }, []);
  if (!list.length) return <p className="sc-help-text">{t("还没有定时任务。直接对 Ciro 说，例如“每天早上 8 点给我讲讲今天的科技新闻”或“半小时后提醒我喝水”，她会记下来，到点做完后出来告诉你。")}</p>;
  return <ul className="task-list">{[...list].sort((a, b) => a.next - b.next).map((x) => <li key={x.id}>
    <AlarmClock size={16}/>
    <div><strong>{x.title}</strong><small>{formatWhen(x, locale, t)}{x.prompt ? " · " + x.prompt.slice(0, 60) : " · " + t("提醒")}</small></div>
    <button type="button" className="cm-del" aria-label={t("删除") + " " + x.title} onClick={() => saveTasks(loadTasks().filter((y) => y.id !== x.id))}><Trash2 size={15}/></button>
  </li>)}</ul>;
}

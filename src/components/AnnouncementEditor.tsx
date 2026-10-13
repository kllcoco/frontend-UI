import { useEffect, useState } from "react";
import { Megaphone, Trash2 } from "lucide-react";
import { loadAnnouncements, publishAnnouncement, removeAnnouncement } from "../lib/announcements";
import type { Announcement } from "../lib/announcements";

/** Settings → 公告推送: the owner pushes a notice or offer to every installed app at once, no update needed. */
export default function AnnouncementEditor({ t }: { t: (s: string) => string }) {
  const [list, setList] = useState<Announcement[]>([]);
  const [form, setForm] = useState({ title: "", body: "", level: "promo", label: "", url: "", start: "", end: "", platforms: [] as string[] });
  const [msg, setMsg] = useState(""), [busy, setBusy] = useState(false);
  const refresh = () => loadAnnouncements().then((r) => setList(r.all || []), () => {});
  useEffect(() => { void refresh(); }, []);
  const set = (k: keyof typeof form, v: string | string[]) => setForm((f) => ({ ...f, [k]: v }));
  async function publish() {
    setBusy(true); setMsg("");
    try {
      await publishAnnouncement({ title: form.title, body: form.body, level: form.level as Announcement["level"],
        link: form.url ? { label: form.label || t("查看详情"), url: form.url } : null, platforms: form.platforms.length ? form.platforms : null,
        start: form.start ? new Date(form.start).toISOString() : null, end: form.end ? new Date(form.end).toISOString() : null });
      setForm({ title: "", body: "", level: "promo", label: "", url: "", start: "", end: "", platforms: [] });
      setMsg(t("已发布。已安装的应用在下次打开或 30 分钟内就会看到。"));
      window.dispatchEvent(new Event("ciro-announcements"));
      await refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <div className="ann-editor">
    <p className="api-muted">{t("在这里发布的公告（比如新套餐、限时优惠、维护通知）会直接推送到已安装的网页版、桌面版和 Android 版首页，用户不需要更新应用。")}</p>
    <div className="ann-form">
      <label>{t("标题")}<input value={form.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder={t("例如：专业版限时 8 折")}/></label>
      <label>{t("内容")}<textarea value={form.body} maxLength={600} rows={3} onChange={(e) => set("body", e.target.value)}/></label>
      <div className="ann-row">
        <label>{t("类型")}<select value={form.level} onChange={(e) => set("level", e.target.value)}>
          <option value="promo">{t("优惠 / 套餐")}</option><option value="info">{t("通知")}</option><option value="warning">{t("重要提醒")}</option></select></label>
        <label>{t("按钮文字")}<input value={form.label} maxLength={24} onChange={(e) => set("label", e.target.value)} placeholder={t("查看详情")}/></label>
      </div>
      <label>{t("链接（https，可选）")}<input value={form.url} onChange={(e) => set("url", e.target.value)} placeholder="https://"/></label>
      <div className="ann-row">
        <label>{t("开始时间（可选）")}<input type="datetime-local" value={form.start} onChange={(e) => set("start", e.target.value)}/></label>
        <label>{t("结束时间（可选）")}<input type="datetime-local" value={form.end} onChange={(e) => set("end", e.target.value)}/></label>
      </div>
      <fieldset><legend>{t("推送到（不选 = 全部）")}</legend>
        {([["web", "网页版"], ["desktop", "桌面版"], ["android", "Android"]] as const).map(([id, label]) =>
          <label key={id} className="api-check"><input type="checkbox" checked={form.platforms.includes(id)}
            onChange={(e) => set("platforms", e.target.checked ? [...form.platforms, id] : form.platforms.filter((x) => x !== id))}/> {t(label)}</label>)}
      </fieldset>
      <button type="button" className="api-run" disabled={busy || !form.title.trim()} onClick={() => void publish()}><Megaphone size={15}/>{t("发布公告")}</button>
      {msg && <p className="api-muted" role="status">{msg}</p>}
    </div>
    <h4 className="ann-h">{t("已发布")}</h4>
    {!list.length && <p className="api-muted">{t("暂无数据")}</p>}
    {list.map((a) => <div key={a.id} className="ann-item"><div><strong>{a.title}</strong><small>{a.body}</small>
      <small>{[a.platforms?.join(" / "), a.end ? t("截止") + " " + new Date(a.end).toLocaleString() : ""].filter(Boolean).join(" · ")}</small></div>
      <button type="button" className="cx-icon" aria-label={t("删除公告") + " " + a.title} onClick={() => void removeAnnouncement(a.id).then(refresh).then(() => window.dispatchEvent(new Event("ciro-announcements")))}><Trash2 size={15}/></button></div>)}
  </div>;
}

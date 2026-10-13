import { useEffect, useState } from "react";
import { ExternalLink, Megaphone, Sparkles, TriangleAlert, X } from "lucide-react";
import { dismiss, dismissed, loadAnnouncements } from "../lib/announcements";
import type { Announcement } from "../lib/announcements";
import { openExternal } from "../lib/desktop";

/** Notices and offers pushed from the server / central feed, shown on the home screen (refreshed every 30 minutes). */
export default function Announcements({ t }: { t: (s: string) => string }) {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => loadAnnouncements().then((r) => { if (alive) setItems(r.items.filter((a) => !dismissed().includes(a.id))); }, () => {});
    load();
    const timer = window.setInterval(load, 30 * 60_000);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("ciro-announcements", load);
    return () => { alive = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("ciro-announcements", load); };
  }, []);
  if (!items.length) return null;
  return <div className="cx-ann-list">{items.slice(0, 2).map((a) => {
    const Icon = a.level === "promo" ? Sparkles : a.level === "warning" ? TriangleAlert : Megaphone;
    return <div key={a.id} className={"cx-ann cx-ann--" + a.level} role="note">
      <Icon size={18}/>
      <div><strong>{a.title}</strong>{a.body && <p>{a.body}</p>}
        {a.link && <button type="button" className="cx-ann-link" onClick={() => openExternal(a.link!.url)}>{a.link.label}<ExternalLink size={13}/></button>}</div>
      <button type="button" className="cx-ann-x" aria-label={t("关闭公告")} onClick={() => { dismiss(a.id); setItems((l) => l.filter((x) => x.id !== a.id)); }}><X size={15}/></button>
    </div>;
  })}</div>;
}

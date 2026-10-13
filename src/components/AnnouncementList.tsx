import { useEffect, useState } from "react";
import { ExternalLink, Megaphone, Sparkles, TriangleAlert } from "lucide-react";
import { loadAnnouncements } from "../lib/announcements";
import type { Announcement } from "../lib/announcements";
import { openExternal } from "../lib/desktop";

/** Settings → 公告: everything currently announced to users (read only), including ones closed on the home screen. */
export default function AnnouncementList({ t, locale }: { t: (s: string) => string; locale: string }) {
  const [items, setItems] = useState<Announcement[] | null>(null);
  useEffect(() => {
    const load = () => loadAnnouncements().then((r) => setItems(r.items), () => setItems([]));
    load();
    window.addEventListener("ciro-announcements", load);
    return () => window.removeEventListener("ciro-announcements", load);
  }, []);
  return <div className="ann-list">
    {items && !items.length && <div className="ann-empty"><Megaphone size={22}/><p>{t("暂时没有公告")}</p></div>}
    {items?.map((a) => {
      const Icon = a.level === "promo" ? Sparkles : a.level === "warning" ? TriangleAlert : Megaphone;
      return <article key={a.id} className={"cx-ann cx-ann--" + a.level}>
        <Icon size={18}/>
        <div><strong>{a.title}</strong>{a.body && <p>{a.body}</p>}
          {(a.start || a.end) && <small className="ann-when">{[a.start && new Date(a.start).toLocaleDateString(locale), a.end && t("截止") + " " + new Date(a.end).toLocaleDateString(locale)].filter(Boolean).join(" · ")}</small>}
          {a.link && <button type="button" className="cx-ann-link" onClick={() => openExternal(a.link!.url)}>{a.link.label}<ExternalLink size={13}/></button>}</div>
      </article>;
    })}
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { androidUpdateAvailable, checkAndroidUpdate, downloadProgress, installDownloaded, startDownload } from "../lib/android-update";
import type { AndroidRelease } from "../lib/android-update";

const DISMISS = "ciro.update-dismissed.v1";
type Phase = "available" | "downloading" | "permission" | "failed" | "latest";

/** Android app: offers the newer version from GitHub Releases and installs it in place (settings and chats stay). */
export default function AndroidUpdate({ t, onNotify }: { t: (s: string) => string; onNotify: (text: string) => void }) {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const [phase, setPhase] = useState<Phase>("available");
  const [percent, setPercent] = useState(0);
  const timer = useRef(0);

  useEffect(() => {
    if (!androidUpdateAvailable()) return;
    const check = async (manual: boolean) => {
      try {
        const found = await checkAndroidUpdate();
        let dismissed = ""; try { dismissed = localStorage.getItem(DISMISS) || ""; } catch { /* ignore */ }
        if (found && (manual || dismissed !== found.version)) { setRelease(found); setPhase("available"); }
        else if (manual) onNotify(found ? "" : "已是最新版本");
      } catch { if (manual) onNotify("检查更新失败，请检查网络"); }
    };
    const first = window.setTimeout(() => void check(false), 4000);
    const every = window.setInterval(() => void check(false), 6 * 3600_000);
    const manual = () => void check(true);
    window.addEventListener("ciro-check-update", manual);
    return () => { window.clearTimeout(first); window.clearInterval(every); window.removeEventListener("ciro-check-update", manual); window.clearInterval(timer.current); };
  }, []);

  function install() {
    const result = installDownloaded();
    if (result === "need-permission") setPhase("permission");
    else if (result === "missing") setPhase("failed");
  }
  function update() {
    if (!release) return;
    if (!startDownload(release)) { setPhase("failed"); return; }
    setPhase("downloading"); setPercent(0);
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      const p = downloadProgress();
      if (p.total && p.bytes !== undefined) setPercent(Math.min(100, Math.round(p.bytes / p.total * 100)));
      if (p.status === "done") { window.clearInterval(timer.current); setPercent(100); install(); }
      if (p.status === "failed" || p.status === "none") { window.clearInterval(timer.current); setPhase("failed"); }
    }, 500);
  }
  if (!release) return null;
  const mb = release.size ? " · " + (release.size / 1048576).toFixed(1) + " MB" : "";
  return <div className="cx-aupdate" role="status">
    {phase === "available" && <><Download size={16}/><span>{t("发现新版本")} v{release.version}{mb}</span>
      <button type="button" onClick={update}>{t("更新")}</button>
      <button type="button" className="cx-aupdate-x" aria-label={t("稍后")} onClick={() => { try { localStorage.setItem(DISMISS, release.version); } catch { /* ignore */ } setRelease(null); }}><X size={15}/></button></>}
    {phase === "downloading" && <><RefreshCw size={16} className="cx-spin"/><span>{t("正在下载更新")} {percent}%</span><i style={{ width: percent + "%" }}/></>}
    {phase === "permission" && <><Download size={16}/><span>{t("请在刚打开的设置里允许 Ciro 安装应用，然后回来点“安装”")}</span>
      <button type="button" onClick={install}>{t("安装")}</button></>}
    {phase === "failed" && <><X size={16}/><span>{t("更新下载失败")}</span>
      <button type="button" onClick={update}>{t("重试")}</button></>}
  </div>;
}

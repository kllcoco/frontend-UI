import { useEffect, useRef, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { androidUpdateAvailable, checkAndroidUpdate, downloadProgress, installDownloaded, installedVersion, startDownload, UpdateCheckError } from "../lib/android-update";
import { reportUpdate, UPDATE_START } from "../lib/update-result";
import type { AndroidRelease } from "../lib/android-update";

const DISMISS = "ciro.update-dismissed.v1";
type Phase = "available" | "downloading" | "permission" | "failed" | "latest";

/** Android app: offers the newer published release and installs it in place (settings and chats stay). */
export default function AndroidUpdate({ t, onNotify }: { t: (s: string) => string; onNotify: (text: string) => void }) {
  const [release, setRelease] = useState<AndroidRelease | null>(null);
  const [phase, setPhase] = useState<Phase>("available");
  const [percent, setPercent] = useState(0);
  const timer = useRef(0);

  const releaseRef = useRef<AndroidRelease | null>(null);
  releaseRef.current = release;
  const checking = useRef(false);
  useEffect(() => {
    if (!androidUpdateAvailable()) return;
    const check = async (manual: boolean) => {
      // One lookup at a time: repeated taps used to start overlapping lookups that cancelled each other.
      if (checking.current) { if (manual) reportUpdate({ text: "正在检查更新…", busy: true }); return; }
      checking.current = true;
      if (manual) reportUpdate({ text: "正在检查更新…", busy: true });
      try {
        const found = await checkAndroidUpdate();
        let dismissed = ""; try { dismissed = localStorage.getItem(DISMISS) || ""; } catch { /* ignore */ }
        if (found && (manual || dismissed !== found.version)) {
          setRelease(found);
          setPhase((p) => p === "downloading" && releaseRef.current?.version === found.version ? p : "available");
        }
        if (manual) reportUpdate(found ? { text: "发现新版本 v" + found.version, action: "download" } : { text: "已是最新版本 v" + installedVersion() });
      } catch (e) {
        if (!manual) return;
        const kind = e instanceof UpdateCheckError ? e.kind : "unavailable";
        const text = kind === "network" ? "检查更新失败：手机没有联网" : "暂时无法检查更新，请稍后再试";
        reportUpdate({ text });
        onNotify(text);
      } finally { checking.current = false; }
    };
    const first = window.setTimeout(() => void check(false), 4000);
    const every = window.setInterval(() => void check(false), 6 * 3600_000);
    const manual = () => void check(true);
    const start = () => { if (releaseRef.current) updateRef.current(); };
    window.addEventListener("ciro-check-update", manual);
    window.addEventListener(UPDATE_START, start);
    return () => { window.clearTimeout(first); window.clearInterval(every); window.removeEventListener("ciro-check-update", manual); window.removeEventListener(UPDATE_START, start); window.clearInterval(timer.current); };
  }, []);

  function install() {
    const result = installDownloaded();
    if (result === "need-permission") setPhase("permission");
    else if (result === "missing") setPhase("failed");
  }
  const updateRef = useRef(() => {});
  updateRef.current = update;
  function update() {
    const release = releaseRef.current;
    if (!release) return;
    if (phase === "downloading") { reportUpdate({ text: "正在下载更新 " + percent + "%", busy: true }); return; }
    if (!startDownload(release)) { setPhase("failed"); return; }
    setPhase("downloading"); setPercent(0);
    reportUpdate({ text: "正在下载更新…", busy: true });
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

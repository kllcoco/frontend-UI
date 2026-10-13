import { useRef, useState } from "react";
import { ArchiveRestore, DatabaseBackup } from "lucide-react";
import { createBackup, parseBackup, restoreBackup, summarize } from "../lib/backup";
import type { Backup, BackupSummary } from "../lib/backup";

/** Settings → Data: one-file backup of everything on this device, and restore (merge or replace). */
export default function BackupPanel({ t }: { t: (text: string) => string }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ backup: Backup; summary: BackupSummary } | null>(null);

  async function exportBackup() {
    setBusy(true); setError("");
    try {
      const backup = await createBackup(__APP_VERSION__);
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "ciro-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    setError("");
    try { const backup = parseBackup(await file.text()); setPending({ backup, summary: summarize(backup) }); }
    catch (e) { setError(t(e instanceof Error ? e.message : "无法读取备份文件")); }
  }
  async function restore(mode: "merge" | "replace") {
    if (!pending) return;
    if (mode === "replace" && !window.confirm(t("覆盖后，此设备上现有的对话、项目和设置都会被备份内容替换，确定继续？"))) return;
    setBusy(true);
    try { await restoreBackup(pending.backup, mode); window.location.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  }

  return <div className="bk-root">
    <p className="sc-help-text">{t("把对话、项目、提示词、记忆、设置、图片附件原图和自定义背景打包成一个文件，用于换电脑、重装或长期保存。")}</p>
    <div className="sc-action-list">
      <button className="sc-action-secondary" disabled={busy} onClick={() => void exportBackup()}><DatabaseBackup size={17}/> {t("导出完整备份")}</button>
      <button className="sc-action-secondary" disabled={busy} onClick={() => fileRef.current?.click()}><ArchiveRestore size={17}/> {t("从备份恢复")}</button>
      <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label={t("选择备份文件")}
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }}/>
    </div>
    {pending && <div className="bk-preview" role="dialog" aria-label={t("恢复备份")}>
      <strong>{t("备份内容")}</strong>
      <span>{pending.summary.createdAt ? new Date(pending.summary.createdAt).toLocaleString() : ""}</span>
      <ul>
        <li>{pending.summary.conversations} {t("个对话")}</li>
        <li>{pending.summary.projects} {t("个项目")}</li>
        <li>{pending.summary.prompts} {t("条提示词")}</li>
        <li>{pending.summary.memories} {t("条记忆")}</li>
        <li>{pending.summary.images} {t("张图片")}{pending.summary.wallpaper ? " · " + t("自定义背景") : ""}</li>
      </ul>
      <div className="sc-action-list">
        <button className="sc-action-secondary" disabled={busy} onClick={() => void restore("merge")}>{t("合并（推荐）")}</button>
        <button className="sc-action-danger" disabled={busy} onClick={() => void restore("replace")}>{t("覆盖此设备")}</button>
        <button className="sc-action-secondary" disabled={busy} onClick={() => setPending(null)}>{t("取消")}</button>
      </div>
      <small>{t("合并：保留两边的内容，同一对话以较新的为准，当前设置不变。覆盖：完全替换为备份中的内容。")}</small>
    </div>}
    {error && <p className="sc-error" role="alert">{error}</p>}
  </div>;
}

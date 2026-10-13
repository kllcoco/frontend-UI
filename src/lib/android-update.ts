/* Android in-app update: compare the installed version with the latest GitHub release, download the APK
   in the background and hand it to the system installer (it only accepts an APK signed with the same key). */
type Bridge = { version: () => string; download: (url: string, name: string) => boolean; progress: () => string; install: () => string };
export type AndroidRelease = { version: string; url: string; name: string; size: number; page: string };

const LATEST = "https://api.github.com/repos/kllcoco/frontend-UI/releases/latest";
const bridge = () => (window as unknown as { CiroUpdate?: Bridge }).CiroUpdate ?? null;

export const androidUpdateAvailable = () => bridge() !== null;
export function installedVersion(): string { try { return bridge()?.version() || ""; } catch { return ""; } }

/** "0.9.10" > "0.9.9"; anything after "-" is ignored. */
export function newer(a: string, b: string): boolean {
  const x = a.split("-")[0].split(".").map((n) => Number(n) || 0), y = b.split("-")[0].split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

/** The newer release for this phone, or null when up to date / offline / not the Android app. */
export async function checkAndroidUpdate(fetchFn: typeof fetch = fetch): Promise<AndroidRelease | null> {
  const current = installedVersion();
  if (!current) return null;
  const r = await fetchFn(LATEST, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const release = await r.json() as { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string; size: number }[] };
  const apk = release.assets?.find((a) => /^Android-Ciro-[\d.]+\.apk$/.test(a.name));
  const version = (release.tag_name || "").replace(/^v/, "");
  if (!apk || !version || !newer(version, current)) return null;
  return { version, url: apk.browser_download_url, name: apk.name, size: apk.size, page: release.html_url || "" };
}

export type UpdateProgress = { status: "running" | "done" | "failed" | "none"; bytes?: number; total?: number };
export function startDownload(r: AndroidRelease): boolean { return bridge()?.download(r.url, r.name) ?? false; }
export function downloadProgress(): UpdateProgress { try { return JSON.parse(bridge()?.progress() || "{}") as UpdateProgress; } catch { return { status: "failed" }; } }
export function installDownloaded(): "started" | "need-permission" | "missing" { return (bridge()?.install() as "started" | "need-permission" | "missing") || "missing"; }

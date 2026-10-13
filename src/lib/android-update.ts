/* Android in-app update: compare the installed version with the latest GitHub release, download the APK
   in the background and hand it to the system installer (it only accepts an APK signed with the same key). */
type Bridge = { checkLatest?: () => void; version: () => string; download: (url: string, name: string) => boolean; progress: () => string; install: () => string };
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

type ReleaseJson = { tag_name?: string; html_url?: string; assets?: { name: string; browser_download_url: string; size: number }[] };
const REPO = "https://github.com/kllcoco/frontend-UI";

/** Latest tag found by the app itself (GitHub's /releases/latest redirect — no API rate limit). */
function nativeLatest(): Promise<string> {
  const b = bridge() as (Bridge & { checkLatest?: () => void }) | null;
  if (!b?.checkLatest) return Promise.reject(new Error("unsupported"));
  return new Promise((resolve, reject) => {
    const w = window as unknown as { ciroLatestResult?: (r: { tag?: string; error?: string }) => void };
    const timer = window.setTimeout(() => { delete w.ciroLatestResult; reject(new Error("timeout")); }, 20000);
    w.ciroLatestResult = (r) => { window.clearTimeout(timer); delete w.ciroLatestResult; if (r.tag) resolve(r.tag); else reject(new Error(r.error || "failed")); };
    b.checkLatest!();
  });
}

export type CheckError = "network" | "rate-limited" | "unavailable";
export class UpdateCheckError extends Error { constructor(public kind: CheckError) { super(kind); } }

/** The newer release for this phone, or null when up to date / not the Android app.
 *  Tries the connected Ciro server (shared, cached lookup), then the app's own lookup, then the GitHub API. */
export async function checkAndroidUpdate(fetchFn: typeof fetch = fetch): Promise<AndroidRelease | null> {
  const current = installedVersion();
  if (!current) return null;
  const fromJson = (release: ReleaseJson): AndroidRelease | null => {
    const version = (release.tag_name || "").replace(/^v/, "");
    const apk = release.assets?.find((a) => /^Android-Ciro-[\d.]+\.apk$/.test(a.name));
    if (!apk || !version || !newer(version, current)) return null;
    return { version, url: apk.browser_download_url, name: apk.name, size: apk.size, page: release.html_url || "" };
  };
  let limited = false;
  // 1. The Ciro server this app is connected to.
  if (window.location.origin !== "https://localhost") {
    try {
      const r = await fetchFn("/api/app/latest", { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) return fromJson(await r.json() as ReleaseJson);
    } catch { /* try the next way */ }
  }
  // 2. The app itself, through the release page redirect.
  try {
    const tag = await nativeLatest();
    const version = tag.replace(/^v/, "");
    if (!newer(version, current)) return null;
    const name = "Android-Ciro-" + version + ".apk";
    return { version, name, size: 0, url: REPO + "/releases/download/" + tag + "/" + name, page: REPO + "/releases/tag/" + tag };
  } catch { /* try the GitHub API */ }
  // 3. GitHub's API (limited to 60 lookups an hour per network address).
  try {
    const r = await fetchFn(LATEST, { headers: { Accept: "application/vnd.github+json" }, cache: "no-store" });
    if (r.ok) return fromJson(await r.json() as ReleaseJson);
    limited = r.status === 403 || r.status === 429;
  } catch { /* offline */ }
  throw new UpdateCheckError(limited ? "rate-limited" : navigator.onLine === false ? "network" : "unavailable");
}

export type UpdateProgress = { status: "running" | "done" | "failed" | "none"; bytes?: number; total?: number };
export function startDownload(r: AndroidRelease): boolean { return bridge()?.download(r.url, r.name) ?? false; }
export function downloadProgress(): UpdateProgress { try { return JSON.parse(bridge()?.progress() || "{}") as UpdateProgress; } catch { return { status: "failed" }; } }
export function installDownloaded(): "started" | "need-permission" | "missing" { return (bridge()?.install() as "started" | "need-permission" | "missing") || "missing"; }

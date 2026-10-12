/* Android/iOS shell (Capacitor). The app ships the full UI offline; connecting to a Ciro server
   navigates the WebView to that server so API calls stay same-origin. */
const KEY = "ciro.mobile.server.v1";
export const LOCAL_ORIGIN = "https://localhost";

type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string };
export function isMobileShell(): boolean {
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.()) || /CiroMobile\//.test(navigator.userAgent);
}
/** True when the WebView is showing a remote Ciro server rather than the bundled offline app. */
export function isRemoteMobile(): boolean {
  return /CiroMobile\//.test(navigator.userAgent) && window.location.origin !== LOCAL_ORIGIN;
}
export function savedServer(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function normalizeServer(raw: string): string {
  const value = raw.trim().replace(/\/+$/, "");
  const url = new URL(/^https?:\/\//i.test(value) ? value : "http://" + value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("invalid");
  return url.origin;
}
export function connectServer(origin: string): void {
  try { localStorage.setItem(KEY, origin); } catch { /* storage unavailable */ }
  window.location.href = origin + "/";
}
export function disconnectServer(): void {
  window.location.href = LOCAL_ORIGIN + "/?local=1&forget=1";
}
/** Runs before React mounts inside the bundled app: forget or auto-open the saved server. */
export function bootMobile(): void {
  if (!isMobileShell() || window.location.origin !== LOCAL_ORIGIN) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("forget") === "1") { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
  const server = savedServer();
  if (server && params.get("local") !== "1") window.location.replace(server + "/");
  document.documentElement.dataset.mobile = "true";
}

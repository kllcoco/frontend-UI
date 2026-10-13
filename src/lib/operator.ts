/* Who sees the model / server plumbing. Customers just use Ciro on the company's server and buy CWU; the
   connection settings (model, .env, server address, preview notes) are for the operator only: the server's
   owner account, or developer options (About → tap the version 7 times). */
const KEY = "ciro.dev.v1";
export function devMode(): boolean { try { return localStorage.getItem(KEY) === "on"; } catch { return false; } }
export function setDevMode(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, "on"); else localStorage.removeItem(KEY); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("ciro-dev-mode", { detail: on }));
}

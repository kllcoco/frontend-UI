/* "Notify when a reply finishes". Browsers and the desktop app use the Web Notification API; the Android
   app has no such API inside its WebView, so MainActivity exposes a native bridge (window.CiroNotify). */

type NativeNotify = {
  status: () => string;            // "granted" | "denied" | "default"
  request: () => void;             // answers through window.ciroNotifyResult(state)
  show: (title: string, body: string, tag: string) => void;
  background: () => boolean;       // app not in the foreground
};
export type NotifyResult = "granted" | "denied" | "unsupported" | "insecure";

function native(): NativeNotify | null {
  const n = (window as unknown as { CiroNotify?: NativeNotify }).CiroNotify;
  return n && typeof n.show === "function" ? n : null;
}

/** Asks for permission (shows the system prompt when the user has not decided yet). */
export function requestNotify(): Promise<NotifyResult> {
  const n = native();
  if (n) {
    if (n.status() === "granted") return Promise.resolve("granted");
    return new Promise((resolve) => {
      const w = window as unknown as { ciroNotifyResult?: (state: string) => void };
      const timer = window.setTimeout(() => finish(n.status()), 60_000);
      function finish(state: string) {
        window.clearTimeout(timer);
        delete w.ciroNotifyResult;
        resolve(state === "granted" ? "granted" : "denied");
      }
      w.ciroNotifyResult = finish;
      n.request();
    });
  }
  if (!("Notification" in window)) return Promise.resolve(globalThis.isSecureContext === false ? "insecure" : "unsupported");
  if (window.isSecureContext === false) return Promise.resolve("insecure");
  if (Notification.permission === "granted") return Promise.resolve("granted");
  if (Notification.permission === "denied") return Promise.resolve("denied");
  return new Promise((resolve) => {
    const done = (p: NotificationPermission) => resolve(p === "granted" ? "granted" : "denied");
    // Older Safari only supports the callback form and returns undefined.
    const maybe = Notification.requestPermission(done) as Promise<NotificationPermission> | undefined;
    maybe?.then(done, () => resolve("denied"));
  });
}

export function notifyGranted(): boolean {
  const n = native();
  if (n) return n.status() === "granted";
  return "Notification" in window && Notification.permission === "granted";
}

/** True when the user is not looking at Ciro (hidden tab, minimized window, app in background). */
export function appInBackground(): boolean {
  const n = native();
  if (n) { try { return n.background() || document.hidden; } catch { return document.hidden; } }
  return document.hidden || !document.hasFocus();
}

export function showNotify(title: string, body: string, tag: string, onClick: () => void): void {
  const n = native();
  if (n) { n.show(title, body, tag); return; }
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const note = new Notification(title, { body, icon: "/icon-192.png", tag });
  note.onclick = () => { window.focus(); onClick(); note.close(); };
}

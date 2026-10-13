/* The pet floating over other apps on Android (PetOverlay.java) runs this same page in its own WebView.
   Native exposes window.CiroPetHost (move / resize / actions) and delivers events through window.ciroPetHost(kind, json). */
import type { PetBridge } from "../lib/desktop";

type Host = {
  moveBy: (dx: number, dy: number) => void; dragEnd: () => void; action: (name: string) => void;
  resize: (scale: number) => void; expand: (on: boolean) => void; edge: (what: string) => void;
};
type Handler = (data: never) => void;

let cached: PetBridge | undefined;
export function androidPetBridge(): PetBridge | undefined {
  if (cached) return cached;
  const host = (window as unknown as { CiroPetHost?: Host }).CiroPetHost;
  if (!host) return undefined;
  const handlers: Record<string, Set<Handler>> = {};
  (window as unknown as { ciroPetHost: (kind: string, json: string) => void }).ciroPetHost = (kind, json) => {
    let data: unknown = null;
    try { data = JSON.parse(json); } catch { return; }
    handlers[kind]?.forEach((h) => { try { h(data as never); } catch { /* one bad handler must not stop the others */ } });
  };
  const on = <T,>(kind: string) => (h: (data: T) => void) => {
    (handlers[kind] ||= new Set()).add(h as Handler);
    return () => { handlers[kind]?.delete(h as Handler); };
  };
  cached = {
    setIgnore: () => {},
    drag: (phase, dx = 0, dy = 0) => { if (phase === "move") host.moveBy(dx, dy); else if (phase === "end") host.dragEnd(); },
    action: (name) => host.action(name),
    signal: () => {},
    visible: () => true,
    toggle: (on) => { if (!on) host.action("hide"); },
    onCommand: on("command"),
    onCursor: () => () => {},
    onSignal: on("signal"),
    resize: (scale) => host.resize(scale),
    expand: (open) => host.expand(open),
    move: (dx, done) => { host.moveBy(dx, 0); if (done) host.dragEnd(); },
    toEdge: () => host.edge("auto"),
    unedge: () => host.edge("none"),
    onEdge: on("edge"),
    onScale: on("scale"),
    onQuiet: on("quiet"),
    onProgress: on("progress"),
    onStream: on("stream")
  };
  return cached;
}

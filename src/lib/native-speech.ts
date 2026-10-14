/* Android app: the WebView has a SpeechRecognition object but it cannot reach any speech service, so the phone's
   own recogniser (window.CiroListen, MainActivity) stands in for it — the composer's dictation, hold-to-talk and
   voice mode all keep using the standard API. Asks for the microphone the first time. */
type Native = { start: (lang: string) => void; stop: () => void; abort: () => void; available?: () => boolean };
type Result = { isFinal: boolean; 0: { transcript: string }; length: 1 };
const native = (): Native | undefined => (window as unknown as { CiroListen?: Native }).CiroListen;

export const nativeListenAvailable = () => { try { const n = native(); return Boolean(n && (n.available ? n.available() : true)); } catch { return false; } };

let active: NativeRecognition | null = null;

class NativeRecognition {
  lang = ""; continuous = false; interimResults = false;
  onresult: ((e: { resultIndex: number; results: Result[] }) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onstart: (() => void) | null = null;
  private finals: string[] = [];
  private stopped = false;
  private running = false;
  start() {
    if (active && active !== this) active.abort();
    active = this; this.stopped = false; this.finals = []; this.running = true;
    native()!.start(this.lang);
  }
  stop() { this.stopped = true; native()?.stop(); }
  abort() { this.stopped = true; native()?.abort(); }
  /** From the native side. */
  event(type: string, data: string) {
    if (type === "start") this.onstart?.();
    else if (type === "partial") {
      if (this.interimResults) this.emit([...this.finals.map(fin), { isFinal: false, 0: { transcript: data }, length: 1 }], this.finals.length);
    } else if (type === "final") {
      if (data.trim()) { this.finals.push(data); this.emit(this.finals.map(fin), this.finals.length - 1); }
    } else if (type === "error") {
      // Continuous listening goes on through silence; anything else is reported.
      if (this.continuous && !this.stopped && data === "no-speech") return;
      if (data !== "aborted") this.onerror?.({ error: data });
      if (data !== "no-speech") this.stopped = true;
    } else if (type === "end") {
      if (!this.running) return;
      // One utterance at a time natively: keep going until stop() when continuous.
      if (this.continuous && !this.stopped) { native()!.start(this.lang); return; }
      this.running = false;
      if (active === this) active = null;
      this.onend?.();
    }
  }
  private emit(results: Result[], resultIndex: number) { this.onresult?.({ resultIndex, results }); }
}
const fin = (t: string): Result => ({ isFinal: true, 0: { transcript: t }, length: 1 });

/** Installs the stand-in once, in the Android app only. */
export function installNativeSpeech() {
  if (typeof window === "undefined" || !native()) return;
  const w = window as unknown as Record<string, unknown>;
  w.SpeechRecognition = NativeRecognition;
  w.webkitSpeechRecognition = NativeRecognition;
  w.ciroListenEvent = (type: string, data: string) => active?.event(String(type), String(data ?? ""));
}

/* Phone "hold to talk": press and hold the voice button, speak, release to send; slide up to cancel.
   Uses the browser's speech recognition when it works there, otherwise records audio for the server's
   speech-to-text (CIRO_VOICE=on). A short tap keeps the button's normal action. */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { accountFetch } from "./account-api";
import { localeTag } from "./i18n";
import type { Language } from "./i18n";

type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const HOLD_MS = 280, CANCEL_PX = 80;

export type HoldState = { phase: "idle" | "recording" | "working"; cancel: boolean; seconds: number; level: number; heard: string };

export function useHoldToTalk({ language, browserStt, serverStt, onText, onTap, onError }: {
  language: Language; browserStt: boolean; serverStt: boolean;
  onText: (text: string) => void; onTap: () => void; onError: (message: string) => void;
}) {
  const [state, setState] = useState<HoldState>({ phase: "idle", cancel: false, seconds: 0, level: 0, heard: "" });
  const live = useRef<{ startY: number; timer: number; started: boolean; cancel: boolean; finish?: (send: boolean) => void } | null>(null);
  const touched = useRef(false); // a touch gesture already handled the press: ignore the click that follows
  const cbs = useRef({ onText, onTap, onError });
  cbs.current = { onText, onTap, onError };
  const supported = browserStt || (serverStt && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  useEffect(() => () => live.current?.finish?.(false), []);

  async function start() {
    const g = live.current;
    if (!g) return;
    g.started = true;
    navigator.vibrate?.(15);
    setState({ phase: "recording", cancel: false, seconds: 0, level: 0, heard: "" });
    const began = Date.now();
    const clock = window.setInterval(() => setState((s) => s.phase === "recording" ? { ...s, seconds: Math.floor((Date.now() - began) / 1000) } : s), 250);
    const done = (text: string) => { window.clearInterval(clock); setState({ phase: "idle", cancel: false, seconds: 0, level: 0, heard: "" }); if (text.trim()) cbs.current.onText(text.trim()); };
    const fail = (msg: string) => { window.clearInterval(clock); setState({ phase: "idle", cancel: false, seconds: 0, level: 0, heard: "" }); cbs.current.onError(msg); };
    if (browserStt) {
      const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
      const rec = new (w.SpeechRecognition || w.webkitSpeechRecognition)!();
      rec.lang = localeTag(language); rec.continuous = true; rec.interimResults = true;
      let text = "", send = false;
      rec.onresult = (e) => { text = ""; for (let i = 0; i < e.results.length; i += 1) text += e.results[i][0].transcript; setState((s) => ({ ...s, heard: text })); };
      rec.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") fail(e.error); };
      rec.onend = () => done(send ? text : "");
      g.finish = (s) => { send = s; if (s) rec.stop(); else rec.abort(); };
      try { rec.start(); } catch { fail("start-failed"); }
      return;
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { fail("mic-denied"); return; }
    if (!live.current?.started) { stream.getTracks().forEach((t) => t.stop()); window.clearInterval(clock); setState((s) => ({ ...s, phase: "idle" })); return; }
    const recorder = new MediaRecorder(stream), chunks: Blob[] = [];
    const ctx = new AudioContext(), analyser = ctx.createAnalyser(), data = new Uint8Array(analyser.fftSize);
    ctx.createMediaStreamSource(stream).connect(analyser);
    let raf = 0, send = false;
    const meter = () => { analyser.getByteTimeDomainData(data); let sum = 0; for (const v of data) sum += (v - 128) * (v - 128);
      setState((s) => ({ ...s, level: Math.sqrt(sum / data.length) / 128 })); raf = requestAnimationFrame(meter); };
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); void ctx.close();
      if (!send || Date.now() - began < 500) { done(""); return; }
      window.clearInterval(clock);
      setState((s) => ({ ...s, phase: "working", level: 0 }));
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        const r = await accountFetch("/api/voice/transcribe?lang=" + (language === "en" ? "en" : "zh"), { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        const j = await r.json().catch(() => ({})) as { text?: string; error?: string };
        if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
        done(j.text || "");
      } catch (e) { fail(e instanceof Error ? e.message : String(e)); }
    };
    g.finish = (s) => { send = s; if (recorder.state !== "inactive") recorder.stop(); };
    recorder.start(200); meter();
    // Safety stop after 60 seconds.
    window.setTimeout(() => { if (live.current === g && recorder.state !== "inactive") { g.finish?.(true); live.current = null; } }, 60_000);
  }

  const handlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (!supported || e.pointerType === "mouse") return;
      e.currentTarget.setPointerCapture?.(e.pointerId);
      live.current = { startY: e.clientY, started: false, cancel: false, timer: window.setTimeout(() => void start(), HOLD_MS) };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLButtonElement>) => {
      const g = live.current;
      if (!g?.started) return;
      const cancel = g.startY - e.clientY > CANCEL_PX;
      if (cancel !== g.cancel) { g.cancel = cancel; navigator.vibrate?.(8); setState((s) => ({ ...s, cancel })); }
    },
    onPointerUp: () => {
      const g = live.current;
      if (!g) return;
      window.clearTimeout(g.timer);
      live.current = null;
      touched.current = true;
      if (!g.started) { cbs.current.onTap(); return; }
      g.finish?.(!g.cancel);
      if (g.cancel) setState({ phase: "idle", cancel: false, seconds: 0, level: 0, heard: "" });
    },
    // A tiny finger movement can make the WebView start a scroll gesture and cancel the press (no click follows):
    // a press that was not yet a hold still counts as a tap, so the button never "does nothing".
    onPointerCancel: () => {
      const g = live.current; if (!g) return;
      window.clearTimeout(g.timer); live.current = null;
      if (!g.started) { touched.current = true; cbs.current.onTap(); return; }
      g.finish?.(false); setState({ phase: "idle", cancel: false, seconds: 0, level: 0, heard: "" });
    },
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault()
  };
  /** For the button's onClick: false when the touch gesture already handled this press. */
  const clickAllowed = () => { const t = touched.current; touched.current = false; return !t; };
  return { state, handlers, supported, clickAllowed };
}

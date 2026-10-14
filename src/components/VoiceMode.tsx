import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import CiroMark from "./CiroMark";
import { accountFetch } from "../lib/account-api";
import { localeTag } from "../lib/i18n";
import type { Language } from "../lib/i18n";
import { nativeListenAvailable, offlineSpeechOnly, speechErrorText } from "../lib/native-speech";

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";
type Props = {
  t: (text: string) => string;
  language: Language;
  serverStt: boolean;
  serverTts: boolean;
  onAsk: (text: string) => Promise<string>;
  onClose: () => void;
};
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; abort: () => void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };

function browserRecognition(): (new () => Recognition) | null {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  // Electron and Android WebView expose the constructor but cannot reach Google's speech service.
  if (nativeListenAvailable()) return w.SpeechRecognition || null; // Android app: the phone's recogniser (native-speech.ts)
  if ((window as unknown as { ciroDesktop?: unknown }).ciroDesktop || /CiroMobile\//.test(navigator.userAgent)) return null;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
function plainText(markdown: string) {
  return markdown.replace(/```[\s\S]*?```/g, " ").replace(/\$\$[\s\S]*?\$\$/g, " ").replace(/[#>*_`~|]+/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
}

/** Hands-free voice conversation: listen → ask Ciro → speak the reply → listen again. */
export default function VoiceMode({ t, language, serverStt, serverTts, onAsk, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const alive = useRef(true);
  // Hands-free: silence just means listening again — up to a few rounds, then it waits for a tap.
  const quietRounds = useRef(0);
  const stopRef = useRef<() => void>(() => undefined);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const Recognizer = browserRecognition();
  const canListen = Boolean(Recognizer) || (serverStt && typeof MediaRecorder !== "undefined");

  useEffect(() => {
    alive.current = true;
    if (canListen) void listen(); else { setPhase("error"); setError(t("当前设备不支持语音对话")); }
    return () => { alive.current = false; stopRef.current(); window.speechSynthesis?.cancel(); audioRef.current?.pause(); };
  }, []);
  // First use on a phone without a speech service: the offline model downloads (progress shown here).
  useEffect(() => {
    const on = (e: Event) => { const pct = (e as CustomEvent<number>).detail; setHeard(pct >= 100 ? "" : t("正在下载离线语音模型") + " " + pct + "%"); };
    window.addEventListener("ciro-voice-progress", on);
    return () => window.removeEventListener("ciro-voice-progress", on);
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

  function listenBrowser(): Promise<string> {
    return new Promise((resolve, reject) => {
      const rec = new Recognizer!();
      rec.lang = localeTag(language); rec.continuous = false; rec.interimResults = true;
      let finalText = "";
      rec.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i += 1) { text += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = text; }
        setHeard(text);
      };
      rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") reject(new Error(e.error)); };
      rec.onend = () => resolve(finalText.trim());
      stopRef.current = () => rec.abort();
      rec.start();
    });
  }
  async function listenServer(): Promise<string> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let spoke = false; let silentSince = 0; let raf = 0;
    const done = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
    const stop = () => { cancelAnimationFrame(raf); if (recorder.state !== "inactive") recorder.stop(); stream.getTracks().forEach((tr) => tr.stop()); void ctx.close(); };
    stopRef.current = stop;
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start(250);
    const started = Date.now();
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; for (const v of data) sum += (v - 128) * (v - 128);
      const rms = Math.sqrt(sum / data.length) / 128;
      setLevel(rms);
      if (rms > 0.06) { spoke = true; silentSince = 0; } else if (spoke && !silentSince) silentSince = Date.now();
      if ((spoke && silentSince && Date.now() - silentSince > 1200) || Date.now() - started > 30000) { stop(); return; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    await done;
    setLevel(0);
    if (!spoke) return "";
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const response = await accountFetch("/api/voice/transcribe?lang=" + (language === "en" ? "en" : "zh"), { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    const result = await response.json().catch(() => ({})) as { text?: string; error?: string };
    if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
    setHeard(result.text || "");
    return (result.text || "").trim();
  }
  async function speak(text: string) {
    const plain = plainText(text).slice(0, 3000);
    if (!plain) return;
    if (serverTts) {
      const response = await accountFetch("/api/voice/speech", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: plain }) });
      if (response.ok) {
        const url = URL.createObjectURL(await response.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        stopRef.current = () => audio.pause();
        await new Promise<void>((resolve) => { audio.onended = () => resolve(); audio.onpause = () => resolve(); void audio.play().catch(() => resolve()); });
        URL.revokeObjectURL(url);
        return;
      }
    }
    // Android app: the phone's text-to-speech (the WebView has none that works).
    const phone = (window as unknown as { CiroVoice?: { speak?: (t: string) => void; stopSpeaking?: () => void; speaking?: () => boolean } }).CiroVoice;
    if (phone?.speak && phone.speaking) {
      phone.speak(plain);
      await new Promise<void>((resolve) => {
        let started = false;
        const began = Date.now();
        const timer = window.setInterval(() => {
          const now = Boolean(phone.speaking?.());
          if (now) started = true;
          if ((started && !now) || (!started && Date.now() - began > 4000) || Date.now() - began > 180_000) { window.clearInterval(timer); resolve(); }
        }, 250);
        stopRef.current = () => { window.clearInterval(timer); phone.stopSpeaking?.(); resolve(); };
      });
      return;
    }
    if (!("speechSynthesis" in window)) return;
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(plain);
      u.lang = localeTag(language);
      u.onend = () => resolve(); u.onerror = () => resolve();
      stopRef.current = () => { window.speechSynthesis.cancel(); resolve(); };
      window.speechSynthesis.speak(u);
    });
  }
  async function listen() {
    if (!alive.current) return;
    setPhase("listening"); setHeard(""); setError("");
    try {
      // The server's speech-to-text beats the phone's small offline model when both are there.
      const text = Recognizer && !(serverStt && offlineSpeechOnly() && typeof MediaRecorder !== "undefined") ? await listenBrowser() : await listenServer();
      if (!alive.current) return;
      if (!text) {
        if (++quietRounds.current <= 4) { void listen(); return; }
        quietRounds.current = 0; setPhase("idle"); return;
      }
      quietRounds.current = 0;
      setPhase("thinking"); setReply("");
      const answer = await onAsk(text);
      if (!alive.current) return;
      setReply(answer);
      setPhase("speaking");
      await speak(answer);
      // A moment of quiet so the end of her own voice is not heard as the next question.
      if (alive.current) window.setTimeout(() => void listen(), 400);
    } catch (e) {
      if (!alive.current) return;
      setPhase("error");
      const code = e instanceof Error ? e.message : String(e);
      setError(/Permission|NotAllowed/i.test(code) ? t(speechErrorText("not-allowed")) : t(speechErrorText(code)));
    }
  }
  function tapOrb() {
    if (phase === "speaking" || phase === "listening") { stopRef.current(); if (phase === "speaking") void listen(); return; }
    if (phase === "idle" || phase === "error") { quietRounds.current = 0; if (canListen) void listen(); }
  }

  const label = phase === "listening" ? t("正在聆听…") : phase === "thinking" ? t("正在思考…") : phase === "speaking" ? t("正在回答，点击可打断")
    : phase === "error" ? t("语音不可用") : t("点击开始说话");
  return <div className="vm-root" role="dialog" aria-modal="true" aria-label={t("语音对话")}>
    <button type="button" className="vm-close" onClick={onClose} aria-label={t("结束语音对话")}><X size={22}/></button>
    <div className="vm-center">
      <button type="button" className={"vm-orb vm-orb--" + phase} onClick={tapOrb} aria-label={label}
        style={{ ["--vm-level" as string]: String(Math.min(1, level * 6)) }}>
        <span className="vm-ring"/><span className="vm-ring vm-ring--2"/><CiroMark/>
      </button>
      <p className="vm-label" aria-live="polite">{label}</p>
      {heard && <p className="vm-heard">“{heard}”</p>}
      {reply && phase !== "thinking" && <p className="vm-reply">{plainText(reply).slice(0, 220)}{plainText(reply).length > 220 ? "…" : ""}</p>}
      {error && <p className="vm-error" role="alert">{error}</p>}
    </div>
  </div>;
}

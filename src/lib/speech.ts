import { localeTag } from "./i18n";
import { nativeListenAvailable } from "./native-speech";
import { useEffect, useRef, useState } from "react";
import type { Language } from "./i18n";

/* Browser speech APIs (Chromium/Edge/Safari). Feature-detected; buttons hide when unavailable. */
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  start: () => void; stop: () => void; abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null; onerror: ((event: { error: string }) => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}
// Electron and Android WebView expose the API but cannot reach the browser vendor's speech service.
// The Android app uses the phone's own recogniser instead (native-speech.ts).
export const speechInputSupported = () => typeof window !== "undefined" && (nativeListenAvailable() || (recognitionCtor() !== null &&
  !(window as unknown as { ciroDesktop?: unknown }).ciroDesktop && !/CiroMobile\//.test(navigator.userAgent)));
export const speechOutputSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Dictation into the composer. `onText` receives finalized phrases. */
export function useDictation(language: Language, onText: (text: string) => void, onError: (code: string) => void) {
  const [listening, setListening] = useState(false);
  const ref = useRef<Recognition | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;
  useEffect(() => () => ref.current?.abort(), []);
  function toggle() {
    if (listening) { ref.current?.stop(); return; }
    const Ctor = recognitionCtor();
    if (!Ctor) { onError("unsupported"); return; }
    const rec = new Ctor();
    rec.lang = localeTag(language);
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) textRef.current(event.results[i][0].transcript);
      }
    };
    rec.onerror = (event) => { if (event.error !== "aborted" && event.error !== "no-speech") onError(event.error); };
    rec.onend = () => { setListening(false); ref.current = null; };
    ref.current = rec;
    try { rec.start(); setListening(true); } catch { onError("start-failed"); }
  }
  return { listening, toggle };
}

/** Read a reply aloud; returns the id currently speaking. */
export function useReadAloud(language: Language) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  useEffect(() => () => { if (speechOutputSupported()) window.speechSynthesis.cancel(); }, []);
  function toggle(id: string, markdown: string) {
    if (!speechOutputSupported()) return;
    window.speechSynthesis.cancel();
    if (speakingId === id) { setSpeakingId(null); return; }
    const plain = markdown.replace(/```[\s\S]*?```/g, " ").replace(/[#>*_`~|-]+/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    const utterance = new SpeechSynthesisUtterance(plain.slice(0, 6000));
    utterance.lang = localeTag(language);
    utterance.onend = () => setSpeakingId((current) => current === id ? null : current);
    utterance.onerror = utterance.onend;
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }
  return { speakingId, toggle };
}

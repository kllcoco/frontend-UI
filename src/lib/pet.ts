/* Ciro pet: on/off preference, the <pet mood="…">line</pet> tag the model can use to steer her,
   and a small event bus the in-app pet (web / Android) and the desktop pet window listen to. */
import { desktop } from "./desktop";
import type { Mood } from "../pet/Chibi";

const KEY = "ciro.pet.v1";
/** Android app: the pet that floats over other apps while Ciro is in the background (PetOverlay.java). */
type NativePet = { setEnabled?: (on: boolean) => void; command?: (json: string) => void; progress?: (json: string) => void;
  stream?: (json: string) => void; signal?: (signal: string) => void; overlayAllowed?: () => boolean; requestOverlay?: () => void; resetPlace?: () => void;
  setScale?: (v: number) => void };
export const nativePet = (): NativePet | undefined => (window as unknown as { CiroPet?: NativePet }).CiroPet;
export const PET_MOODS: Mood[] = ["idle", "happy", "love", "shy", "angry", "sad", "think", "work", "sleep", "wave", "eat"];
export const PET_ACTIONS = ["wave", "nod", "shake", "bow", "jump", "stretch", "magic", "spin", "lookaround", "yawn", "hum", "doze", "tidy", "giggle", "sparkle", "peek"] as const;
export type PetCommand = { mood?: Mood; say?: string; action?: typeof PET_ACTIONS[number] };
/** The screen edge she hides behind (only her head peeks out), or null. */
export type PetEdge = "left" | "right" | "bottom" | "top" | null;
/** A step of work in progress she tells you about: work mode on the computer, a reply written in the background, a schedule… */
export type PetProgress = { text: string; percent?: number; done?: boolean; ok?: boolean; attention?: boolean; source?: string };

/** Off until the user turns it on (Settings → 外观与背景 → 桌宠). */
export function petEnabled(): boolean {
  const d = desktop();
  if (d?.pet) { try { return d.pet.visible(); } catch { return false; } }
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}
export function setPetEnabled(on: boolean): void {
  const d = desktop();
  if (d?.pet) d.pet.toggle(on);
  else try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* storage off */ }
  try { nativePet()?.setEnabled?.(on); } catch { /* not the Android app */ }
  window.dispatchEvent(new CustomEvent("ciro-pet-toggle", { detail: on }));
}

const TAG = /<pet\b([^>]*)>([\s\S]*?)<\/pet>/gi;
/** Removes pet tags (and a half-streamed one at the end) from text shown to the user. */
export function stripPetTags(text: string): string {
  if (!text.includes("<pet")) return text;
  return text.replace(TAG, "").replace(/<pet\b[^<]*$/i, "").replace(/<pet\b[^>]*>[^<]*$/i, "").trimEnd();
}
/** The last pet command in a reply, if any. */
export function petCommand(text: string): PetCommand | null {
  let found: PetCommand | null = null;
  for (const m of text.matchAll(TAG)) {
    const mood = /mood\s*=\s*["']?(\w+)/i.exec(m[1])?.[1]?.toLowerCase() as Mood | undefined;
    const say = m[2].replace(/<[^>]*>/g, "").trim().slice(0, 40);
    const action = /action\s*=\s*["']?(\w+)/i.exec(m[1])?.[1]?.toLowerCase() as PetCommand["action"];
    found = { ...(mood && PET_MOODS.includes(mood) ? { mood } : {}), ...(say ? { say } : {}),
      ...(action && (PET_ACTIONS as readonly string[]).includes(action) ? { action } : {}) };
  }
  return found && (found.mood || found.say || found.action) ? found : null;
}
/** Sends a command to whichever pet is showing (the desktop window or the in-app one). */
export function commandPet(cmd: PetCommand): void {
  desktop()?.pet?.command?.(cmd);
  try { nativePet()?.command?.(JSON.stringify(cmd)); } catch { /* not the Android app */ }
  window.dispatchEvent(new CustomEvent("ciro-pet", { detail: cmd }));
}
/** Progress of something running (work mode, a background reply, a scheduled task, an update download):
 *  shown by the desktop pet window, the in-app pet and, on Android, the pet floating over other apps. */
export function petProgress(p: PetProgress): void {
  if (!p.text) return;
  const detail = { ...p, text: p.text.slice(0, 60) };
  desktop()?.pet?.progress?.(detail);
  window.dispatchEvent(new CustomEvent("ciro-pet-progress", { detail }));
  try { nativePet()?.progress?.(JSON.stringify(detail)); } catch { /* not the Android app */ }
}

/** The reply as it is being written, mirrored in her bubble (Settings → 桌宠 → 同步显示回答, on by default). */
export type PetStream = { id: string; text: string; done?: boolean; error?: boolean; title?: string; onScreen?: boolean };
const MIRROR = "ciro.pet-mirror.v1";
export function petMirror(): boolean { try { return localStorage.getItem(MIRROR) !== "off"; } catch { return true; } }
export function setPetMirror(on: boolean): void { try { localStorage.setItem(MIRROR, on ? "on" : "off"); } catch { /* storage off */ } }
/** Plain text for the bubble: markdown marks, code fences and links reduced to their words. */
export function bubbleText(md: string): string {
  return md.replace(/```[\s\S]*?(```|$)/g, " [代码] ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "").replace(/[*_`>~]+/g, "").replace(/^\s*[-+]\s+/gm, "· ").replace(/\n{3,}/g, "\n\n").trim();
}
let streamTimer = 0, pending: PetStream | null = null;
export function petStream(s: PetStream): void {
  pending = s;
  const send = () => {
    streamTimer = 0;
    if (!pending) return;
    const detail = { ...pending, text: bubbleText(pending.text).slice(-4000) };
    pending = null;
    desktop()?.pet?.stream?.(detail);
    window.dispatchEvent(new CustomEvent("ciro-pet-stream", { detail }));
    try { nativePet()?.stream?.(JSON.stringify(detail)); } catch { /* not the Android app */ }
  };
  // at most ~6 updates a second while streaming; the last one always goes out
  if (s.done) { window.clearTimeout(streamTimer); send(); }
  else if (!streamTimer) streamTimer = window.setTimeout(send, 160);
}

/** Back to her default place and size (in the app, and the Android floating pet). */
export function resetPetPlace(): void {
  try { for (const k of ["ciro.pet-pos.v1", "ciro.pet-edge.v1", "ciro.pet-scale.v1"]) localStorage.removeItem(k); } catch { /* storage off */ }
  try { nativePet()?.resetPlace?.(); } catch { /* not the Android app */ }
  window.dispatchEvent(new Event("ciro-pet-reset"));
}

/** Her size (0.5–1.6), from the settings slider: in the app, the desktop pet window and the Android floating pet. */
export function petScale(): number {
  try { const v = Number(localStorage.getItem("ciro.pet-scale.v1")); return v >= .5 && v <= 1.6 ? v : .85; } catch { return .85; }
}
export function setPetScale(v: number): void {
  const s = Math.round(Math.min(1.6, Math.max(.5, v)) * 100) / 100;
  try { localStorage.setItem("ciro.pet-scale.v1", String(s)); } catch { /* storage off */ }
  window.dispatchEvent(new CustomEvent("ciro-pet-scale", { detail: s }));
  desktop()?.pet?.resize?.(s);
  try { nativePet()?.setScale?.(s); } catch { /* not the Android app */ }
}

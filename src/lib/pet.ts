/* Ciro pet: on/off preference, the <pet mood="…">line</pet> tag the model can use to steer her,
   and a small event bus the in-app pet (web / Android) and the desktop pet window listen to. */
import { desktop } from "./desktop";
import type { Mood } from "../pet/Chibi";

const KEY = "ciro.pet.v1";
export const PET_MOODS: Mood[] = ["idle", "happy", "love", "shy", "angry", "sad", "think", "work", "sleep", "wave", "eat"];
export type PetCommand = { mood?: Mood; say?: string };

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
    found = { ...(mood && PET_MOODS.includes(mood) ? { mood } : {}), ...(say ? { say } : {}) };
  }
  return found && (found.mood || found.say) ? found : null;
}
/** Sends a command to whichever pet is showing (the desktop window or the in-app one). */
export function commandPet(cmd: PetCommand): void {
  desktop()?.pet?.command?.(cmd);
  window.dispatchEvent(new CustomEvent("ciro-pet", { detail: cmd }));
}

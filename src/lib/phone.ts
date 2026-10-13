/* Operating the phone by voice (Android app): the model ends a spoken reply with <phone>{JSON}</phone> tags;
   the app checks each against a fixed list and the native side (PhoneActions.java) carries it out. */
export const PHONE_ACTIONS = ["alarm", "timer", "alarms", "open_app", "call", "sms", "navigate", "web_search", "open_url",
  "flashlight", "volume", "settings", "calendar"] as const;
export type PhoneAction = { action: typeof PHONE_ACTIONS[number] } & Record<string, unknown>;

type Native = { run?: (json: string) => string };
type Voice = { speak?: (text: string) => void; setWake?: (on: boolean) => string; wakeOn?: () => boolean; available?: () => boolean; stopSpeaking?: () => void };
const nativePhone = (): Native | undefined => (window as unknown as { CiroPhone?: Native }).CiroPhone;
export const nativeVoice = (): Voice | undefined => (window as unknown as { CiroVoice?: Voice }).CiroVoice;
export const phoneAvailable = () => Boolean(nativePhone()?.run);

const TAG = /<phone\b[^>]*>([\s\S]*?)<\/phone>/gi;
/** Removes phone tags (and one still being streamed) from the text shown or read aloud. */
export function stripPhoneTags(text: string): string {
  if (!text.includes("<phone")) return text;
  return text.replace(TAG, "").replace(/<phone\b[\s\S]*$/i, "").trimEnd();
}
/** The actions in a reply (at most 3, known actions only). */
export function phoneActions(text: string): PhoneAction[] {
  const out: PhoneAction[] = [];
  for (const m of text.matchAll(TAG)) {
    try {
      const a = JSON.parse(m[1].trim()) as PhoneAction;
      if (a && typeof a === "object" && (PHONE_ACTIONS as readonly string[]).includes(String(a.action))) out.push(a);
    } catch { /* not JSON: ignore */ }
    if (out.length >= 3) break;
  }
  return out;
}
/** Carries the actions out; returns a short line per action ("ok" or why not). */
export function runPhoneActions(list: PhoneAction[]): string[] {
  const n = nativePhone();
  if (!n?.run) return list.map(() => "unsupported");
  return list.map((a) => { try { return String(n.run!(JSON.stringify(a))); } catch (e) { return "error: " + (e instanceof Error ? e.message : String(e)); } });
}
/** "2026-10-13 21:40 周二" in the phone's own time zone, for the model to work out times. */
export function localNow(language: string): string {
  const d = new Date(), p = (x: number) => String(x).padStart(2, "0");
  const day = language === "en" ? ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] : ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][d.getDay()];
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()) + " " + day;
}

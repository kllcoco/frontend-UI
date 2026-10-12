export type ChatPreferences = {
  sendWithEnter: boolean;
  showTime: boolean;
  compactMessages: boolean;
  fontSize: "small" | "normal" | "large";
  reduceMotion: boolean;
  notifyOnComplete: boolean;
  autoTitle: boolean;
  followUps: boolean;
  accent: Accent;
  fontFamily: FontFamily;
  memoryEnabled: boolean;
};
export type Accent = "jade" | "blue" | "violet" | "amber" | "rose" | "graphite";
export type FontFamily = "sans" | "system" | "serif";
export const ACCENTS: Accent[] = ["jade", "blue", "violet", "amber", "rose", "graphite"];

const KEY = "ciro.chat-preferences.v1";
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  sendWithEnter: true,
  showTime: false,
  compactMessages: false,
  fontSize: "normal",
  reduceMotion: false,
  notifyOnComplete: false,
  autoTitle: true,
  followUps: true,
  accent: "jade",
  fontFamily: "sans",
  memoryEnabled: true
};

export function loadChatPreferences(): ChatPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<ChatPreferences>;
    return {
      sendWithEnter: typeof value.sendWithEnter === "boolean" ? value.sendWithEnter : true,
      showTime: typeof value.showTime === "boolean" ? value.showTime : false,
      compactMessages: typeof value.compactMessages === "boolean" ? value.compactMessages : false,
      fontSize: ["small", "normal", "large"].includes(value.fontSize || "") ?
        value.fontSize as ChatPreferences["fontSize"] : "normal",
      reduceMotion: typeof value.reduceMotion === "boolean" ? value.reduceMotion : false,
      notifyOnComplete: typeof value.notifyOnComplete === "boolean" ? value.notifyOnComplete : false,
      autoTitle: typeof value.autoTitle === "boolean" ? value.autoTitle : true,
      followUps: typeof value.followUps === "boolean" ? value.followUps : true,
      accent: ACCENTS.includes(value.accent as Accent) ? value.accent as Accent : "jade",
      fontFamily: ["sans", "system", "serif"].includes(value.fontFamily || "") ? value.fontFamily as FontFamily : "sans",
      memoryEnabled: typeof value.memoryEnabled === "boolean" ? value.memoryEnabled : true
    };
  } catch {
    return { ...DEFAULT_CHAT_PREFERENCES };
  }
}

export function saveChatPreferences(value: ChatPreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

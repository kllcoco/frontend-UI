export type ChatPreferences = {
  sendWithEnter: boolean;
  showTime: boolean;
  compactMessages: boolean;
  fontSize: "small" | "normal" | "large";
  reduceMotion: boolean;
  notifyOnComplete: boolean;
  /** System notification when a scheduled task needs approval or finishes. */
  notifySchedules: boolean;
  autoTitle: boolean;
  followUps: boolean;
  accent: Accent;
  /** Set once the user picks an accent themselves (so a later default change leaves their choice alone). */
  accentChosen?: boolean;
  fontFamily: FontFamily;
  memoryEnabled: boolean;
  /** Let Ciro summarize conversations and save lasting facts/preferences to memory by itself. */
  autoMemory: boolean;
  /** 使用我的数据改进模型: off unless the user turns it on. */
  improveModel: boolean;
};
export type Accent = "gold" | "jade" | "blue" | "violet" | "amber" | "rose" | "graphite";
export type FontFamily = "sans" | "system" | "serif";
export const ACCENTS: Accent[] = ["gold", "jade", "blue", "violet", "amber", "rose", "graphite"];

const KEY = "ciro.chat-preferences.v1";
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  sendWithEnter: true,
  showTime: false,
  compactMessages: false,
  fontSize: "normal",
  reduceMotion: false,
  notifyOnComplete: false,
  notifySchedules: true,
  autoTitle: true,
  followUps: true,
  accent: "gold",
  fontFamily: "sans",
  memoryEnabled: true,
  autoMemory: true,
  improveModel: false
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
      notifySchedules: typeof value.notifySchedules === "boolean" ? value.notifySchedules : true,
      autoTitle: typeof value.autoTitle === "boolean" ? value.autoTitle : true,
      followUps: typeof value.followUps === "boolean" ? value.followUps : true,
      // v0.10 moved the default from jade to Ciro's black-and-gold; earlier installs saved "jade" without choosing it.
      accent: !value.accent || (value.accent === "jade" && !value.accentChosen) ? "gold" : ACCENTS.includes(value.accent as Accent) ? value.accent as Accent : "gold",
      accentChosen: value.accentChosen === true,
      fontFamily: ["sans", "system", "serif"].includes(value.fontFamily || "") ? value.fontFamily as FontFamily : "sans",
      memoryEnabled: typeof value.memoryEnabled === "boolean" ? value.memoryEnabled : true,
      autoMemory: typeof value.autoMemory === "boolean" ? value.autoMemory : true,
      improveModel: value.improveModel === true
    };
  } catch {
    return { ...DEFAULT_CHAT_PREFERENCES };
  }
}

export function saveChatPreferences(value: ChatPreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

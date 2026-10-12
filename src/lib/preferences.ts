export type ChatPreferences = {
  sendWithEnter: boolean;
  showTime: boolean;
  compactMessages: boolean;
  fontSize: "small" | "normal" | "large";
  reduceMotion: boolean;
  notifyOnComplete: boolean;
  autoTitle: boolean;
};

const KEY = "ciro.chat-preferences.v1";
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
  sendWithEnter: true,
  showTime: false,
  compactMessages: false,
  fontSize: "normal",
  reduceMotion: false,
  notifyOnComplete: false,
  autoTitle: true
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
      autoTitle: typeof value.autoTitle === "boolean" ? value.autoTitle : true
    };
  } catch {
    return { ...DEFAULT_CHAT_PREFERENCES };
  }
}

export function saveChatPreferences(value: ChatPreferences): void {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

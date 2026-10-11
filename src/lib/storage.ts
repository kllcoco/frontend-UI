import type { Conversation } from "../types";

const CHAT_KEY = "ciro.chats.v1";
const ACTIVE_KEY = "ciro.active.v1";
const THEME_KEY = "ciro.theme.v1";

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function loadConversations(): Conversation[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((value): value is Conversation => !!value && typeof value === "object" &&
        typeof value.id === "string" && typeof value.title === "string" &&
        typeof value.updatedAt === "number" && Array.isArray(value.messages))
      .slice(0, 100);
  } catch {
    return [];
  }
}

export function saveConversations(conversations: Conversation[]): boolean {
  try {
    localStorage.setItem(CHAT_KEY, JSON.stringify(conversations.slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}

export function loadActiveId(): string | null {
  try { return localStorage.getItem(ACTIVE_KEY); }
  catch { return null; }
}

export function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* Storage can be unavailable in private browsing. */ }
}

export function loadTheme(): "light" | "dark" {
  try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}

export function saveTheme(theme: "light" | "dark"): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* optional */ }
}

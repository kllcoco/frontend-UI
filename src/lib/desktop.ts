/* Bridge to the optional Electron desktop shell (desktop/preload.cjs). No-ops in a plain browser. */
import type { Language } from "./i18n";

export type DesktopCommand =
  | "new-chat" | "search" | "settings" | "toggle-sidebar" | "shortcuts" | "about" | "export-chat" | "export-pdf" | "focus-composer" | "find" | "new-window";
export type UpdateInfo = { state: "checking" | "latest" | "available" | "downloading" | "ready" | "error"; version?: string; percent?: number; message?: string; manual?: boolean };

type DesktopBridge = {
  platform: string;
  version: string;
  setLanguage: (language: Language) => void;
  onCommand: (handler: (command: DesktopCommand) => void) => () => void;
  openExternal?: (url: string) => void;
  onUpdate?: (handler: (info: UpdateInfo) => void) => () => void;
  updateAction?: (action: "download" | "install" | "check") => void;
  exportPdf?: (name: string) => Promise<boolean>;
  openWindow?: (chatId?: string) => void;
  /** Quick-ask window: text the user copied before pressing the shortcut. */
  onQuick?: (handler: (info: { clipboard: string }) => void) => () => void;
  quickHide?: () => void;
  quickContinue?: (chatId: string) => void;
  onOpenChat?: (handler: (chatId: string) => void) => () => void;
  openConfig?: () => void;
  pickFolder?: () => Promise<string | null>;
  pet?: PetBridge;
};
export type PetSignal = "thinking" | "done" | "error";
export type PetBridge = {
  setIgnore: (ignore: boolean) => void;
  drag: (phase: "start" | "move" | "end") => void;
  action: (action: "open" | "quick" | "hide") => void;
  signal: (signal: PetSignal) => void;
  visible: () => boolean;
  toggle: (on: boolean) => void;
  command?: (cmd: { mood?: string; say?: string; action?: string }) => void;
  onCommand?: (handler: (cmd: { mood?: string; say?: string; action?: string }) => void) => () => void;
  onCursor: (handler: (p: { x: number; y: number }) => void) => () => void;
  onSignal: (handler: (p: { signal: string; focused: boolean }) => void) => () => void;
};

declare global {
  interface Window { ciroDesktop?: DesktopBridge }
}

export function desktop(): DesktopBridge | null {
  return typeof window !== "undefined" && window.ciroDesktop ? window.ciroDesktop : null;
}

export const RELEASES_URL = "https://github.com/kllcoco/frontend-UI/releases/latest";

export function openExternal(url: string): void {
  const bridge = desktop();
  if (bridge?.openExternal) bridge.openExternal(url);
  else window.open(url, "_blank", "noopener,noreferrer");
}

/* Bridge to the optional Electron desktop shell (desktop/preload.cjs). No-ops in a plain browser. */
import type { Language } from "./i18n";

export type DesktopCommand =
  | "new-chat" | "search" | "settings" | "toggle-sidebar" | "shortcuts" | "about" | "export-chat" | "export-pdf" | "focus-composer";
export type UpdateInfo = { state: "available" | "downloading" | "ready" | "error"; version?: string; percent?: number; message?: string };

type DesktopBridge = {
  platform: string;
  version: string;
  setLanguage: (language: Language) => void;
  onCommand: (handler: (command: DesktopCommand) => void) => () => void;
  openExternal?: (url: string) => void;
  onUpdate?: (handler: (info: UpdateInfo) => void) => () => void;
  updateAction?: (action: "download" | "install" | "check") => void;
  exportPdf?: (name: string) => Promise<boolean>;
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

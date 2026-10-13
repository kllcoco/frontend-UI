/* Result of a manual "检查更新" click, shown next to the button in Settings (and as a toast).
   `action` offers the next step right there: start the download or restart into the new version. */
export type UpdateResult = { text: string; busy?: boolean; action?: "download" | "install" };
export const UPDATE_RESULT = "ciro-update-result";
export const UPDATE_START = "ciro-update-start";
export function reportUpdate(result: UpdateResult): void {
  window.dispatchEvent(new CustomEvent<UpdateResult>(UPDATE_RESULT, { detail: result }));
}

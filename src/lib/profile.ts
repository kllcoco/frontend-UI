/** Local display name used by the sidebar profile button when no account session exists. */
const KEY = "ciro.profile.v1";
export type LocalProfile = { displayName: string };
export function loadProfile(): LocalProfile {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<LocalProfile>;
    return { displayName: typeof value.displayName === "string" ? value.displayName.slice(0, 40) : "" };
  } catch { return { displayName: "" }; }
}
export function saveProfile(profile: LocalProfile): void {
  try { localStorage.setItem(KEY, JSON.stringify({ displayName: profile.displayName.slice(0, 40) })); }
  catch { /* optional */ }
}

/* "Remember this" memories. Signed-in accounts use the encrypted server store; local mode keeps
   them in this browser and sends them with chat requests as user background. */
import { accountApi, getAccountSession } from "./account-api";
import { newId } from "./storage";

export type Memory = { id: string; content: string; createdAt: string; server?: boolean };
const KEY = "ciro.memories.v1";

function loadLocal(): Memory[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as unknown;
    return Array.isArray(list) ? list.filter((m): m is Memory => !!m && typeof m.id === "string" && typeof m.content === "string").slice(0, 50) : [];
  } catch { return []; }
}
function saveLocal(list: Memory[]) { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50))); } catch { /* full */ } }
async function useServer(): Promise<boolean> {
  try { const s = await getAccountSession(); return s.enabled && s.authenticated; } catch { return false; }
}

export async function listMemories(): Promise<Memory[]> {
  if (await useServer()) {
    const data = await accountApi<{ memories: { id: string; content: string; createdAt: string }[] }>("/memories");
    return data.memories.map((m) => ({ ...m, server: true }));
  }
  return loadLocal();
}
export async function addMemory(content: string): Promise<Memory> {
  const text = content.trim().slice(0, 300);
  if (!text) throw new Error("empty");
  if (await useServer()) {
    const created = await accountApi<{ id: string; createdAt?: string }>("/memories", "POST", { content: text, category: "general" });
    return { id: created.id, content: text, createdAt: created.createdAt || new Date().toISOString(), server: true };
  }
  const memory = { id: newId(), content: text, createdAt: new Date().toISOString() };
  const list = loadLocal();
  if (list.length >= 50) throw new Error("limit");
  saveLocal([memory, ...list]);
  return memory;
}
export async function removeMemory(id: string): Promise<void> {
  if (await useServer()) { await accountApi("/memories/" + encodeURIComponent(id), "DELETE"); return; }
  saveLocal(loadLocal().filter((m) => m.id !== id));
}
/** Local memories to attach to a chat request (server-side accounts inject their own). */
export function localMemoriesForChat(): string[] { return loadLocal().map((m) => m.content); }

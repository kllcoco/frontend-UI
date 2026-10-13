/** Saved prompts (local). Seeded with a few useful starters the first time. */
export type SavedPrompt = { id: string; title: string; content: string; createdAt: number; uses: number };
const KEY = "ciro.prompts.v1";
const SEED: Omit<SavedPrompt, "id" | "createdAt" | "uses">[] = [
  { title: "润色文字", content: "请在不改变原意的前提下润色下面这段文字，让它更清晰、简洁、专业，并说明主要改动：\n\n" },
  { title: "代码审查", content: "请审查下面的代码：指出 bug、边界情况、性能和可读性问题，并给出修改后的版本：\n\n" },
  { title: "翻译成英文", content: "请把下面的内容翻译成自然、地道的英文，保留专业术语：\n\n" },
  { title: "会议纪要", content: "请把下面的会议记录整理成纪要：结论、待办事项（负责人/截止时间）、风险与未决问题：\n\n" }
];
export function loadPrompts(): SavedPrompt[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return SEED.map((p, i) => ({ ...p, id: "seed-" + i, createdAt: Date.now() - i, uses: 0 }));
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list) ? list.filter((p): p is SavedPrompt => !!p && typeof p.id === "string" && typeof p.title === "string" && typeof p.content === "string").slice(0, 200) : [];
  } catch { return []; }
}
export function savePrompts(list: SavedPrompt[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 200))); } catch { /* storage unavailable */ }
}

import type { ReasoningRequest } from "./api";
import type { ApiStatus } from "../types";

export type ThinkingLevel = {
  id: "instant" | "light" | "balanced" | "deep" | "max";
  label: string;
  hint: string;
  effort?: "low" | "medium" | "high";
  maxSeconds: number;
  priority: 1 | 2 | 5;
};

/** Five stops on the composer slider, from "answer now" to "think as long as it takes". */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  { id: "instant", label: "即时", hint: "直接回答，速度最快", maxSeconds: 0, priority: 1 },
  { id: "light", label: "轻度", hint: "简单想一想再回答", effort: "low", maxSeconds: 60, priority: 1 },
  { id: "balanced", label: "均衡", hint: "兼顾速度与质量", effort: "medium", maxSeconds: 180, priority: 1 },
  { id: "deep", label: "深入", hint: "多步推理并自我检查", effort: "high", maxSeconds: 600, priority: 2 },
  { id: "max", label: "极致", hint: "最长思考预算，适合难题", effort: "high", maxSeconds: 1800, priority: 5 }
];

const KEY = "ciro.thinking-level.v1";
export function loadThinkingLevel(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return 2;
    const value = Number(raw);
    return Number.isInteger(value) && value >= 0 && value < THINKING_LEVELS.length ? value : 2;
  } catch { return 2; }
}
export function saveThinkingLevel(index: number): void {
  try { localStorage.setItem(KEY, String(index)); } catch { /* optional */ }
}

/** Map a slider stop to the request contract the server validates. */
export function reasoningRequest(index: number, status: ApiStatus): ReasoningRequest | undefined {
  const level = THINKING_LEVELS[index] ?? THINKING_LEVELS[2];
  if (!level.effort) return undefined;
  if (status.reasoningModes?.includes("deep")) {
    return { mode: "deep", effort: level.effort, maxSeconds: level.maxSeconds, priority: level.priority };
  }
  return status.reasoningEffort ? { mode: "fast", effort: level.effort } : undefined;
}

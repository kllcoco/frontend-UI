import { streamChat } from "./api";
import type { ReasoningRequest } from "./api";
import { isCustomModel } from "./custom-models";
import type { ApiStatus } from "../types";

/** Tool pages (持续思考, 研究, 知识问答, 协作空间计划) run on the chat model when their native service is not connected. */
export type ToolKind = "think" | "research" | "knowledge" | "plan";
export type ToolRun = { id: string; kind: ToolKind; question: string; answer: string; model: string; createdAt: number };

const KEY = "ciro.tool-runs.v1";
const MAX_RUNS = 60;

export function loadToolRuns(kind: ToolKind): ToolRun[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is ToolRun => Boolean(x) && typeof x === "object" && (x as ToolRun).kind === kind &&
      typeof (x as ToolRun).question === "string" && typeof (x as ToolRun).answer === "string");
  } catch { return []; }
}
function writeRuns(list: ToolRun[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RUNS))); } catch { /* storage unavailable */ }
}
function allRuns(): ToolRun[] {
  try { const raw: unknown = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(raw) ? raw as ToolRun[] : []; } catch { return []; }
}
export function saveToolRun(run: Omit<ToolRun, "id" | "createdAt">): ToolRun {
  const entry: ToolRun = { ...run, id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), createdAt: Date.now() };
  writeRuns([entry, ...allRuns()]);
  return entry;
}
export function clearToolRuns(kind: ToolKind): void {
  writeRuns(allRuns().filter((x) => x.kind !== kind));
}

/** The question goes first so the model (and its echo in previews) sees what was asked; the guidance follows. */
function guidance(kind: ToolKind, options: { deep?: boolean; webSearch?: boolean; context?: string }): string {
  const lang = "Answer in the same language as the request above.";
  switch (kind) {
    case "think":
      return "Think about the request above slowly and carefully before answering. Restate the core problem, explore several approaches " +
        "and their trade-offs, check your reasoning for mistakes and hidden assumptions, then give a clear, well-structured answer that ends " +
        "with a short conclusion and recommended next steps. " + lang;
    case "research":
      return "Write a structured research report on the topic above, in Markdown, with these sections:\n" +
        "1. Question: restate precisely what is being investigated.\n" +
        "2. Key findings: the most important points, each with how confident you are.\n" +
        "3. Sources: " + (options.webSearch ? "cite the web results you used, with links. " : "") +
        "name the publications, official documents or organisations you know of on this topic, and note for each that it should be checked; never invent links or quotations.\n" +
        "4. Open questions: what is uncertain, disputed or worth investigating next.\n" +
        (options.deep ? "Go into depth: compare viewpoints, give evidence and counter-evidence. " : "Keep it concise. ") + lang;
    case "knowledge":
      return "Answer the request above using only the excerpts from the user's files below. After each claim, cite the file name in square brackets, " +
        "e.g. [notes.md]. If the excerpts do not contain the answer, say so plainly. " + lang + "\n\n" + (options.context || "");
    case "plan":
      return "Turn the goal above into a practical step-by-step plan in Markdown: a numbered list of steps, each with what to do, " +
        "who or what does it, and how to check it is done (acceptance check). Finish with risks to watch and how to verify the final result. " +
        "Do not claim that any step has been carried out. " + lang;
  }
}

export type ModelToolOptions = {
  model: string;
  status?: ApiStatus;
  kind: ToolKind;
  question: string;
  deep?: boolean;
  context?: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
  onReasoning?: (text: string) => void;
};

/** True when there is a model to run on: the user's own model, or a configured server model. */
export function hasChatModel(model: string, status?: ApiStatus): boolean {
  return isCustomModel(model) || Boolean(status?.configured);
}

export async function runOnModel({ model, status, kind, question, deep, context, signal, onDelta, onReasoning }: ModelToolOptions): Promise<void> {
  const custom = isCustomModel(model);
  const webSearch = kind === "research" && !custom && status?.webSearch === true;
  const deepReasoning = (kind === "think" || (kind === "research" && deep)) && !custom && Boolean(status?.reasoningModes?.includes("deep"));
  const reasoning: ReasoningRequest | undefined = deepReasoning ? { mode: "deep", effort: status?.reasoningEffort ? "high" : undefined } : undefined;
  const content = question.trim() + "\n\n---\n" + guidance(kind, { deep, webSearch, context });
  await streamChat({
    model, signal, onDelta, onReasoning, usageKind: "other",
    messages: [{ id: "tool-" + Date.now().toString(36), role: "user", content, createdAt: Date.now() }],
    ...(reasoning ? { reasoning } : {}),
    ...(webSearch ? { webSearch: true } : {})
  });
}

/** Keywords for the local file search: words, and short CJK runs (longer runs are split into pairs). */
export function searchTerms(question: string, max = 8): string[] {
  const out: string[] = [];
  const add = (x: string) => { const v = x.toLowerCase(); if (v && !out.includes(v)) out.push(v); };
  for (const word of question.match(/[A-Za-z0-9_.-]{2,}/g) || []) if (!STOP.has(word.toLowerCase())) add(word);
  for (const run of question.match(/[㐀-鿿]+/g) || []) {
    if (run.length <= 4) add(run);
    else for (let i = 0; i + 1 < run.length; i += 1) add(run.slice(i, i + 2));
  }
  return out.slice(0, max);
}
const STOP = new Set(["the", "a", "an", "is", "are", "was", "what", "which", "who", "how", "why", "when", "where", "do", "does", "did",
  "of", "in", "on", "to", "for", "and", "or", "my", "me", "it", "this", "that", "with", "about", "from", "be", "can", "you"]);

import { customById, isCustomModel, streamCustom } from "./custom-models";
import { taskPrompt } from "./tasks";

/** Same as PET_PROMPT in server/validate.mjs: your own models (no server prompt) can steer the pet too. */
const CUSTOM_PET_PROMPT = "The user has your chibi avatar (Ciro) on their screen as a desktop pet. You may control it: at the very end of a reply, " +
  "optionally add ONE tag <pet mood=\"MOOD\" action=\"ACTION\">SHORT LINE</pet>; ACTION (optional) is one of wave, nod, shake, bow, jump, stretch, magic, spin, lookaround, yawn, hum, doze, tidy, giggle, sparkle, peek; " +
  "MOOD is one of idle, happy, love, shy, angry, sad, think, work, sleep, wave, eat and SHORT LINE is at most 20 characters she says in a speech bubble, in the user's language. " +
  "Use it naturally to react to the conversation; skip it when nothing fits. Never mention the tag.";
import {accountFetch} from "./account-api";
import type { ApiStatus, ChatMessage } from "../types";
import type { CustomInstructions } from "./instructions";
import { readUsage, recordUsage } from "./usage";
import type { Usage, UsageKind } from "./usage";

export async function getApiStatus(): Promise<ApiStatus> {
  const response = await fetch("/api/status", { cache: "no-store" });
  if (!response.ok) throw new Error("API 服务不可用");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("configured" in result) ||
      !("models" in result) || !Array.isArray(result.models)) {
    throw new Error("服务状态格式不正确");
  }
  const value = result as ApiStatus;
  return {
    configured: value.configured === true,
    model: typeof value.model === "string" ? value.model : "ciro",
    models: value.models.filter((model): model is string => typeof model === "string"),
    mode: value.configured === true ? "configured" : "preview",
    reasoningModes:Array.isArray(value.reasoningModes)?value.reasoningModes.filter((m):m is "fast"|"deep"=>m==="fast"||m==="deep"):["fast"],
    reasoningEffort:value.reasoningEffort===true,
    webSearch:(value as {webSearch?:unknown}).webSearch===true,
    searchProxy:(value as {searchProxy?:unknown}).searchProxy===true,
    stt:(value as {stt?:unknown}).stt===true,
    tts:(value as {tts?:unknown}).tts===true,
    images:(value as {images?:unknown}).images===true,
    team:(value as {team?:unknown}).team===true,
    setupHints:(value as {setupHints?:unknown}).setupHints===true,
    version:typeof (value as {version?:unknown}).version==="string"?(value as {version:string}).version:undefined
  };
}

type StreamOptions = {
  messages: (ChatMessage & { imageUrls?: string[] })[];
  model: string;
  instructions?: CustomInstructions;
  /** The pet is on: let the model steer it with a <pet> tag. */
  pet?: boolean;
  /** Spoken from the Android app: the model may operate the phone (<phone> tags); now = local time for "tomorrow 7:30". */
  phone?: { now: string };
  /** Timed tasks: the model may set / cancel them with <task> tags (lib/tasks.ts). */
  tasks?: { now: string; list: { id: string; title: string; when: string; repeat: string }[] };
  reasoning?:ReasoningRequest;
  project?:{name:string;instructions:string;files:{name:string;content:string}[]};
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** Streamed chain-of-thought summary (reasoning_content / reasoning), when the backend exposes it. */
  onReasoning?: (text: string) => void;
  /** Streamed OpenAI-style tool calls (name + incrementally streamed JSON arguments). */
  onTool?: (index: number, name: string | undefined, argsDelta: string) => void;
  webSearch?: boolean;
  memories?: string[];
  /** Reported CWU/GWU (never estimated). Recorded in the local usage ledger as `usageKind`. */
  onUsage?: (usage: Usage) => void;
  /** Web sources reported with the reply (web search). */
  onSources?: (sources: Source[]) => void;
  usageKind?: UsageKind;
  chatId?: string;
};
export type ReasoningRequest={mode:"fast"|"deep";effort?:"minimal"|"low"|"medium"|"high";maxSeconds?:number;priority?:1|2|5};

type ToolHandler = (index: number, name: string | undefined, argsDelta: string) => void;
export type Source = { url: string; title?: string; snippet?: string };
/** Web sources a model service reports for a reply, in any of the common formats: OpenAI url_citation
 *  annotations, Perplexity-style citations / search_results, or Ciro's own ciro_sources. */
export function readSources(payload: unknown): Source[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const out: Source[] = [];
  const add = (url: unknown, title?: unknown, snippet?: unknown) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return;
    out.push({ url, ...(typeof title === "string" && title.trim() ? { title: title.trim().slice(0, 200) } : {}),
      ...(typeof snippet === "string" && snippet.trim() ? { snippet: snippet.trim().slice(0, 300) } : {}) });
  };
  for (const c of Array.isArray(p.citations) ? p.citations : []) typeof c === "string" ? add(c) : add((c as Source)?.url, (c as Source)?.title);
  for (const key of ["search_results", "ciro_sources", "sources"]) {
    for (const r of Array.isArray(p[key]) ? p[key] as Record<string, unknown>[] : []) add(r?.url ?? r?.link, r?.title ?? r?.name, r?.snippet ?? r?.content ?? r?.description);
  }
  const choice = (Array.isArray(p.choices) ? p.choices[0] : undefined) as { delta?: { annotations?: unknown[] }; message?: { annotations?: unknown[] } } | undefined;
  for (const a of [...(choice?.delta?.annotations ?? []), ...(choice?.message?.annotations ?? [])] as { type?: string; url_citation?: { url?: string; title?: string } }[]) {
    if (a?.type === "url_citation") add(a.url_citation?.url, a.url_citation?.title);
  }
  return out;
}
function decodeSseEvent(event: string, onDelta: (text: string) => void, onReasoning?: (text: string) => void, onTool?: ToolHandler, onUsage?: (u: Usage) => void, onSources?: (s: Source[]) => void): boolean {
  const data = event.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return false;
  if (data.trim() === "[DONE]") return true;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return false; // Ignore keep-alive and non-JSON provider events.
  }
  if (!payload || typeof payload !== "object") return false;
  const entry = payload as {
    error?: { message?: string } | string;
    choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string;
      tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] };
      message?: { content?: string; reasoning_content?: string } }[];
  };
  const usage = readUsage(payload);
  if (usage && onUsage) onUsage(usage);
  if (onSources) { const found = readSources(payload); if (found.length) onSources(found); }
  if (entry.error) {
    throw new Error(typeof entry.error === "string" ? entry.error :
      entry.error.message || "后端流式响应失败");
  }
  const thought = entry.choices?.[0]?.delta?.reasoning_content ?? entry.choices?.[0]?.delta?.reasoning ??
    entry.choices?.[0]?.message?.reasoning_content;
  if (onReasoning && typeof thought === "string" && thought.length > 0) onReasoning(thought);
  for (const call of entry.choices?.[0]?.delta?.tool_calls ?? []) {
    if (onTool) onTool(call.index ?? 0, call.function?.name, call.function?.arguments ?? "");
  }
  const token = entry.choices?.[0]?.delta?.content ?? entry.choices?.[0]?.message?.content;
  if (typeof token === "string" && token.length > 0) onDelta(token);
  return false;
}

export async function streamChat(options: StreamOptions): Promise<void> {
  // Your own model (Settings → 模型设置): straight to that provider, key from this device, not billed in CWU.
  if (isCustomModel(options.model)) {
    const custom = customById(options.model);
    if (!custom) throw new Error("这个自定义模型已被删除，请在模型菜单里重新选择。");
    return streamCustom(custom, { messages: options.messages, signal: options.signal, instructions: options.instructions,
      system: [options.pet ? CUSTOM_PET_PROMPT : "", options.tasks ? taskPrompt(options.tasks.now, options.tasks.list) : ""].filter(Boolean).join("\n\n") || undefined,
      onDelta: options.onDelta, onReasoning: options.onReasoning });
  }
  // Usage arrives cumulatively (usually in the last chunk): keep the latest report and record it once.
  let usage: Usage | null = null;
  try {
    await streamChatInner({ ...options, onUsage: (u) => { usage = { ...usage, ...u }; } });
  } finally {
    const reported = usage as Usage | null;
    if (reported) {
      recordUsage({ ...reported, model: options.model, kind: options.usageKind ?? "other", chatId: options.chatId });
      options.onUsage?.(reported);
    }
  }
}

async function streamChatInner({ messages, model, instructions, reasoning, project, signal, onDelta, onReasoning, onTool, webSearch, memories, onUsage, onSources, pet, phone, tasks }: StreamOptions): Promise<void> {
  const response = await accountFetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.map(({ role, content, imageUrls }) => ({ role, content, ...(imageUrls?.length ? { images: imageUrls } : {}) })),
      ...(instructions?.enabled ? { instructions } : {}),
      ...(reasoning&&(reasoning.mode==="deep"||reasoning.effort)?{reasoning}:{}),
      ...(project&&(project.instructions.trim()||project.files.length)?{project}:{}),
      ...(webSearch?{webSearch:true}:{}),
      ...(memories?.length?{memories}:{}),
      ...(pet?{pet:true}:{}),
      ...(phone?{phone}:{}),
      ...(tasks?{tasks}:{})
    })
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(failure.error || "请求失败 (HTTP " + response.status + ")");
  }
  if (!response.body) throw new Error("服务器未返回可读取的响应流");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending = (pending + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      let split = pending.indexOf("\n\n");
      while (split !== -1) {
        const event = pending.slice(0, split);
        pending = pending.slice(split + 2);
        if (decodeSseEvent(event, onDelta, onReasoning, onTool, onUsage, onSources)) return;
        split = pending.indexOf("\n\n");
      }
    }
    if (pending.trim()) decodeSseEvent(pending, onDelta, onReasoning, onTool, onUsage, onSources);
  } finally {
    reader.releaseLock();
  }
}

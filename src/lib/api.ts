import {accountFetch} from "./account-api";
import type { ApiStatus, ChatMessage } from "../types";
import type { CustomInstructions } from "./instructions";

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
    reasoningEffort:value.reasoningEffort===true
  };
}

type StreamOptions = {
  messages: ChatMessage[];
  model: string;
  instructions?: CustomInstructions;
  reasoning?:ReasoningRequest;
  project?:{name:string;instructions:string;files:{name:string;content:string}[]};
  signal: AbortSignal;
  onDelta: (text: string) => void;
  /** Streamed chain-of-thought summary (reasoning_content / reasoning), when the backend exposes it. */
  onReasoning?: (text: string) => void;
};
export type ReasoningRequest={mode:"fast"|"deep";effort?:"minimal"|"low"|"medium"|"high";maxSeconds?:number;priority?:1|2|5};

function decodeSseEvent(event: string, onDelta: (text: string) => void, onReasoning?: (text: string) => void): boolean {
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
    choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string };
      message?: { content?: string; reasoning_content?: string } }[];
  };
  if (entry.error) {
    throw new Error(typeof entry.error === "string" ? entry.error :
      entry.error.message || "后端流式响应失败");
  }
  const thought = entry.choices?.[0]?.delta?.reasoning_content ?? entry.choices?.[0]?.delta?.reasoning ??
    entry.choices?.[0]?.message?.reasoning_content;
  if (onReasoning && typeof thought === "string" && thought.length > 0) onReasoning(thought);
  const token = entry.choices?.[0]?.delta?.content ?? entry.choices?.[0]?.message?.content;
  if (typeof token === "string" && token.length > 0) onDelta(token);
  return false;
}

export async function streamChat({ messages, model, instructions, reasoning, project, signal, onDelta, onReasoning }: StreamOptions): Promise<void> {
  const response = await accountFetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      ...(instructions?.enabled ? { instructions } : {}),
      ...(reasoning&&(reasoning.mode==="deep"||reasoning.effort)?{reasoning}:{}),
      ...(project&&(project.instructions.trim()||project.files.length)?{project}:{})
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
        if (decodeSseEvent(event, onDelta, onReasoning)) return;
        split = pending.indexOf("\n\n");
      }
    }
    if (pending.trim()) decodeSseEvent(pending, onDelta, onReasoning);
  } finally {
    reader.releaseLock();
  }
}

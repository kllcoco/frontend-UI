import type { ApiStatus, ChatMessage } from "../types";

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
    mode: value.configured === true ? "configured" : "preview"
  };
}

type StreamOptions = {
  messages: ChatMessage[];
  model: string;
  signal: AbortSignal;
  onDelta: (text: string) => void;
};

function decodeSseEvent(event: string, onDelta: (text: string) => void): boolean {
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
    choices?: { delta?: { content?: string }; message?: { content?: string } }[];
  };
  if (entry.error) {
    throw new Error(typeof entry.error === "string" ? entry.error :
      entry.error.message || "后端流式响应失败");
  }
  const token = entry.choices?.[0]?.delta?.content ?? entry.choices?.[0]?.message?.content;
  if (typeof token === "string" && token.length > 0) onDelta(token);
  return false;
}

export async function streamChat({ messages, model, signal, onDelta }: StreamOptions): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: messages.map(({ role, content }) => ({ role, content }))
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
      pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let split = pending.indexOf("\n\n");
      while (split !== -1) {
        const event = pending.slice(0, split);
        pending = pending.slice(split + 2);
        if (decodeSseEvent(event, onDelta)) return;
        split = pending.indexOf("\n\n");
      }
    }
    if (pending.trim()) decodeSseEvent(pending, onDelta);
  } finally {
    reader.releaseLock();
  }
}

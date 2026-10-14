/* Your own models: any OpenAI-compatible API (DeepSeek, 通义千问, Kimi, 智谱, OpenAI, OpenRouter, a local Ollama…)
   added in Settings → 模型设置. The API key stays on this device; chats with these models go straight from the app
   to that provider (they are not billed in CWU). Picked like any model: "custom:<id>". */
import type { ChatMessage } from "../types";
import type { CustomInstructions } from "./instructions";

/** "openai": any Chat Completions API (most providers, incl. Gemini / Grok / DeepSeek…); "anthropic": Claude's Messages API. */
export type ModelApi = "openai" | "anthropic";
export type CustomModel = { id: string; name: string; baseUrl: string; apiKey: string; model: string; api?: ModelApi };
export const CUSTOM_PREFIX = "custom:";
const KEY = "ciro.custom-models.v1";

export const MODEL_PRESETS: { id: string; name: string; baseUrl: string; model: string; api?: ModelApi }[] = [
  { id: "claude", name: "Claude", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", api: "anthropic" },
  { id: "openai", name: "OpenAI (GPT)", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { id: "gemini", name: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  { id: "grok", name: "Grok", baseUrl: "https://api.x.ai/v1", model: "grok-3-mini" },
  { id: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-flash" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { id: "kimi", name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  { id: "glm", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  { id: "ollama", name: "Ollama（本机）", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" }
];

export function loadCustomModels(): CustomModel[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as CustomModel[];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.id === "string" && typeof m.baseUrl === "string" && typeof m.model === "string").slice(0, 30) : [];
  } catch { return []; }
}
/** Desktop app: let the providers' hosts answer this page (see ciro:model-hosts in desktop/main.cjs). */
export function shareModelHosts(list = loadCustomModels()): void {
  const d = (window as unknown as { ciroDesktop?: { modelHosts?: (hosts: string[]) => void } }).ciroDesktop;
  try { d?.modelHosts?.([...new Set(list.map((m) => new URL(m.baseUrl).origin))]); } catch { /* bad URL */ }
}
export function saveCustomModels(list: CustomModel[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 30))); } catch { /* storage off */ }
  shareModelHosts(list);
  window.dispatchEvent(new CustomEvent("ciro-custom-models", { detail: list }));
}
export const isCustomModel = (id: string) => id.startsWith(CUSTOM_PREFIX);
export const customById = (id: string) => loadCustomModels().find((m) => CUSTOM_PREFIX + m.id === id) || null;

/** "https://api.x.com/v1/" → "https://api.x.com/v1"; only http(s). */
export function normalizeBaseUrl(raw: string): string {
  const v = raw.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  const u = new URL(v);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error("invalid");
  return v;
}

type Msg = ChatMessage & { imageUrls?: string[] };
function toOpenAI(messages: Msg[], instructions?: CustomInstructions, system?: string) {
  const out: { role: string; content: unknown }[] = [];
  if (system) out.push({ role: "system", content: system });
  if (instructions?.enabled && (instructions.about.trim() || instructions.style.trim()))
    out.push({ role: "system", content: [instructions.about.trim() && "About the user: " + instructions.about.trim(), instructions.style.trim() && "How to answer: " + instructions.style.trim()].filter(Boolean).join("\n") });
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    out.push({ role: m.role, content: m.imageUrls?.length
      ? [{ type: "text", text: m.content }, ...m.imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))] : m.content });
  }
  return out;
}

/** Models that answered 400 to reasoning_effort (asked without it from then on). */
const noEffort = new Set<string>();
/** The composer's thinking-depth stop: instant · light · balanced · deep · max. */
export type Depth = "instant" | "light" | "balanced" | "deep" | "max";
type StreamOpts = { messages: Msg[]; signal: AbortSignal; instructions?: CustomInstructions; system?: string; depth?: Depth; onDelta: (text: string) => void; onReasoning?: (text: string) => void };

/** Claude through the official SDK (direct browser access, the user's own key). */
async function streamClaude(model: CustomModel, opts: StreamOpts): Promise<void> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: model.apiKey, baseURL: model.baseUrl.replace(/\/v1$/, ""), dangerouslyAllowBrowser: true });
  const system = [opts.system, opts.instructions?.enabled && opts.instructions.about.trim() && "About the user: " + opts.instructions.about.trim(),
    opts.instructions?.enabled && opts.instructions.style.trim() && "How to answer: " + opts.instructions.style.trim()].filter(Boolean).join("\n") || undefined;
  const messages = opts.messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => {
    const images = (m.imageUrls || []).map((url) => /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(url)).filter(Boolean)
      .map((x) => ({ type: "image" as const, source: { type: "base64" as const, media_type: x![1] as "image/png", data: x![2] } }));
    return { role: m.role as "user" | "assistant", content: images.length ? [...images, { type: "text" as const, text: m.content || " " }] : (m.content || " ") };
  });
  // Adaptive thinking on the models that take it (Claude 4.6 and later), its depth set by output_config.effort;
  // older models that think (3.7, 4.0–4.5) get a thinking budget per depth; Claude 3 runs without.
  const adaptive = /claude-(opus|sonnet|fable|mythos)-(4-[6-9]|[5-9])|claude-haiku-[5-9]/.test(model.model);
  const legacyThinking = !adaptive && /claude-(3-7|(opus|sonnet|haiku)-4)/.test(model.model);
  const depth = opts.depth || "balanced";
  const fifthGen = /claude-(opus|fable|mythos)-[5-9]/.test(model.model);
  const effort = ({ instant: "low", light: "low", balanced: "medium", deep: "high", max: fifthGen ? "max" : "high" } as const)[depth];
  const budget = ({ instant: 0, light: 2048, balanced: 6000, deep: 12000, max: 24000 } as const)[depth];
  // Output caps differ by model: 64K on current ones; older models reject a max_tokens above their own limit.
  const baseMax = adaptive ? 64000 : /claude-3-(opus|sonnet|haiku)/.test(model.model) ? 4096 : 8192;
  const tuned = (plain: boolean) => plain ? {}
    : adaptive ? { output_config: { effort } }
    : legacyThinking && budget ? { thinking: { type: "enabled", budget_tokens: budget } } : {};
  let streamed = false;
  const run = async (plain: boolean) => {
    const extra = tuned(plain) as Record<string, unknown>;
    const stream = client.messages.stream({ model: model.model, messages, ...(system ? { system } : {}),
      max_tokens: extra.thinking ? baseMax + budget : baseMax,
      ...(adaptive ? { thinking: { type: "adaptive", display: "summarized" } as never } : {}), ...extra } as never, { signal: opts.signal });
    for await (const event of stream) {
      if (event.type !== "content_block_delta") continue;
      streamed = true;
      if (event.delta.type === "text_delta") opts.onDelta(event.delta.text);
      else if (event.delta.type === "thinking_delta") opts.onReasoning?.(event.delta.thinking);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") opts.onDelta("\n\n（Claude 拒绝回答了这个请求。）");
  };
  try {
    try { await run(false); }
    catch (e) {
      // A model or gateway that does not take the depth setting: ask again without it.
      if (!streamed && !opts.signal.aborted && e instanceof Anthropic.BadRequestError && Object.keys(tuned(false)).length) await run(true);
      else throw e;
    }
  } catch (e) {
    if (opts.signal.aborted) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new Error("「" + model.name + "」的 API Key 不正确。");
    if (e instanceof Anthropic.RateLimitError) throw new Error("「" + model.name + "」请求太频繁，请稍后再试。");
    if (e instanceof Anthropic.APIError) throw new Error("「" + model.name + "」返回错误（" + (e.status ?? "?") + "）：" + String(e.message).slice(0, 160));
    throw new Error("连不上「" + model.name + "」：请检查接口地址和网络。");
  }
}

/** The model names the provider offers (GET /models), so nobody has to guess one. Empty when it has no such list. */
export async function listModels(m: Pick<CustomModel, "baseUrl" | "apiKey" | "api">, signal?: AbortSignal): Promise<string[]> {
  const anthropic = m.api === "anthropic";
  const url = anthropic ? m.baseUrl.replace(/\/v1$/, "") + "/v1/models?limit=100" : m.baseUrl + "/models";
  const headers: Record<string, string> = anthropic
    ? { "x-api-key": m.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" }
    : m.apiKey ? { Authorization: "Bearer " + m.apiKey } : {};
  const res = await fetch(url, { headers, signal });
  if (!res.ok) return [];
  const body = await res.json().catch(() => ({})) as { data?: { id?: string; name?: string }[]; models?: { id?: string; name?: string }[] };
  const ids = (body.data || body.models || []).map((x) => String(x.id || x.name || "").replace(/^models\//, "")).filter(Boolean);
  return [...new Set(ids)].sort().slice(0, 200);
}
/** Model names an error message says are accepted ("supported model names are a, b"). */
export function namesFromError(text: string): string[] {
  const m = /(?:supported|available|valid)[^:]*?(?:names?|models?)\s*(?:are|is|:)\s*((?:[^.(]|\.(?=[\w-]))+)/i.exec(text);
  return m ? m[1].split(/,|\s+(?:or|and)\s+/).map((x) => x.trim().replace(/^[`'"]|[`'"]$/g, "")).filter((x) => /^[\w./:-]{2,80}$/.test(x)).slice(0, 12) : [];
}

/** Streams a reply from the provider (Chat Completions SSE, or a JSON body if it ignores stream). */
export async function streamCustom(model: CustomModel, opts: StreamOpts): Promise<void> {
  if (model.api === "anthropic") return streamClaude(model, opts);
  // Thinking depth as the standard reasoning_effort (OpenAI o-series / GPT-5, Gemini, Grok, DeepSeek, OpenRouter…).
  // Services that do not know it answer 400: then the same request goes again without it.
  const effort = ({ instant: "", light: "low", balanced: "", deep: "high", max: "high" } as const)[opts.depth || "balanced"];
  const send = (withEffort: boolean) => fetch(model.baseUrl + "/chat/completions", { method: "POST", signal: opts.signal,
    headers: { "Content-Type": "application/json", ...(model.apiKey ? { Authorization: "Bearer " + model.apiKey } : {}) },
    body: JSON.stringify({ model: model.model, messages: toOpenAI(opts.messages, opts.instructions, opts.system), stream: true,
      ...(withEffort && effort ? { reasoning_effort: effort } : {}) }) });
  let res: Response;
  try {
    const key = model.baseUrl + " " + model.model;
    res = await send(!noEffort.has(key));
    if (effort && !noEffort.has(key) && (res.status === 400 || res.status === 422)) {
      res = await send(false);
      if (res.ok) noEffort.add(key); // remembered for this session: no second request every time
    }
  } catch (e) {
    if (opts.signal.aborted) throw e;
    throw new Error("连不上「" + model.name + "」：请检查接口地址和网络（有些服务不允许从应用直接访问）。");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } | string };
    const why = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error("「" + model.name + "」返回错误（" + res.status + "）" + (why ? "：" + String(why).slice(0, 160) : "") + (res.status === 401 ? "。请检查 API Key。" : ""));
  }
  if (!(res.headers.get("content-type") || "").includes("event-stream") || !res.body) {
    const json = await res.json().catch(() => ({})) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    const msg = json.choices?.[0]?.message;
    if (msg?.reasoning_content) opts.onReasoning?.(msg.reasoning_content);
    if (msg?.content) opts.onDelta(msg.content);
    return;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const d = (JSON.parse(data) as { choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[] }).choices?.[0]?.delta;
        if (d?.reasoning_content || d?.reasoning) opts.onReasoning?.(d.reasoning_content || d.reasoning || "");
        if (d?.content) opts.onDelta(d.content);
      } catch { /* keep-alive or partial line */ }
    }
  }
}

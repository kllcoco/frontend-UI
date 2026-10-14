/* Your own models: any OpenAI-compatible API (DeepSeek, 通义千问, Kimi, 智谱, OpenAI, OpenRouter, a local Ollama…)
   added in Settings → 模型设置. The API key stays on this device; chats with these models go straight from the app
   to that provider (they are not billed in CWU). Picked like any model: "custom:<id>". */
import type { ChatMessage } from "../types";
import type { CustomInstructions } from "./instructions";

/** "openai": any Chat Completions API (most providers, incl. Gemini / Grok / DeepSeek…); "anthropic": Claude's Messages API. */
export type ModelApi = "openai" | "anthropic";
/** workspace: Claude only — keys not scoped to a workspace must name one (anthropic-workspace-id). */
export type CustomModel = { id: string; name: string; baseUrl: string; apiKey: string; model: string; api?: ModelApi; workspace?: string };
/** Claude keys that are not scoped to a workspace: the Workspace ID has to be filled in. */
export const NEEDS_WORKSPACE = "需要填写 Workspace ID";
const workspaceHeaders = (m: Pick<CustomModel, "workspace">): Record<string, string> =>
  m.workspace?.trim() ? { "anthropic-workspace-id": m.workspace.trim() } : {};
/** The provider's own message out of "400 {json}". */
function apiMessage(raw: string): string {
  const i = raw.indexOf("{");
  if (i >= 0) { try { const j = JSON.parse(raw.slice(i)); const m = j?.error?.message || j?.message; if (typeof m === "string") return m; } catch { /* not JSON */ } }
  return raw;
}
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
/** What every provider accepts: no empty turns (a failed reply), user and assistant taking turns (DeepSeek's reasoner,
 *  Mistral and Claude reject two in a row), starting with the user. Consecutive turns of one role are joined. */
export function cleanTurns(messages: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    const text = (m.content || "").trim();
    if (!text && !m.imageUrls?.length) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      out[out.length - 1] = { ...prev, content: [prev.content, text].filter(Boolean).join("\n\n"), imageUrls: [...(prev.imageUrls || []), ...(m.imageUrls || [])] };
    } else out.push({ ...m, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
/** One system message (several, or one after the first turn, are refused by some services). */
function systemText(instructions?: CustomInstructions, system?: string): string {
  return [system, instructions?.enabled && instructions.about.trim() && "About the user: " + instructions.about.trim(),
    instructions?.enabled && instructions.style.trim() && "How to answer: " + instructions.style.trim()].filter(Boolean).join("\n\n");
}
function toOpenAI(messages: Msg[], instructions?: CustomInstructions, system?: string, images = true) {
  const out: { role: string; content: unknown }[] = [];
  const sys = systemText(instructions, system);
  if (sys) out.push({ role: "system", content: sys });
  for (const m of cleanTurns(messages)) {
    const pics = images ? m.imageUrls || [] : [];
    out.push({ role: m.role, content: pics.length
      ? [{ type: "text", text: m.content || " " }, ...pics.map((url) => ({ type: "image_url", image_url: { url } }))]
      : m.content || (m.imageUrls?.length ? "（图片）" : " ") });
  }
  return out;
}

/** Android app: services that do not allow apps to call them from a web page (no CORS headers) are asked through the
 *  phone's own HTTP stack instead (the whole answer then arrives at once). Elsewhere this is plain fetch. */
export async function modelFetch(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, init); }
  catch (e) {
    if (init.signal?.aborted) throw e;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) throw e;
    const { CapacitorHttp } = await import("@capacitor/core");
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const body = typeof init.body === "string" ? init.body : undefined;
    let data: unknown = undefined;
    if (body) { try { data = JSON.parse(body); } catch { data = body; } }
    const r = await CapacitorHttp.request({ url, method: init.method || "GET", headers, data, responseType: "text", connectTimeout: 30_000, readTimeout: 300_000 });
    const text = typeof r.data === "string" ? r.data : JSON.stringify(r.data);
    const type = Object.entries(r.headers || {}).find(([k]) => k.toLowerCase() === "content-type")?.[1] || (text.trimStart().startsWith("data:") ? "text/event-stream" : "application/json");
    return new Response(text, { status: r.status, headers: { "content-type": String(type) } });
  }
}
/** Why a service could not be reached, with the fix for a model on this computer (Ollama, LM Studio…). */
function unreachable(model: CustomModel): string {
  if (/^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/i.test(model.baseUrl))
    return "连不上「" + model.name + "」：本机模型需要先启动，并允许 Ciro 访问（Ollama：设置环境变量 OLLAMA_ORIGINS=* 后重启）。"
      + "在手机上 127.0.0.1 指的是手机自己，请改成电脑的局域网地址（如 http://192.168.1.5:11434/v1），并让它监听 0.0.0.0（OLLAMA_HOST=0.0.0.0）。";
  return "连不上「" + model.name + "」：请检查接口地址和网络（有些服务不允许从网页直接访问，可以改用 Ciro 的桌面版或 Android 应用）。";
}
/** What to do about a status code, in plain words. */
function hint(status: number): string {
  return status === 401 ? "。请检查 API Key。" : status === 402 ? "。这个服务的账户余额不足，请先充值。"
    : status === 403 ? "。这个 Key 没有权限使用该模型（或所在地区不可用）。" : status === 404 ? "。接口地址或模型名不对，可以点“编辑 → 获取模型列表”。"
    : status === 429 ? "。请求太频繁或额度已用完，请稍后再试。" : status >= 500 ? "。对方服务暂时出错，请稍后再试。" : "";
}
/** The error text in a provider's error body ({error:{message}}, {error:"…"}, [{error:…}], {message}, plain text). */
export function errorText(body: string): string {
  try {
    let j = JSON.parse(body) as unknown;
    if (Array.isArray(j)) j = j[0];
    const o = j as { error?: { message?: string } | string; message?: string; msg?: string; detail?: string };
    const m = typeof o?.error === "string" ? o.error : o?.error?.message || o?.message || o?.msg || o?.detail;
    if (m) return String(m);
  } catch { /* not JSON */ }
  return body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/** Models that answered 400 to reasoning_effort (asked without it from then on). */
const noEffort = new Set<string>();
/** The composer's thinking-depth stop: instant · light · balanced · deep · max. */
export type Depth = "instant" | "light" | "balanced" | "deep" | "max";
type StreamOpts = { messages: Msg[]; signal: AbortSignal; instructions?: CustomInstructions; system?: string; depth?: Depth; onDelta: (text: string) => void; onReasoning?: (text: string) => void };

/** Claude through the official SDK (direct browser access, the user's own key). */
async function streamClaude(model: CustomModel, opts: StreamOpts): Promise<void> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: model.apiKey, baseURL: model.baseUrl.replace(/\/v1$/, ""), dangerouslyAllowBrowser: true,
    defaultHeaders: workspaceHeaders(model), fetch: modelFetch as never });
  const system = systemText(opts.instructions, opts.system) || undefined;
  const messages = cleanTurns(opts.messages).map((m) => {
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
    if (e instanceof Anthropic.APIError) {
      const why = apiMessage(String(e.message));
      if (/workspace/i.test(why)) throw new Error("「" + model.name + "」的 API Key 没有归属某个工作区，" + NEEDS_WORKSPACE
        + "（Claude 控制台 → Settings → Workspaces，形如 wrkspc_…），或者在控制台的某个工作区里新建一个 Key。");
      throw new Error("「" + model.name + "」返回错误（" + (e.status ?? "?") + "）：" + why.slice(0, 300) + hint(Number(e.status) || 0));
    }
    throw new Error(unreachable(model));
  }
}

/** The model names the provider offers (GET /models), so nobody has to guess one. Empty when it has no such list. */
export async function listModels(m: Pick<CustomModel, "baseUrl" | "apiKey" | "api" | "workspace">, signal?: AbortSignal): Promise<string[]> {
  const anthropic = m.api === "anthropic";
  const url = anthropic ? m.baseUrl.replace(/\/v1$/, "") + "/v1/models?limit=100" : m.baseUrl + "/models";
  const headers: Record<string, string> = anthropic
    ? { "x-api-key": m.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true", ...workspaceHeaders(m) }
    : m.apiKey ? { Authorization: "Bearer " + m.apiKey } : {};
  const res = await modelFetch(url, { headers, signal });
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
  const hasImages = opts.messages.some((m) => (m as Msg).imageUrls?.length);
  let history = opts.messages as Msg[];
  const send = (withEffort: boolean, images = true) => modelFetch(model.baseUrl + "/chat/completions", { method: "POST", signal: opts.signal,
    headers: { "Content-Type": "application/json", ...(model.apiKey ? { Authorization: "Bearer " + model.apiKey } : {}) },
    body: JSON.stringify({ model: model.model, messages: toOpenAI(history, opts.instructions, opts.system, images), stream: true,
      ...(withEffort && effort ? { reasoning_effort: effort } : {}) }) });
  let res: Response;
  try {
    const key = model.baseUrl + " " + model.model;
    const tryEffort = Boolean(effort) && !noEffort.has(key);
    res = await send(tryEffort);
    if (tryEffort && (res.status === 400 || res.status === 422)) {
      res = await send(false);
      if (res.ok) noEffort.add(key); // remembered for this session: no second request every time
    }
    // A model that cannot see pictures: the text goes on its own, and the user is told.
    if (hasImages && (res.status === 400 || res.status === 422)) {
      const again = await send(false, false);
      if (again.ok) { opts.onDelta("（这个模型不支持图片，只发送了文字。）\n\n"); res = again; }
    }
  } catch (e) {
    if (opts.signal.aborted) throw e;
    throw new Error(unreachable(model));
  }
  let why = "";
  if (!res.ok) {
    why = errorText(await res.text().catch(() => ""));
    // Too long for this model's context window (e.g. an 8K model): ask again with just the latest turns.
    if ((res.status === 400 || res.status === 413 || res.status === 422) && /context|too long|too many tokens|maximum.*tokens|token.*(limit|exceed)|length|上下文|超出|过长/i.test(why) && history.length > 2) {
      history = cleanTurns(cleanTurns(history).slice(-3)).map((m) => ({ ...m, content: m.content.length > 6000 ? "…" + m.content.slice(-6000) : m.content }));
      try {
        const again = await send(false);
        if (again.ok) { opts.onDelta("（对话太长，超出了这个模型能读的长度，只发送了最近几轮。）\n\n"); res = again; }
        else why = errorText(await again.text().catch(() => "")) || why;
      } catch (e) { if (opts.signal.aborted) throw e; }
    }
  }
  if (!res.ok) {
    throw new Error("「" + model.name + "」返回错误（" + res.status + "）" + (why ? "：" + String(why).slice(0, 300) : "") + hint(res.status));
  }
  if (!(res.headers.get("content-type") || "").includes("event-stream") || !res.body) {
    const json = await res.json().catch(() => ({})) as { error?: unknown; choices?: { message?: { content?: string; reasoning_content?: string } }[] };
    if (json.error) throw new Error("「" + model.name + "」返回错误：" + errorText(JSON.stringify(json)).slice(0, 300));
    const msg = json.choices?.[0]?.message;
    if (msg?.reasoning_content) opts.onReasoning?.(msg.reasoning_content);
    if (msg?.content) opts.onDelta(msg.content);
    return;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "", streamError = "", finished = false;
  const line = (raw: string) => {
    const text = raw.trim();
    if (!text.startsWith("data:")) return;
    const data = text.slice(5).trim();
    if (data === "[DONE]") { finished = true; return; }
    try {
      const event = JSON.parse(data) as { error?: unknown; choices?: { delta?: { content?: string; reasoning_content?: string; reasoning?: string } }[] };
      // Some services (OpenRouter, gateways) report a failure inside the stream.
      if (event.error) { streamError = errorText(data); return; }
      const d = event.choices?.[0]?.delta;
      if (d?.reasoning_content || d?.reasoning) opts.onReasoning?.(d.reasoning_content || d.reasoning || "");
      if (d?.content) opts.onDelta(d.content);
    } catch { /* keep-alive or partial line */ }
  };
  while (!finished && !streamError) {
    const { done, value } = await reader.read();
    if (done) { line(buf); break; } // the last line may come without a newline
    buf += dec.decode(value, { stream: true });
    let i;
    while (!finished && !streamError && (i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  if (finished || streamError) reader.cancel().catch(() => {});
  if (streamError) throw new Error("「" + model.name + "」返回错误：" + streamError.slice(0, 300));
}

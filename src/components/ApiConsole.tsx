import { useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Check, Copy, FlaskConical, ListOrdered, Play } from "lucide-react";
import { accountApi, accountFetch, readApiJson } from "../lib/account-api";
import { formatUnits } from "../lib/usage";

type KeyUsage = { today: Totals; last30: Totals; daily: { day: string; cwu: number; calls: number }[] };
type Totals = { calls: number; errors: number; cwu: number; gwu: number };
type LogRow = { at: string; keyId: string; model: string; status: number; ms: number; cwu: number; gwu: number; stream: boolean; error?: string };
type Console = { keys: Record<string, KeyUsage>; log: LogRow[]; models: string[]; baseUrlPath: string; configured: boolean; accountsEnabled: boolean };
type KeyInfo = { id: string; name: string; prefix: string; revokedAt: string | null };

/** Settings → API console: base URL and docs, per-key CWU usage, recent calls and an in-browser test. */
export default function ApiConsole({ t, locale }: { t: (s: string) => string; locale: string }) {
  const [data, setData] = useState<Console | null>(null);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"curl" | "python" | "js">("curl");
  const [copied, setCopied] = useState("");
  const base = window.location.origin + "/v1";
  const load = () => {
    setError("");
    accountFetch("/api/apiconsole/usage").then((r) => readApiJson<Console>(r, t("无法读取 API 用量"))).then(setData, (e) => setError(e instanceof Error ? e.message : String(e)));
    accountApi<{ keys: KeyInfo[] }>("/api-keys").then((r) => setKeys(r.keys), () => setKeys([]));
  };
  useEffect(load, []);
  const model = data?.models[0] || "ciro";
  const fmt = (n: number) => formatUnits(n, locale);
  const nameOf = (id: string) => { const k = keys.find((x) => x.id === id); return k ? k.name + " (" + k.prefix + "…)" : id.slice(0, 8); };
  const examples = useMemo(() => ({
    curl: `curl ${base}/chat/completions \\\n  -H "Authorization: Bearer $CIRO_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "${model}", "messages": [{"role": "user", "content": "你好"}]}'`,
    python: `from openai import OpenAI\n\nclient = OpenAI(base_url="${base}", api_key="ciro_sk_...")\nreply = client.chat.completions.create(\n    model="${model}",\n    messages=[{"role": "user", "content": "你好"}],\n)\nprint(reply.choices[0].message.content)\nprint(reply.usage)  # CWU reported by Ciro`,
    js: `import OpenAI from "openai";\n\nconst client = new OpenAI({ baseURL: "${base}", apiKey: process.env.CIRO_API_KEY });\nconst stream = await client.chat.completions.create({\n  model: "${model}",\n  messages: [{ role: "user", content: "你好" }],\n  stream: true,\n});\nfor await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`
  }), [base, model]);
  const copy = (id: string, text: string) => { void navigator.clipboard?.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied(""), 1500); }); };

  return <div className="api-root">
    <section className="api-card">
      <h3><BookOpen size={17}/>{t("接入方式")}</h3>
      <p className="api-muted">{t("兼容主流 Chat Completions SDK：把 Base URL 换成下面的地址、使用这里创建的 API 密钥即可，支持流式输出。用量按 Ciro 原生 CWU 计量。")}</p>
      <div className="api-base"><code>{base}</code>
        <button type="button" onClick={() => copy("base", base)} aria-label={t("复制 Base URL")}>{copied === "base" ? <Check size={15}/> : <Copy size={15}/>}</button></div>
      <p className="api-muted">{t("可用模型：")}{data?.models.map((m) => <code key={m} className="api-chip">{m}</code>)}</p>
      <div className="api-tabs" role="tablist">
        {([["curl", "curl"], ["python", "Python"], ["js", "JavaScript"]] as const).map(([id, label]) =>
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      <div className="api-code"><pre>{examples[tab]}</pre>
        <button type="button" onClick={() => copy(tab, examples[tab])} aria-label={t("复制示例代码")}>{copied === tab ? <Check size={15}/> : <Copy size={15}/>}</button></div>
      <p className="api-muted">{t("端点：POST /v1/chat/completions、GET /v1/models。请求头 Authorization: Bearer 你的密钥（需要 chat:invoke 权限）。错误按 OpenAI 格式返回 error.message。")}</p>
    </section>

    <section className="api-card">
      <h3><Activity size={17}/>{t("各密钥用量")}<button type="button" className="api-link" onClick={load}>{t("刷新")}</button></h3>
      {error && <p className="api-warn" role="alert">{error}</p>}
      {data && !Object.keys(data.keys).length && <p className="api-muted">{t("还没有 API 调用。创建密钥后，用上面的示例发一次请求试试。")}</p>}
      {data && Object.entries(data.keys).map(([id, u]) => {
        const max = Math.max(1, ...u.daily.map((d) => d.cwu));
        return <div className="api-key-usage" key={id}>
          <div className="api-key-head"><strong>{nameOf(id)}</strong>
            <span>{t("今天")} {fmt(u.today.cwu)} CWU · {u.today.calls} {t("次调用")}</span>
            <span>{t("近 30 天")} {fmt(u.last30.cwu)} CWU · {u.last30.calls} {t("次调用")}{u.last30.errors ? " · " + u.last30.errors + " " + t("次失败") : ""}</span></div>
          <div className="api-spark" role="img" aria-label={t("近 14 天每日 CWU")}>
            {u.daily.map((d) => <span key={d.day} title={d.day + " · " + fmt(d.cwu) + " CWU · " + d.calls + " " + t("次调用")} style={{ height: Math.max(d.cwu ? 6 : 2, Math.round(d.cwu / max * 100)) + "%" }}/>)}
          </div>
        </div>;
      })}
    </section>

    <section className="api-card">
      <h3><ListOrdered size={17}/>{t("最近调用")}</h3>
      {data && !data.log.length && <p className="api-muted">{t("暂无数据")}</p>}
      {!!data?.log.length && <div className="api-table-wrap"><table className="api-table">
        <thead><tr><th>{t("时间")}</th><th>{t("密钥")}</th><th>{t("模型")}</th><th>{t("状态")}</th><th>{t("耗时")}</th><th>CWU</th></tr></thead>
        <tbody>{data.log.slice(0, 50).map((r, i) => <tr key={i} className={r.status >= 400 ? "api-err" : ""} title={r.error || ""}>
          <td>{new Date(r.at).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</td>
          <td>{nameOf(r.keyId)}</td><td>{r.model}{r.stream ? " · stream" : ""}</td><td>{r.status}</td><td>{r.ms} ms</td><td>{fmt(r.cwu)}</td></tr>)}</tbody>
      </table></div>}
      <p className="api-muted">{t("只记录时间、模型、状态、耗时和用量，不保存请求和回答的内容。")}</p>
    </section>

    <Playground t={t} base={base} models={data?.models || []}/>
  </div>;
}

function Playground({ t, base, models }: { t: (s: string) => string; base: string; models: string[] }) {
  const [key, setKey] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("用一句话介绍你自己");
  const [stream, setStream] = useState(true);
  const [out, setOut] = useState("");
  const [meta, setMeta] = useState("");
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setOut(""); setMeta("");
    const started = performance.now();
    try {
      const response = await fetch(base + "/chat/completions", { method: "POST",
        headers: { Authorization: "Bearer " + key.trim(), "Content-Type": "application/json" },
        body: JSON.stringify({ model: model || models[0], stream, messages: [{ role: "user", content: prompt }] }) });
      if (!response.ok) { const j = await response.json().catch(() => ({})) as { error?: { message?: string } }; throw new Error((j.error?.message || "HTTP " + response.status)); }
      let usage: unknown = null;
      if (stream && response.body) {
        const reader = response.body.getReader(); const dec = new TextDecoder(); let buf = "", text = "";
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true }); const lines = buf.split("\n"); buf = lines.pop() || "";
          for (const l of lines) { if (!l.startsWith("data:") || l.includes("[DONE]")) continue;
            try { const c = JSON.parse(l.slice(5)); text += c.choices?.[0]?.delta?.content ?? ""; if (c.usage) usage = c.usage; } catch { /* partial */ } }
          setOut(text);
        }
      } else { const j = await response.json(); setOut(j.choices?.[0]?.message?.content ?? JSON.stringify(j, null, 2)); usage = j.usage; }
      const cwu = (usage as { cwu?: number } | null)?.cwu;
      setMeta(Math.round(performance.now() - started) + " ms" + (cwu !== undefined ? " · " + cwu + " CWU" : ""));
    } catch (e) { setOut("⚠️ " + (e instanceof Error ? e.message : String(e))); }
    finally { setBusy(false); }
  }
  return <section className="api-card">
    <h3><FlaskConical size={17}/>{t("在线调试")}</h3>
    <p className="api-muted">{t("粘贴一个 API 密钥，直接从浏览器调用接口。密钥只在这个页面里使用，不会被保存。")}</p>
    <div className="api-form">
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ciro_sk_..." aria-label={t("API 密钥")} autoComplete="off"/>
      <select value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("模型")}>
        {models.map((m) => <option key={m} value={m}>{m}</option>)}</select>
      <label className="api-check"><input type="checkbox" checked={stream} onChange={(e) => setStream(e.target.checked)}/> {t("流式输出")}</label>
    </div>
    <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} aria-label={t("测试消息")}/>
    <button type="button" className="api-run" disabled={busy || !key.trim().startsWith("ciro_sk_") || !prompt.trim()} onClick={() => void run()}><Play size={15}/>{busy ? t("请求中…") : t("发送请求")}</button>
    {(out || meta) && <div className="api-out" aria-live="polite"><pre>{out}</pre>{meta && <small>{meta}</small>}</div>}
  </section>;
}

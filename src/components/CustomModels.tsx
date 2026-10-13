import { useState } from "react";
import { Check, KeyRound, Plus, Trash2, Wifi } from "lucide-react";
import { CUSTOM_PREFIX, MODEL_PRESETS, loadCustomModels, normalizeBaseUrl, saveCustomModels, streamCustom } from "../lib/custom-models";
import type { CustomModel, ModelApi } from "../lib/custom-models";

/** Settings → 模型设置 → 我的模型: add any model by API (Claude, GPT, Gemini, DeepSeek, 通义, Kimi, 智谱, Grok, Ollama…). */
export default function CustomModels({ t, current, onUse }: { t: (s: string) => string; current: string; onUse: (id: string) => void }) {
  const [list, setList] = useState<CustomModel[]>(loadCustomModels);
  const blank = { name: "", baseUrl: "", apiKey: "", model: "", api: "openai" as ModelApi };
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState("");
  const save = (next: CustomModel[]) => { setList(next); saveCustomModels(next); };
  const preset = (id: string) => {
    const p = MODEL_PRESETS.find((x) => x.id === id);
    if (p) setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: form.apiKey, model: p.model, api: p.api || "openai" });
  };
  function add() {
    setNote(null);
    let baseUrl: string;
    try { baseUrl = normalizeBaseUrl(form.baseUrl); } catch { setNote({ ok: false, text: t("接口地址格式不对，例如 https://api.deepseek.com/v1") }); return; }
    if (!form.model.trim()) { setNote({ ok: false, text: t("请填写模型名") }); return; }
    const m: CustomModel = { id: Math.random().toString(36).slice(2, 10), name: form.name.trim() || form.model.trim(), baseUrl, apiKey: form.apiKey.trim(), model: form.model.trim(), api: form.api };
    save([...list, m]);
    setForm(blank); setAdding(false);
    onUse(CUSTOM_PREFIX + m.id);
    void test(m);
  }
  async function test(m: CustomModel) {
    setTesting(m.id); setNote(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    let got = "";
    try {
      await streamCustom(m, { messages: [{ id: "t", role: "user", content: "Reply with: OK", createdAt: Date.now() }], signal: controller.signal, onDelta: (x) => { got += x; } });
      setNote(got.trim() ? { ok: true, text: t("「") + m.name + t("」可以用了。") } : { ok: false, text: t("连上了，但没有收到回答，请检查模型名。") });
    } catch (e) {
      setNote({ ok: false, text: controller.signal.aborted ? t("等待超时，请检查接口地址。") : e instanceof Error ? e.message : String(e) });
    } finally { window.clearTimeout(timer); setTesting(""); }
  }
  return <div className="cm-root">
    {list.length > 0 && <ul className="cm-list">{list.map((m) => {
      const on = current === CUSTOM_PREFIX + m.id;
      return <li key={m.id} className={on ? "cm-item cm-item--on" : "cm-item"}>
        <KeyRound size={16}/>
        <div><strong>{m.name}</strong><small>{m.model} · {m.baseUrl.replace(/^https?:\/\//, "")}</small></div>
        <button type="button" className="sc-action-secondary" onClick={() => void test(m)} disabled={Boolean(testing)}>
          <Wifi size={14}/> {testing === m.id ? t("测试中…") : t("测试")}</button>
        <button type="button" className="sc-action-secondary" onClick={() => onUse(CUSTOM_PREFIX + m.id)} disabled={on}>
          {on ? <><Check size={14}/> {t("使用中")}</> : t("使用")}</button>
        <button type="button" className="cm-del" aria-label={t("删除") + " " + m.name} onClick={() => { save(list.filter((x) => x.id !== m.id)); if (on) onUse("ciro"); }}><Trash2 size={15}/></button>
      </li>;
    })}</ul>}
    {note && <p className={note.ok ? "cm-note cm-note--ok" : "cm-note"} role="status">{note.text}</p>}
    {!adding ? <button type="button" className="sc-action-secondary cm-add" onClick={() => setAdding(true)}><Plus size={15}/> {t("添加模型")}</button> :
      <div className="cm-form">
        <div className="cm-presets" role="group" aria-label={t("常用服务")}>
          {MODEL_PRESETS.map((p) => <button type="button" key={p.id} onClick={() => preset(p.id)} className={form.name === p.name ? "cm-preset cm-preset--on" : "cm-preset"}>{t(p.name)}</button>)}
        </div>
        <label>{t("名称")}<input className="sc-text-input" value={form.name} placeholder={t("例如：DeepSeek")} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
        <label>{t("接口地址")}<input className="sc-text-input" inputMode="url" autoCapitalize="off" autoCorrect="off" value={form.baseUrl} placeholder="https://api.example.com/v1"
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}/></label>
        <label>{t("API Key")}<input className="sc-text-input" type="password" autoComplete="off" value={form.apiKey} placeholder="sk-…" onChange={(e) => setForm({ ...form, apiKey: e.target.value })}/></label>
        <label>{t("模型名")}<input className="sc-text-input" autoCapitalize="off" autoCorrect="off" value={form.model} placeholder="deepseek-chat" onChange={(e) => setForm({ ...form, model: e.target.value })}/></label>
        <label>{t("接口类型")}<select className="sc-text-input" value={form.api} onChange={(e) => setForm({ ...form, api: e.target.value as ModelApi })}>
          <option value="openai">{t("OpenAI 兼容（大多数服务）")}</option><option value="anthropic">{t("Claude（Anthropic）")}</option></select></label>
        <div className="cm-actions">
          <button type="button" className="sc-action-secondary" onClick={() => { setAdding(false); setForm(blank); setNote(null); }}>{t("取消")}</button>
          <button type="button" className="sc-action-secondary cm-save" onClick={add} disabled={!form.baseUrl.trim() || !form.model.trim()}>{t("添加并测试")}</button>
        </div>
      </div>}
    <p className="sc-help-text">{t("API Key 只保存在这台设备上，对话直接发给对应的服务，不消耗 CWU（费用由该服务按你的账号收取）。")}</p>
  </div>;
}

import { useState } from "react";
import { Check, KeyRound, ListChecks, Pencil, Plus, Trash2, Wifi } from "lucide-react";
import { CUSTOM_PREFIX, MODEL_PRESETS, NEEDS_WORKSPACE, listModels, loadCustomModels, namesFromError, normalizeBaseUrl, saveCustomModels, streamCustom } from "../lib/custom-models";
import type { CustomModel, ModelApi } from "../lib/custom-models";

/** Settings → 模型设置 → 我的模型: add any model by API (Claude, GPT, Gemini, DeepSeek, 通义, Kimi, 智谱, Grok, Ollama…). */
export default function CustomModels({ t, current, onUse }: { t: (s: string) => string; current: string; onUse: (id: string) => void }) {
  const [list, setList] = useState<CustomModel[]>(loadCustomModels);
  const blank = { name: "", baseUrl: "", apiKey: "", model: "", api: "openai" as ModelApi, workspace: "" };
  const [form, setForm] = useState(blank);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState("");
  // Model names the provider offers: picked from a list instead of typed by hand.
  const [names, setNames] = useState<string[]>([]);
  const [loadingNames, setLoadingNames] = useState(false);
  // After a failed test: the right names for that model, one tap to switch.
  const [fix, setFix] = useState<{ id: string; names: string[] } | null>(null);
  // A Claude key outside any workspace: its Workspace ID, typed right under the error.
  const [wsFix, setWsFix] = useState<{ id: string; value: string } | null>(null);
  const save = (next: CustomModel[]) => { setList(next); saveCustomModels(next); };
  const close = () => { setAdding(false); setEditing(""); setForm(blank); setNames([]); };
  const preset = (id: string) => {
    const p = MODEL_PRESETS.find((x) => x.id === id);
    if (p) { setForm({ name: p.name, baseUrl: p.baseUrl, apiKey: form.apiKey, model: p.model, api: p.api || "openai", workspace: "" }); setNames([]); }
  };
  async function fetchNames() {
    let baseUrl: string;
    try { baseUrl = normalizeBaseUrl(form.baseUrl); } catch { setNote({ ok: false, text: t("接口地址格式不对，例如 https://api.deepseek.com/v1") }); return; }
    setLoadingNames(true); setNote(null);
    try {
      const got = await listModels({ baseUrl, apiKey: form.apiKey.trim(), api: form.api, workspace: form.workspace });
      setNames(got);
      if (!got.length) setNote({ ok: false, text: t("这个服务没有提供模型列表，请手动填写模型名。") });
      else if (!got.includes(form.model.trim())) setForm((f) => ({ ...f, model: got[0] }));
    } catch { setNote({ ok: false, text: t("获取失败，请检查接口地址和 API Key。") }); }
    finally { setLoadingNames(false); }
  }
  function submit() {
    setNote(null);
    let baseUrl: string;
    try { baseUrl = normalizeBaseUrl(form.baseUrl); } catch { setNote({ ok: false, text: t("接口地址格式不对，例如 https://api.deepseek.com/v1") }); return; }
    if (!form.model.trim()) { setNote({ ok: false, text: t("请填写模型名") }); return; }
    const m: CustomModel = { id: editing || Math.random().toString(36).slice(2, 10), name: form.name.trim() || form.model.trim(), baseUrl,
      apiKey: form.apiKey.trim(), model: form.model.trim(), api: form.api, ...(form.api === "anthropic" && form.workspace.trim() ? { workspace: form.workspace.trim() } : {}) };
    save(editing ? list.map((x) => x.id === editing ? m : x) : [...list, m]);
    close();
    // A new model is picked right away; editing one keeps whatever model the chat uses.
    if (!editing || current === CUSTOM_PREFIX + m.id) onUse(CUSTOM_PREFIX + m.id);
    void test(m);
  }
  function edit(m: CustomModel) {
    setEditing(m.id); setAdding(true); setNote(null); setFix(null); setNames([]);
    setForm({ name: m.name, baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.model, api: m.api || "openai", workspace: m.workspace || "" });
  }
  function useName(m: CustomModel, model: string) {
    const next = { ...m, model };
    save(list.map((x) => x.id === m.id ? next : x));
    setFix(null);
    void test(next);
  }
  async function test(m: CustomModel) {
    setTesting(m.id); setNote(null); setFix(null); setWsFix(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    let got = "";
    try {
      await streamCustom(m, { messages: [{ id: "t", role: "user", content: "Reply with: OK", createdAt: Date.now() }], signal: controller.signal, onDelta: (x) => { got += x; } });
      setNote(got.trim() ? { ok: true, text: t("「") + m.name + t("」可以用了。") } : { ok: false, text: t("连上了，但没有收到回答，请检查模型名。") });
    } catch (e) {
      const text = controller.signal.aborted ? t("等待超时，请检查接口地址。") : e instanceof Error ? e.message : String(e);
      setNote({ ok: false, text });
      if (text.includes(NEEDS_WORKSPACE)) { setWsFix({ id: m.id, value: m.workspace || "" }); return; }
      // A wrong model name: offer the ones the provider accepts.
      if (!controller.signal.aborted && /model|模型|400|404/i.test(text)) {
        let options = namesFromError(text);
        if (!options.length) options = await listModels(m, controller.signal).catch(() => []);
        options = options.filter((x) => x !== m.model).slice(0, 12);
        if (options.length) setFix({ id: m.id, names: options });
      }
    } finally { window.clearTimeout(timer); setTesting(""); }
  }
  return <div className="cm-root">
    {list.length > 0 && <ul className="cm-list">{list.map((m) => {
      const on = current === CUSTOM_PREFIX + m.id;
      return <li key={m.id} className={on ? "cm-item cm-item--on" : "cm-item"}>
        <div className="cm-head"><KeyRound size={16}/>
          <div><strong>{m.name}</strong><small>{m.model} · {m.baseUrl.replace(/^https?:\/\//, "")}</small></div></div>
        <div className="cm-buttons">
          <button type="button" className="sc-action-secondary" onClick={() => void test(m)} disabled={Boolean(testing)}>
            <Wifi size={14}/> {testing === m.id ? t("测试中…") : t("测试")}</button>
          <button type="button" className="sc-action-secondary" onClick={() => edit(m)}><Pencil size={14}/> {t("编辑")}</button>
          <button type="button" className="sc-action-secondary" onClick={() => onUse(CUSTOM_PREFIX + m.id)} disabled={on}>
            {on ? <><Check size={14}/> {t("使用中")}</> : t("使用")}</button>
          <button type="button" className="cm-del" aria-label={t("删除") + " " + m.name} onClick={() => { save(list.filter((x) => x.id !== m.id)); if (on) onUse("ciro"); }}><Trash2 size={15}/></button>
        </div>
      </li>;
    })}</ul>}
    {note && <p className={note.ok ? "cm-note cm-note--ok" : "cm-note"} role="status">{note.text}</p>}
    {fix && (() => { const m = list.find((x) => x.id === fix.id); return m ? <div className="cm-fix">
      <span>{t("模型名可能填错了，这个服务可用的模型：")}</span>
      <div className="cm-presets">{fix.names.map((n) => <button type="button" key={n} className="cm-preset" onClick={() => useName(m, n)}>{n}</button>)}</div>
    </div> : null; })()}
    {wsFix && (() => { const m = list.find((x) => x.id === wsFix.id); return m ? <div className="cm-fix">
      <label>{t("Workspace ID")}<input className="sc-text-input" autoCapitalize="off" autoCorrect="off" value={wsFix.value} placeholder="wrkspc_…"
        onChange={(e) => setWsFix({ ...wsFix, value: e.target.value })}/></label>
      <button type="button" className="sc-action-secondary cm-save" disabled={!wsFix.value.trim()} onClick={() => {
        const next = { ...m, workspace: wsFix.value.trim() };
        save(list.map((x) => x.id === m.id ? next : x)); setWsFix(null); void test(next);
      }}>{t("保存并测试")}</button>
    </div> : null; })()}
    {!adding ? <button type="button" className="sc-action-secondary cm-add" onClick={() => { setAdding(true); setNote(null); setFix(null); }}><Plus size={15}/> {t("添加模型")}</button> :
      <div className="cm-form">
        {!editing && <div className="cm-presets" role="group" aria-label={t("常用服务")}>
          {MODEL_PRESETS.map((p) => <button type="button" key={p.id} onClick={() => preset(p.id)} className={form.name === p.name ? "cm-preset cm-preset--on" : "cm-preset"}>{t(p.name)}</button>)}
        </div>}
        <label>{t("名称")}<input className="sc-text-input" value={form.name} placeholder={t("例如：DeepSeek")} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label>
        <label>{t("接口地址")}<input className="sc-text-input" inputMode="url" autoCapitalize="off" autoCorrect="off" value={form.baseUrl} placeholder="https://api.example.com/v1"
          onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}/></label>
        <label>{t("API Key")}<input className="sc-text-input" type="password" autoComplete="off" value={form.apiKey} placeholder="sk-…" onChange={(e) => setForm({ ...form, apiKey: e.target.value })}/></label>
        <label>{t("模型名")}
          <span className="cm-model-row">
            {names.length > 0
              ? <select className="sc-text-input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}>
                  {!names.includes(form.model) && form.model && <option value={form.model}>{form.model}</option>}
                  {names.map((n) => <option key={n} value={n}>{n}</option>)}</select>
              : <input className="sc-text-input" autoCapitalize="off" autoCorrect="off" value={form.model} placeholder="deepseek-flash" onChange={(e) => setForm({ ...form, model: e.target.value })}/>}
            <button type="button" className="sc-action-secondary" onClick={() => void fetchNames()} disabled={loadingNames || !form.baseUrl.trim()}>
              <ListChecks size={14}/> {loadingNames ? t("获取中…") : t("获取模型列表")}</button>
          </span></label>
        <label>{t("接口类型")}<select className="sc-text-input" value={form.api} onChange={(e) => setForm({ ...form, api: e.target.value as ModelApi })}>
          <option value="openai">{t("OpenAI 兼容（大多数服务）")}</option><option value="anthropic">{t("Claude（Anthropic）")}</option></select></label>
        {form.api === "anthropic" && <label>{t("Workspace ID（可选）")}<input className="sc-text-input" autoCapitalize="off" autoCorrect="off" value={form.workspace}
          placeholder="wrkspc_…" onChange={(e) => setForm({ ...form, workspace: e.target.value })}/></label>}
        <div className="cm-actions">
          <button type="button" className="sc-action-secondary" onClick={() => { close(); setNote(null); }}>{t("取消")}</button>
          <button type="button" className="sc-action-secondary cm-save" onClick={submit} disabled={!form.baseUrl.trim() || !form.model.trim()}>{t(editing ? "保存并测试" : "添加并测试")}</button>
        </div>
      </div>}
    <p className="sc-help-text">{t("API Key 只保存在这台设备上，对话直接发给对应的服务，不消耗 CWU（费用由该服务按你的账号收取）。")}</p>
  </div>;
}

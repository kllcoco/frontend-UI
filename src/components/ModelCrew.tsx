import { useEffect, useRef, useState } from "react";
import { Check, Copy, Crown, Play, Square, Users } from "lucide-react";
import Markdown from "./Markdown";
import { crewModels, loadCrewRuns, runCrew, saveCrewRun } from "../lib/crew";
import type { CrewMember, CrewRun, CrewStage } from "../lib/crew";
import { petEnabled, petProgress } from "../lib/pet";

type Out = Record<CrewStage, Record<string, { text: string; error?: string; done?: boolean }>>;
const empty = (): Out => ({ draft: {}, review: {}, final: {} });

/** 协作空间 → 多模型协作: all connected models (Ciro's and 我的模型) work on one task — drafts in parallel, a review
 *  round, then the lead model writes the final result. */
export default function ModelCrew({ t, language, status, onAddModel }: { t: (s: string) => string; language: string;
  status: { configured: boolean; models: string[] }; onAddModel?: () => void }) {
  const [all, setAll] = useState<CrewMember[]>(() => crewModels(status));
  useEffect(() => {
    const again = () => setAll(crewModels(status));
    again();
    window.addEventListener("ciro-custom-models", again);
    return () => window.removeEventListener("ciro-custom-models", again);
  }, [status.configured, status.models.join(",")]);
  // Nothing is picked up front: the user chooses which connected models work on this task (the last choice is remembered).
  const PICK = "ciro.crew-picked.v1";
  const [picked, setPicked] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(PICK) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } });
  useEffect(() => { const ids = all.map((m) => m.id); setPicked((p) => p.filter((x) => ids.includes(x))); }, [all]);
  useEffect(() => { try { localStorage.setItem(PICK, JSON.stringify(picked)); } catch { /* storage off */ } }, [picked]);
  const [lead, setLead] = useState("");
  const [review, setReview] = useState(true);
  const [task, setTask] = useState("");
  const [stage, setStage] = useState<CrewStage | "">("");
  const [out, setOut] = useState<Out>(empty);
  const [runs, setRuns] = useState<CrewRun[]>(loadCrewRuns);
  const [shown, setShown] = useState<CrewRun | null>(null);
  const [copied, setCopied] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const members = all.filter((m) => picked.includes(m.id));
  const leadId = members.some((m) => m.id === lead) ? lead : members[0]?.id || "";
  const name = (id: string) => all.find((m) => m.id === id)?.name || shown?.members.find((m) => m.id === id)?.name || id;
  const busy = Boolean(stage);
  const STAGES: Record<CrewStage, string> = { draft: t("各自作答"), review: t("互相评审"), final: t("主笔汇总") };

  async function start() {
    if (!task.trim() || !members.length || busy) return;
    const c = new AbortController(); ctrl.current = c;
    setOut(empty()); setShown(null); setStage("draft");
    const pet = petEnabled();
    try {
      const run = await runCrew({ task: task.trim(), members, lead: leadId, review, language, signal: c.signal, onEvent: (e) => {
        if (e.kind === "stage") { setStage(e.stage); if (pet) petProgress({ text: t("多模型协作：") + STAGES[e.stage], source: "work" }); return; }
        setOut((o) => ({ ...o, [e.stage]: { ...o[e.stage], [e.member]: { text: e.text, error: e.kind === "done" ? e.error : undefined, done: e.kind === "done" } } }));
      } });
      saveCrewRun(run); setRuns(loadCrewRuns());
      if (pet) petProgress({ text: run.outputs.final[run.lead]?.text ? t("多模型协作完成了") : t("多模型协作没有完成"), done: true, ok: Boolean(run.outputs.final[run.lead]?.text), source: "work" });
    } catch { /* stopped */ }
    finally { setStage(""); ctrl.current = null; }
  }
  const view: Out = shown ? shown.outputs : out;
  const finalId = shown ? shown.lead : Object.keys(out.final)[0];
  const finalText = finalId ? view.final[finalId]?.text || "" : "";

  if (!all.length) return <section className="crew-root">
    <div className="crew-empty"><Users size={26}/><h3>{t("还没有可用的模型")}</h3>
      <p>{t("在 设置 → 模型设置 → 我的模型 里用 API 接入 GPT、Claude、Gemini、DeepSeek 等，接入两个以上就能让它们一起工作。")}</p>
      {onAddModel && <button type="button" className="cx-btn" onClick={onAddModel}>{t("去添加模型")}</button>}</div></section>;

  return <section className="crew-root">
    <header className="crew-head"><Users size={20}/><div><h3>{t("多模型协作")}</h3>
      <p>{t("所有已接入的模型一起完成同一个任务：先各自作答，再互相评审改进，最后由主笔模型汇总出最终结果。")}</p></div></header>
    <div className="crew-form">
      <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={3} placeholder={t("描述要一起完成的任务，例如：为新产品写一份上线方案")} aria-label={t("协作任务")} disabled={busy}/>
      <div className="crew-pick-head"><span>{t("选择本次参与的模型")}（{members.length}/{all.length}）</span>
        <button type="button" className="crew-link" disabled={busy} onClick={() => setPicked(members.length === all.length ? [] : all.map((m) => m.id))}>{t(members.length === all.length ? "全不选" : "全选")}</button></div>
      <div className="crew-members" role="group" aria-label={t("参与的模型")}>
        {all.map((m) => { const on = picked.includes(m.id); return <button type="button" key={m.id} disabled={busy} aria-pressed={on}
          className={on ? "crew-chip crew-chip--on" : "crew-chip"} onClick={() => setPicked((p) => on ? p.filter((x) => x !== m.id) : [...p, m.id])}>
          {on && <Check size={13}/>}{m.name}{m.id === leadId && <Crown size={13} aria-label={t("主笔")}/>}</button>; })}
      </div>
      <div className="crew-opts">
        <label>{t("主笔")}<select value={leadId} onChange={(e) => setLead(e.target.value)} disabled={busy || members.length < 2}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="crew-check"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} disabled={busy}/>{t("互相评审一轮")}</label>
        {busy ? <button type="button" className="cx-btn" onClick={() => ctrl.current?.abort()}><Square size={14}/>{t("停止")}</button>
          : <button type="button" className="cx-btn cx-btn--primary crew-go" onClick={() => void start()} disabled={!task.trim() || !members.length}><Play size={14}/>{t("开始协作")}</button>}
      </div>
      {members.length === 0 && <p className="crew-note">{t("先在上面点选要一起干活的模型。")}</p>}
      {members.length === 1 && <p className="crew-note">{t("只选了一个模型；接入或选择两个以上，才能互相评审。")}</p>}
      <p className="crew-note">{t("Ciro 官方模型按 CWU 计费；我的模型直接调用对应服务，不消耗 CWU。")}</p>
    </div>
    {busy && <ol className="crew-steps">{(["draft", ...(review && members.length > 1 ? ["review"] : []), "final"] as CrewStage[]).map((s) =>
      <li key={s} className={s === stage ? "crew-step--on" : ""}>{STAGES[s]}</li>)}</ol>}
    {finalText && <article className="crew-final"><h4><Crown size={15}/>{t("最终结果")} · {name(finalId)}
      <button type="button" className="crew-copy" onClick={() => { void navigator.clipboard?.writeText(finalText); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <Check size={14}/> : <Copy size={14}/>}{t(copied ? "已复制" : "复制")}</button></h4>
      <div className="message-prose"><Markdown text={finalText} copyLabel={t("复制")} copiedLabel={t("已复制")} t={t}/></div></article>}
    {(["review", "draft"] as CrewStage[]).map((s) => Object.keys(view[s]).length > 0 && <details key={s} className="crew-stage" open={!finalText}>
      <summary>{STAGES[s]}（{Object.keys(view[s]).length}）</summary>
      <div className="crew-cards">{Object.entries(view[s]).map(([id, o]) => <article key={id} className="crew-card">
        <h5>{name(id)}{!("done" in o) || o.done ? null : <span className="crew-live">{t("输出中…")}</span>}</h5>
        {o.error ? <p className="crew-error">{o.error}</p> : <div className="message-prose"><Markdown text={o.text || "…"} copyLabel={t("复制")} copiedLabel={t("已复制")} t={t}/></div>}
      </article>)}</div></details>)}
    {runs.length > 0 && !busy && <div className="crew-history"><h4>{t("最近的协作")}</h4>
      <ul>{runs.map((r) => <li key={r.id}><button type="button" className={shown?.id === r.id ? "crew-run crew-run--on" : "crew-run"} onClick={() => { setShown(r); setTask(r.task); }}>
        <strong>{r.task.slice(0, 60)}</strong><small>{new Date(r.at).toLocaleString(language === "en" ? "en" : "zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {r.members.map((m) => m.name).join("、")}</small></button></li>)}</ul></div>}
  </section>;
}

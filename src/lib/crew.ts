/* 多模型协作 (协作空间): every connected model works on the same task together — the Ciro service's models and the
   user's own API models (我的模型). Three stages: each model drafts its own answer in parallel; optionally a review
   round where each sees the others' drafts and improves its own; then a lead model merges everything into the final
   result. All calls go through streamChat, so server models are billed in CWU and own models go straight to their
   provider from this device. */
import { streamChat } from "./api";
import { CUSTOM_PREFIX, loadCustomModels } from "./custom-models";

export type CrewMember = { id: string; name: string };
export type CrewStage = "draft" | "review" | "final";
export type CrewEvent =
  | { kind: "stage"; stage: CrewStage }
  | { kind: "delta"; stage: CrewStage; member: string; text: string }
  | { kind: "done"; stage: CrewStage; member: string; text: string; error?: string };
export type CrewRun = { id: string; task: string; at: number; members: CrewMember[]; lead: string; review: boolean;
  outputs: Record<CrewStage, Record<string, { text: string; error?: string }>> };

/** Every model this client can talk to: the server's (when configured) and the user's own. */
export function crewModels(server: { configured: boolean; models: string[] }): CrewMember[] {
  const list: CrewMember[] = server.configured ? server.models.map((id) => ({ id, name: id === "ciro" ? "Ciro" : id })) : [];
  for (const m of loadCustomModels()) list.push({ id: CUSTOM_PREFIX + m.id, name: m.name });
  return list;
}

const KEY = "ciro.crew-runs.v1";
export function loadCrewRuns(): CrewRun[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
export function saveCrewRun(run: CrewRun): void {
  try { localStorage.setItem(KEY, JSON.stringify([run, ...loadCrewRuns().filter((r) => r.id !== run.id)].slice(0, 20))); } catch { /* storage full */ }
}

const clip = (s: string, n: number) => s.length > n ? s.slice(0, n) + "\n…（已截断）" : s;

function ask(model: string, prompt: string, signal: AbortSignal, onDelta: (text: string) => void): Promise<string> {
  let out = "";
  return streamChat({ model, signal, usageKind: "chat", messages: [{ id: "crew", role: "user", content: prompt, createdAt: Date.now() }],
    onDelta: (x) => { out += x; onDelta(out); } }).then(() => out.trim());
}

/** Runs the whole collaboration; events stream to the page. Members that fail are left out of later stages. */
export async function runCrew(opts: { task: string; members: CrewMember[]; lead: string; review: boolean; language: string;
  signal: AbortSignal; onEvent: (e: CrewEvent) => void }): Promise<CrewRun> {
  const { task, members, lead, review, signal, onEvent } = opts;
  const zh = opts.language !== "en";
  const run: CrewRun = { id: Math.random().toString(36).slice(2, 10), task, at: Date.now(), members, lead, review, outputs: { draft: {}, review: {}, final: {} } };
  const name = (id: string) => members.find((m) => m.id === id)?.name || id;
  const stage = async (s: CrewStage, who: CrewMember[], prompt: (m: CrewMember) => string) => {
    onEvent({ kind: "stage", stage: s });
    await Promise.all(who.map(async (m) => {
      try {
        const text = await ask(m.id, prompt(m), signal, (t) => onEvent({ kind: "delta", stage: s, member: m.id, text: t }));
        run.outputs[s][m.id] = { text };
        onEvent({ kind: "done", stage: s, member: m.id, text });
      } catch (e) {
        if (signal.aborted) throw e;
        const error = e instanceof Error ? e.message : String(e);
        run.outputs[s][m.id] = { text: "", error };
        onEvent({ kind: "done", stage: s, member: m.id, text: "", error });
      }
    }));
  };
  const ok = (s: CrewStage) => members.filter((m) => run.outputs[s][m.id]?.text);

  await stage("draft", members, (m) => zh
    ? `你是多模型协作小组的成员「${m.name}」，小组成员：${members.map((x) => x.name).join("、")}。\n请独立完成下面的任务，给出你最好的答案或方案，结构清晰。\n\n任务：${task}`
    : `You are "${m.name}", a member of a multi-model team (${members.map((x) => x.name).join(", ")}).\nComplete the task below on your own and give your best answer or plan, clearly structured.\n\nTask: ${task}`);
  let latest: CrewStage = "draft";
  const drafted = ok("draft");
  if (review && drafted.length >= 2) {
    await stage("review", drafted, (m) => {
      const others = drafted.filter((x) => x.id !== m.id).map((x) => `【${x.name}】\n${clip(run.outputs.draft[x.id].text, 6000)}`).join("\n\n");
      return zh
        ? `任务：${task}\n\n你（${m.name}）之前的答案：\n${clip(run.outputs.draft[m.id].text, 6000)}\n\n其他成员的答案：\n${others}\n\n请指出各答案的问题与可取之处（简短），然后给出你改进后的完整答案。`
        : `Task: ${task}\n\nYour (${m.name}) earlier answer:\n${clip(run.outputs.draft[m.id].text, 6000)}\n\nThe other members' answers:\n${others}\n\nBriefly note problems and strengths in each, then give your improved complete answer.`;
    });
    if (ok("review").length) latest = "review";
  }
  const pool = ok(latest).length ? ok(latest) : drafted;
  if (!pool.length) return run;
  const leader = pool.some((m) => m.id === lead) ? lead : pool[0].id;
  run.lead = leader;
  const all = pool.map((x) => `【${x.name}】\n${clip(run.outputs[latest][x.id].text, 8000)}`).join("\n\n");
  await stage("final", [{ id: leader, name: name(leader) }], () => zh
    ? `你是多模型协作小组的主笔。任务：${task}\n\n各成员的答案：\n${all}\n\n请综合所有成员的长处，纠正错误，给出最终的完整结果。最后用一两句话说明采纳了哪些成员的哪些观点。`
    : `You lead a multi-model team. Task: ${task}\n\nThe members' answers:\n${all}\n\nMerge their strengths, fix mistakes and give the final complete result. End with one or two sentences on which members' points you adopted.`);
  return run;
}

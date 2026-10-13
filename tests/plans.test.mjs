import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanService, loadPlans, meterOf, sseMeter } from "../server/plans.mjs";

const PLANS = JSON.stringify([
  { id: "basic", name: "基础版", monthlyCwu: 1000, price: "¥19 / 月", features: ["日常对话"] },
  { id: "pro", name: "专业版", monthlyCwu: 10000, monthlyGwu: 50 },
  { id: "max", name: "旗舰版", monthlyCwu: null }
]);

test("unconfigured: three plan slots, nothing limited", () => {
  const dir = mkdtempSync(join(tmpdir(), "plans-"));
  try {
    assert.deepEqual(loadPlans({}).map((p) => p.id), ["basic", "pro", "max"]);
    const s = createPlanService({ dir, env: {} });
    s.record("u", { cwu: 1e9, gwu: 0 });
    assert.equal(s.admit("u"), null);
    const sum = s.summary("u");
    assert.equal(sum.current, null);
    assert.equal(sum.allowance.cwu, null);
    assert.ok(sum.plans.every((p) => p.monthlyCwu === null));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("monthly CWU allowance is counted per user, persists, blocks when used up and resets next month", () => {
  const dir = mkdtempSync(join(tmpdir(), "plans-"));
  let now = new Date("2026-10-20T10:00:00Z");
  try {
    const env = { CIRO_PLANS: PLANS, CIRO_PLAN: "basic" };
    const s = createPlanService({ dir, env, now: () => now });
    s.record("alice", { cwu: 600, gwu: 0 });
    assert.equal(s.admit("alice"), null);
    s.record("alice", { cwu: 400, gwu: 0 });
    assert.equal(s.admit("alice"), "cwu");
    assert.equal(s.admit("bob"), null, "other users have their own allowance");
    const sum = s.summary("alice");
    assert.deepEqual([sum.used.cwu, sum.remaining.cwu, sum.allowance.cwu, sum.exhausted], [1000, 0, 1000, true]);
    assert.equal(sum.period.resetsAt, "2026-11-01T00:00:00.000Z");
    // Persisted across restarts.
    const again = createPlanService({ dir, env, now: () => now });
    assert.equal(again.summary("alice").used.cwu, 1000);
    now = new Date("2026-11-01T00:00:01Z");
    assert.equal(again.admit("alice"), null);
    assert.equal(again.summary("alice").used.cwu, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("GWU allowance and config validation", () => {
  const dir = mkdtempSync(join(tmpdir(), "plans-"));
  try {
    const s = createPlanService({ dir, env: { CIRO_PLANS: PLANS, CIRO_PLAN: "pro" } });
    s.record("u", { cwu: 10, gwu: 50 });
    assert.equal(s.admit("u"), "gwu");
    assert.throws(() => createPlanService({ dir, env: { CIRO_PLANS: PLANS, CIRO_PLAN: "gold" } }), /CIRO_PLAN/);
    assert.throws(() => loadPlans({ CIRO_PLANS: "{oops" }), /valid JSON/);
    assert.throws(() => loadPlans({ CIRO_PLANS: JSON.stringify([{ id: "a" }, { id: "a" }]) }), /duplicate/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("metering is read from usage fields, signed receipts and split SSE chunks — never from tokens", () => {
  assert.deepEqual(meterOf({ usage: { cwu: 12, total_tokens: 999 } }), { cwu: 12, gwu: 0 });
  assert.equal(meterOf({ usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), null);
  assert.deepEqual(meterOf({ receipts: [{ unit: "CWU", units: 5 }, { unit: "GWU", units: "2" }, { unit: "CWU", units: 1 }] }), { cwu: 6, gwu: 2 });
  const m = sseMeter();
  const body = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"choices":[],"usage":{"cwu":77}}\n\ndata: [DONE]\n\n';
  for (let i = 0; i < body.length; i += 7) m.push(Buffer.from(body.slice(i, i + 7)));
  assert.deepEqual(m.result(), { cwu: 77, gwu: 0 });
});

/* Plan and monthly CWU/GWU allowance, as counted by the Ciro server from native metering. */
import { accountFetch, readApiJson } from "./account-api";

export type Plan = { id: string; name: string; nameEn: string | null; monthlyCwu: number | null; monthlyGwu: number | null; price: string | null; features: string[] };
export type PlanSummary = {
  plans: Plan[]; current: string | null;
  period: { key: string; start: string; resetsAt: string };
  used: { cwu: number; gwu: number; calls: number };
  allowance: { cwu: number | null; gwu: number | null };
  remaining: { cwu: number | null; gwu: number | null };
  exhausted: boolean;
};

export async function loadPlan(): Promise<PlanSummary> {
  return readApiJson<PlanSummary>(await accountFetch("/api/plan"), "无法读取套餐信息");
}

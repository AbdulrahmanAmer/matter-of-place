import { agentCollected, agentTarget, runAgentCli } from "./collectors/ours.mjs";

// GG-03: B11's weekly KPIs as `collectWeeklyKpis` returns them, from `GET /api/admin/audit/kpis` with the agent key.

/**
 * @param {import("./common.mjs").Context} ctx
 * @param {import("./collectors/ours.mjs").AgentTarget} [target]
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export const collect = (ctx, target = agentTarget(ctx)) =>
  agentCollected(ctx, target, "/api/admin/audit/kpis", "kpis");

await runAgentCli(import.meta.url, collect);

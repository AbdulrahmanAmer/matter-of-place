import { agentCollected, agentTarget, runAgentCli } from "./collectors/ours.mjs";

// GG-02: the paths that answered 404 in the last 7 days, from `GET /api/admin/audit/notfound` with the agent key.

/**
 * @param {import("./common.mjs").Context} ctx
 * @param {import("./collectors/ours.mjs").AgentTarget} [target]
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export const collect = (ctx, target = agentTarget(ctx)) =>
  agentCollected(ctx, target, "/api/admin/audit/notfound?days=7", "not_found");

await runAgentCli(import.meta.url, collect);

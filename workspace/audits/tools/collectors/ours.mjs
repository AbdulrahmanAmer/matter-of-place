import { parseArgs } from "node:util";
import {
  field,
  getJson,
  isMain,
  makeContext,
  measured,
  notMeasured,
  numeric,
  recordsOf,
} from "../common.mjs";

/**
 * One gauge line read from a source: the used amount, or why it could not be read. `usage.mjs` adds the limit,
 * the unit and the status from `limits.json` (invariant 7), so no collector holds a limit.
 * @typedef {{ line: string, used: number, detail?: import("../common.mjs").Json } | { line: string, error: string }} Reading
 * @typedef {{ baseUrl: string, keyName: string, key: string }} AgentTarget our own admin API and the agent key for it
 */

/** `cf:preview` against mop-dev, the `--env dev` target (F14). */
export const DEV_BASE_URL = "http://127.0.0.1:8788";
const USAGE_PATH = "/api/admin/audit/usage";

/**
 * `--env prod` reads `SITE_URL` (the context's `siteUrl`) and `AUDIT_AGENT_KEY`; `--env dev` reads `AUDIT_AGENT_KEY_DEV`.
 * @param {import("../common.mjs").Context} ctx
 * @param {"dev" | "prod"} [envName]
 * @returns {AgentTarget}
 */
export function agentTarget(ctx, envName = "prod") {
  const keyName = envName === "dev" ? "AUDIT_AGENT_KEY_DEV" : "AUDIT_AGENT_KEY";
  return {
    baseUrl: ctx.siteUrl.replace(/\/+$/, ""),
    keyName,
    key: ctx.env[keyName] ?? "",
  };
}

/**
 * The command line of `usage.mjs`, `notfound.mjs` and `kpis.mjs`: `--env dev|prod` (default prod) and `--url`, which
 * replaces the base URL (a lane's own preview port).
 * @param {string[]} [argv]
 * @returns {{ ctx: import("../common.mjs").Context, target: AgentTarget }}
 */
export function agentCli(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: { env: { type: "string" }, url: { type: "string" } },
  });
  const envName = values.env === "dev" ? "dev" : "prod";
  const base = makeContext();
  const siteUrl = values.url ?? (envName === "dev" ? DEV_BASE_URL : base.siteUrl);
  const ctx = makeContext({ siteUrl });
  return { ctx, target: agentTarget(ctx, envName) };
}

/**
 * A GET of our own admin API with the agent key. It never throws: an unset key, a refused connection or a non-200
 * answer is the reason.
 * @param {import("../common.mjs").Context} ctx
 * @param {AgentTarget} target
 * @param {string} path
 * @returns {Promise<{ json: unknown } | { reason: string }>}
 */
export async function agentGet(ctx, target, path) {
  if (target.key === "") return { reason: `${target.keyName} unset` };
  if (target.baseUrl === "") return { reason: "SITE_URL unset" };
  const answer = await getJson(ctx.fetchImpl, `${target.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${target.key}` },
  });
  return answer.status === 200 ? { json: answer.json } : { reason: answer.reason };
}

/** The numbers of `audit_usage()` and the gauge line each one fills. */
const OURS = [
  ["db_bytes", "db_bytes"],
  ["storage_bytes", "storage_bytes"],
  ["email_sent_today", "email_sent_today"],
  ["email_sent_month", "email_sent_month"],
  ["resend_contacts", "subscribers_confirmed"],
  ["reels_month", "reels_month"],
];
const LINES = [...OURS.map(([line]) => line ?? ""), "caption_tokens"];

/**
 * The `caption_tokens` line (G2, ruling H34): input and output tokens per model, no price.
 * @param {unknown} models `model_usage_month`
 * @returns {Reading}
 */
function captionTokens(models) {
  const rows = recordsOf(models).map((row) => ({
    model: String(row["model"]),
    input_tokens: numeric(row["input_tokens"]) ?? 0,
    output_tokens: numeric(row["output_tokens"]) ?? 0,
    jobs: numeric(row["jobs"]) ?? 0,
  }));
  if (rows.length === 0) {
    return {
      line: "caption_tokens",
      error: "not_measured: no done write_captions job this month",
    };
  }
  const used = rows.reduce((sum, row) => sum + row.input_tokens + row.output_tokens, 0);
  return { line: "caption_tokens", used, detail: rows };
}

/**
 * Our own database's lines, through `GET /api/admin/audit/usage` with the agent key.
 * @param {import("../common.mjs").Context} ctx
 * @param {AgentTarget} [target]
 * @returns {Promise<Reading[]>}
 */
export async function collect(ctx, target = agentTarget(ctx)) {
  const answer = await agentGet(ctx, target, USAGE_PATH);
  if ("reason" in answer) {
    return LINES.map((line) => ({
      line,
      error: `not_measured: ${answer.reason}`,
    }));
  }
  /** @type {Reading[]} */
  const readings = OURS.map(([line = "", key = ""]) => {
    const used = numeric(field(answer.json, key));
    return used === null
      ? { line, error: `not_measured: ${key} absent from audit/usage` }
      : { line, used };
  });
  return [...readings, captionTokens(field(answer.json, "model_usage_month"))];
}

/**
 * One sidecar key read from our own admin API: the answer as it came, or `not_measured` with the reason (GG-02,
 * GG-03: a failed KPI read is never shown as zeros).
 * @param {import("../common.mjs").Context} ctx
 * @param {AgentTarget} target
 * @param {string} path
 * @param {string} key
 * @returns {Promise<import("../common.mjs").Collected>}
 */
export async function agentCollected(ctx, target, path, key) {
  const answer = await agentGet(ctx, target, path);
  return {
    [key]:
      "reason" in answer
        ? notMeasured(answer.reason)
        : measured(/** @type {import("../common.mjs").Json} */ (answer.json)),
  };
}

/**
 * The command line of a tool that reads one key from our own admin API.
 * @param {string} metaUrl
 * @param {(ctx: import("../common.mjs").Context, target: AgentTarget) => Promise<import("../common.mjs").Collected>} collectKey
 * @returns {Promise<void>}
 */
export async function runAgentCli(metaUrl, collectKey) {
  if (!isMain(metaUrl)) return;
  const { ctx, target } = agentCli();
  const collected = await collectKey(ctx, target);
  for (const [key, outcome] of Object.entries(collected)) {
    process.stdout.write(
      "notMeasured" in outcome
        ? `Not measured: ${key} (${outcome.notMeasured})\n`
        : `${key}: ${JSON.stringify(outcome.value)}\n`,
    );
  }
}

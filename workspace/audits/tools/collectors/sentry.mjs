import { count, field, getJson, recordsOf } from "../common.mjs";

/**
 * The errors of the last 30 days in a `stats_v2` answer: the sum over every group of `sum(quantity)`.
 * @param {unknown} json
 * @returns {number}
 */
export const parseSentryStats = (json) =>
  recordsOf(field(json, "groups")).reduce(
    (sum, group) => sum + count(field(group["totals"], "sum(quantity)")),
    0,
  );

/**
 * The `sentry_errors` line (G11). The token is optional: with it unset no call is made.
 * @param {import("../common.mjs").Context} ctx
 * @returns {Promise<import("./ours.mjs").Reading[]>}
 */
export async function collect(ctx) {
  const token = ctx.env["SENTRY_AUTH_TOKEN"] ?? "";
  const org = ctx.env["SENTRY_ORG"] ?? "";
  if (token === "")
    return [{ line: "sentry_errors", error: "not_measured: SENTRY_AUTH_TOKEN unset" }];
  if (org === "") return [{ line: "sentry_errors", error: "not_measured: SENTRY_ORG unset" }];
  const answer = await getJson(
    ctx.fetchImpl,
    `https://sentry.io/api/0/organizations/${encodeURIComponent(org)}/stats_v2/?field=sum(quantity)&category=error&interval=1d&statsPeriod=30d`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (answer.status !== 200) {
    return [{ line: "sentry_errors", error: `not_measured: Sentry ${answer.reason}` }];
  }
  return [{ line: "sentry_errors", used: parseSentryStats(answer.json) }];
}

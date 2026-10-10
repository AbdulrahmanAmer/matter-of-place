import { queryWorkersInvocations } from "../../../../app/scripts/cpu-gate.mjs";
import { count, field, messageOf } from "../common.mjs";

// The two Workers request lines (P-009: 100,000 a day for the account) through B4's one GraphQL query text, with this
// collector's own `fields` (T-11). The site's two Workers are summed; `pr-<n>` previews are not counted.

const SCRIPTS = ["matter-of-place", "matter-of-place-dev"];
const FIELDS = "sum { requests }";

/**
 * The requests of the rows of one answer.
 * @param {unknown[]} rows
 * @returns {number}
 */
export const sumRequests = (rows) =>
  rows.map((row) => count(field(field(row, "sum"), "requests"))).reduce((a, b) => a + b, 0);

/**
 * @param {import("../common.mjs").Context} ctx
 * @returns {Promise<import("./ours.mjs").Reading[]>}
 */
export async function collect(ctx) {
  const token = ctx.env["CF_ANALYTICS_TOKEN"] ?? "";
  const accountId = ctx.env["CF_ACCOUNT_ID"] ?? ctx.env["CLOUDFLARE_ACCOUNT_ID"] ?? "";
  const missing = token === "" ? "CF_ANALYTICS_TOKEN" : accountId === "" ? "CF_ACCOUNT_ID" : "";
  if (missing !== "") {
    return ["workers_requests_day", "workers_requests_month"].map((line) => ({
      line,
      error: `not_measured: ${missing} unset`,
    }));
  }
  const now = ctx.now();
  const day = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const month = new Date(`${now.toISOString().slice(0, 7)}-01T00:00:00Z`);
  /** @param {Date} since */
  const requestsSince = async (since) => {
    let total = 0;
    for (const scriptName of SCRIPTS) {
      const rows = await queryWorkersInvocations({
        accountId,
        token,
        scriptName,
        since,
        until: now,
        fields: FIELDS,
        fetchFn: ctx.fetchImpl,
      });
      total += sumRequests(rows);
    }
    return total;
  };
  /**
   * @param {string} line
   * @param {Date} since
   * @returns {Promise<import("./ours.mjs").Reading>}
   */
  const reading = async (line, since) => {
    try {
      return { line, used: await requestsSince(since) };
    } catch (error) {
      return { line, error: `not_measured: Cloudflare ${messageOf(error)}` };
    }
  };
  return [
    await reading("workers_requests_day", day),
    await reading("workers_requests_month", month),
  ];
}

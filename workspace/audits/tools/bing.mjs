import { count, field, getJson, measured, notMeasured, recordsOf, runCli } from "./common.mjs";

const WINDOW_DAYS = 28;
const SITE = "https://matterofplace.com/";
const ENDPOINT = "https://ssl.bing.com/webmaster/api.svc/json/GetQueryStats";

/**
 * Queries, impressions and clicks over the rows of a `GetQueryStats` answer dated in the last 28
 * days. Bing writes the date as `/Date(<milliseconds>)/`; `queries` counts distinct query texts.
 * @param {unknown} json
 * @param {Date} now
 * @returns {{ queries: number, impressions: number, clicks: number }}
 */
export function parseBing(json, now) {
  const since = now.getTime() - WINDOW_DAYS * 86_400_000;
  const rows = recordsOf(field(json, "d")).filter((row) => {
    const stamp = /\/Date\((-?\d+)/.exec(String(row["Date"]))?.[1];
    return stamp !== undefined && Number(stamp) >= since && Number(stamp) <= now.getTime();
  });
  return {
    queries: new Set(rows.map((row) => String(row["Query"]))).size,
    impressions: rows.reduce((sum, row) => sum + count(row["Impressions"]), 0),
    clicks: rows.reduce((sum, row) => sum + count(row["Clicks"]), 0),
  };
}

/**
 * The optional Bing Webmaster reader: one call, never retried. An unset key makes no call; a
 * non-200 answer or an `ErrorCode` body is `not_measured` with the status.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  const key = ctx.env["BING_WEBMASTER_API_KEY"];
  if (key === undefined || key === "") return { bing: notMeasured("BING_WEBMASTER_API_KEY unset") };
  const answer = await getJson(
    ctx.fetchImpl,
    `${ENDPOINT}?${new URLSearchParams({ siteUrl: SITE, apikey: key }).toString()}`,
  );
  if (answer.status !== 200) return { bing: notMeasured(`Bing ${answer.reason}`) };
  const code = field(answer.json, "ErrorCode");
  if (code !== undefined) {
    return {
      bing: notMeasured(
        `Bing ErrorCode ${JSON.stringify(code)}: ${String(field(answer.json, "Message"))}`,
      ),
    };
  }
  return { bing: measured({ window_days: WINDOW_DAYS, ...parseBing(answer.json, ctx.now()) }) };
}

await runCli(import.meta.url, collect);

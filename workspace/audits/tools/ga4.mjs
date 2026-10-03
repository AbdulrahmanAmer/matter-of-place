import { count, field, getJson, measured, notMeasured, recordsOf, runCli } from "./common.mjs";
import { accessToken } from "./google-auth.mjs";

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const WINDOW_DAYS = 7;
const SESSION_EVENT = "session_start";

/**
 * Event counts of a GA4 `runReport` answer (dimension `eventName`, metric `eventCount`). Sessions
 * are the count of `session_start`, the event GA4 sends once per session.
 * @param {unknown} json
 * @returns {{ sessions: number, events: { name: string, count: number }[] }}
 */
export function parseGa4(json) {
  const events = recordsOf(field(json, "rows")).flatMap((row) => {
    const name = field(recordsOf(row["dimensionValues"])[0], "value");
    const total = field(recordsOf(row["metricValues"])[0], "value");
    return typeof name === "string" ? [{ name, count: count(total) }] : [];
  });
  return {
    sessions: events.find((event) => event.name === SESSION_EVENT)?.count ?? 0,
    events,
  };
}

/**
 * GA4 sessions and events of the last 7 days with the service account of `GOOGLE_SA_JSON_B64`.
 * A missing credential, a missing property id or an empty property is `not_measured`.
 * @param {import("./common.mjs").Context} ctx
 * @returns {Promise<import("./common.mjs").Collected>}
 */
export async function collect(ctx) {
  const saJsonB64 = ctx.env["GOOGLE_SA_JSON_B64"];
  const property = ctx.env["GA4_PROPERTY_ID"];
  if (saJsonB64 === undefined || saJsonB64 === "") {
    return { ga4: notMeasured("GOOGLE_SA_JSON_B64 unset") };
  }
  if (property === undefined || property === "")
    return { ga4: notMeasured("GA4_PROPERTY_ID unset") };
  const auth = await accessToken({
    saJsonB64,
    scope: SCOPE,
    fetchImpl: ctx.fetchImpl,
    now: ctx.now(),
  });
  if ("reason" in auth) return { ga4: notMeasured(auth.reason) };
  const answer = await getJson(
    ctx.fetchImpl,
    `https://analyticsdata.googleapis.com/v1beta/properties/${property}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${String(WINDOW_DAYS)}daysAgo`, endDate: "yesterday" }],
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
      }),
    },
  );
  if (answer.status !== 200) return { ga4: notMeasured(`GA4 ${answer.reason}`) };
  const parsed = parseGa4(answer.json);
  if (parsed.events.length === 0) {
    return {
      ga4: notMeasured(`GA4 property ${property} has no events in ${String(WINDOW_DAYS)} days`),
    };
  }
  return { ga4: measured({ window_days: WINDOW_DAYS, ...parsed }) };
}

await runCli(import.meta.url, collect);

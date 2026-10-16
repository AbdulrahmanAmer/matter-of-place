import { usageLineKeys, type UsageAnswer, type UsageLine } from "../../../domain/admin-usage.ts";
import { gaugeLimit } from "../../../domain/usage-gauges.ts";
import { fromRpcError } from "../../lib/admin-errors.ts";
import type { AdminActor } from "../../lib/actor-types.ts";
import { authorize } from "../../lib/authz.ts";
import type { Db } from "../../lib/db.ts";

// Settings, Service usage (W7 item 7): the `vendor_usage` lines as the laptop last recorded them, read only. Settings
// is staff-only and not cached, so this reads the table, not the public state (architecture 13 rule 1 is for public
// reads). The limit of a line is the one its row records, else the free-plan limit the dashboard tile uses
// (`domain/usage-gauges.ts`); the note of the Claude week is read through that file's `claudeWeekResetAt`, as the Office
// should read it.

/** `GET /api/admin/settings/usage`: every known line in a fixed order; a line never recorded has no figures. */
export async function getUsage(actor: AdminActor, db: Db): Promise<UsageAnswer> {
  authorize(actor, "settings.get");
  const { data, error } = await db
    .from("vendor_usage")
    .select("line, used, limit_value, note, measured_at");
  if (error !== null) throw fromRpcError(error);
  const lines = usageLineKeys.map((line): UsageLine => {
    const row = data.find((candidate) => candidate.line === line);
    if (row === undefined) {
      return { line, used: null, limit: null, percent: null, note: null, measured_at: null };
    }
    const limit = gaugeLimit(line, row.limit_value, row.note);
    return {
      line,
      used: row.used,
      limit,
      percent: limit === null ? null : Math.round((row.used / limit) * 100),
      note: row.note,
      measured_at: row.measured_at,
    };
  });
  return { lines };
}

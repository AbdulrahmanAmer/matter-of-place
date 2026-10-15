import { usageLineKeys, type UsageAnswer, type UsageLine } from "../../../domain/admin-usage.ts";
import { fromRpcError } from "../../lib/admin-errors.ts";
import type { AdminActor } from "../../lib/actor-types.ts";
import { authorize } from "../../lib/authz.ts";
import type { Db } from "../../lib/db.ts";

// Settings, Service usage (W7 item 7): the `vendor_usage` lines as the laptop last recorded them, read only. Settings
// is staff-only and not cached, so this reads the table, not the public state (architecture 13 rule 1 is for public
// reads). The Claude week is read here again on purpose: `workforce/service.ts` reads it for Matter's panel.

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
    return {
      line,
      used: row.used,
      limit: row.limit_value,
      percent: row.limit_value === null ? null : Math.round((row.used / row.limit_value) * 100),
      note: row.note,
      measured_at: row.measured_at,
    };
  });
  return { lines };
}

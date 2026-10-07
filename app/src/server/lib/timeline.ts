import type { TimelineEntry } from "../../domain/admin-submissions.ts";
import { fromRpcError } from "./admin-errors.ts";
import type { Db } from "./db.ts";
import { entityJobsFilter } from "./jobs.ts";

// The history of one request or property (screens 4 and 8): audit rows and the events of its jobs, newest first.
// Three reads and no write. Each source is cut at LIMIT rows, so the newest LIMIT of the merge are always present.

const LIMIT = 100;

/** The `audit_log.entity` value every B7 function writes for the row. */
type TimelineEntity = "submission" | "property";

export async function entityTimeline(
  db: Db,
  entity: TimelineEntity,
  id: string,
): Promise<TimelineEntry[]> {
  const [audit, jobs] = await Promise.all([
    db
      .from("audit_log")
      .select("id, at, action, actor_id, actor_kind, note")
      .eq("entity", entity)
      .eq("entity_id", id)
      .order("at", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIMIT),
    db
      .from("jobs")
      .select("id, type")
      .or(entityJobsFilter(id))
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);
  if (audit.error !== null) throw fromRpcError(audit.error);
  if (jobs.error !== null) throw fromRpcError(jobs.error);
  const typeOf = new Map(jobs.data.map((job) => [job.id, job.type]));
  const events =
    typeOf.size === 0
      ? []
      : await db
          .from("job_events")
          .select("id, at, kind, message, job_id, actor_id")
          .in("job_id", [...typeOf.keys()])
          .order("at", { ascending: false })
          .order("id", { ascending: false })
          .limit(LIMIT)
          .then(({ data, error }) => {
            if (error !== null) throw fromRpcError(error);
            return data;
          });
  const entries: TimelineEntry[] = [
    ...audit.data.map((row): TimelineEntry => ({
      source: "audit",
      id: `audit-${String(row.id)}`,
      at: row.at,
      action: row.action,
      actor_id: row.actor_id,
      actor_kind: row.actor_kind,
      note: row.note,
      job_type: null,
    })),
    ...events.map((row): TimelineEntry => ({
      source: "job",
      id: `job-${String(row.id)}`,
      at: row.at,
      action: row.kind,
      actor_id: row.actor_id,
      actor_kind: null,
      note: row.message,
      job_type: typeOf.get(row.job_id) ?? null,
    })),
  ];
  return entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, LIMIT);
}

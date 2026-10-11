// PR 278 leftover (ruling H79 (3)): `audit_health()` judges an `analytics_daily` row overdue when its UTC day is
// before the UTC day of the retention cutoff. The cast of the cutoff to a date took the session's time zone, so a
// cutoff stamped 23:30 UTC was already the next day in Africa/Cairo and a cutoff stamped 00:30 UTC was still the day
// before in America/Los_Angeles. Every case runs in one rolled-back transaction (F22, P-312).
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { withRollback, type Db } from "../fixtures/db";

const healthSchema = z.object({
  retention: z.array(z.object({ key: z.string(), overdue: z.number().nullable() })),
});

async function overdue(db: Db): Promise<number> {
  const result = await db.query<{ value: unknown }>("select public.audit_health() as value");
  const health = healthSchema.parse(result.rows[0]?.value);
  const row = health.retention.find((entry) => entry.key === "analytics_daily");
  if (row?.overdue === undefined || row.overdue === null) {
    throw new Error("audit_health lists no overdue count for analytics_daily");
  }
  return row.overdue;
}

/**
 * Stamps the retention cutoff of `analytics_daily` at `stamp` exactly, in the session zone `zone`, and returns the UTC
 * day of the stamp. The function computes `now() - (keep_for + 30 days)`; with an interval of seconds only, the 30 days
 * are calendar days of the session zone, so the seconds are solved in that same zone and a daylight saving change
 * between now and the stamp cannot move the cutoff.
 */
async function stampCutoff(db: Db, zone: string, stamp: string): Promise<string> {
  await db.query(`set local time zone '${zone}'`);
  const updated = await db.query(
    `update public.retention_policies
     set keep_for = make_interval(secs => extract(epoch from ((now() - interval '30 days') - $1::timestamptz)))
     where key = 'analytics_daily' and enabled and action <> 'keep'`,
    [stamp],
  );
  if (updated.rowCount !== 1)
    throw new Error("the analytics_daily retention policy is not enabled");
  const day = await db.query<{ day: string }>(
    "select ($1::timestamptz at time zone 'utc')::date::text as day",
    [stamp],
  );
  const row = day.rows[0];
  if (row === undefined) throw new Error("no day for the stamp");
  return row.day;
}

const cases = [
  // The stamp from the brief, in the two zones: the west zone happens to agree, the east zone is the one that crossed.
  { zone: "Africa/Cairo", stamp: "2026-01-10 23:30:00+00" },
  { zone: "America/Los_Angeles", stamp: "2026-01-10 23:30:00+00" },
  { zone: "America/Los_Angeles", stamp: "2026-01-10 00:30:00+00" },
  { zone: "UTC", stamp: "2026-01-10 23:30:00+00" },
] as const;

describe("audit_health analytics_daily overdue count and the session time zone", () => {
  it.each(cases)(
    "a cutoff stamped $stamp counts the days before its UTC day, with the session in $zone",
    async ({ zone, stamp }) => {
      await withRollback(async (db) => {
        const path = `/tz-${randomUUID()}`;
        const utcDay = await stampCutoff(db, zone, stamp);
        const before = await overdue(db);
        // Two days before the cutoff's UTC day are overdue, its own day and the next are not.
        await db.query(
          `insert into public.analytics_daily (day, event, path, events)
           select $1::date + d, 'not_found', $2, 1 from unnest(array[-2, -1, 0, 1]) as d`,
          [utcDay, path],
        );
        expect((await overdue(db)) - before).toBe(2);
      });
    },
  );

  it("answers the same count under every session zone for one cutoff", async () => {
    await withRollback(async (db) => {
      const path = `/tz-${randomUUID()}`;
      const utcDay = await stampCutoff(db, "UTC", "2026-01-10 23:30:00+00");
      await db.query(
        `insert into public.analytics_daily (day, event, path, events)
         select $1::date + d, 'not_found', $2, 1 from unnest(array[-2, -1, 0, 1]) as d`,
        [utcDay, path],
      );
      const counts: Record<string, number> = {};
      for (const zone of ["UTC", "Africa/Cairo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
        await stampCutoff(db, zone, "2026-01-10 23:30:00+00");
        counts[zone] = await overdue(db);
      }
      expect(new Set(Object.values(counts)).size).toBe(1);
    });
  });
});

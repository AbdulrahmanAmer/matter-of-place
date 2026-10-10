// B14 step 4: the audit routine's four functions (`<ts>_audit_reads.sql`). Every case runs in one rolled-back
// transaction (F22); numbers are read before and after the case's own rows, so rows already on the database change no
// outcome.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

async function value<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<{ value: T }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.value;
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable (G-102). */
async function attempt(db: Db, sql: string): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

const usageSchema = z.object({
  email_sent_month: z.number(),
  reels_month: z.number(),
  model_usage_month: z.array(
    z.object({
      model: z.string(),
      input_tokens: z.number(),
      output_tokens: z.number(),
      jobs: z.number(),
    }),
  ),
});
const healthSchema = z.object({
  analytics_trend: z.array(z.object({ month: z.string(), event: z.string(), events: z.number() })),
  retention: z.array(z.object({ key: z.string(), overdue: z.number().nullable() })),
  inquiries_by_source: z.array(z.object({ source: z.string(), count_7d: z.number() })).nullable(),
});

const usage = async (db: Db) =>
  usageSchema.parse(await value(db, "select public.audit_usage() as value"));
const health = async (db: Db) =>
  healthSchema.parse(await value(db, "select public.audit_health() as value"));

async function job(db: Db, type: string, status: string, finishedAt: string, result: object = {}) {
  await db.query(
    `insert into public.jobs (type, idempotency_key, status, finished_at, result)
     values ($1, $2, $3::public.job_status, ${finishedAt}, $4)`,
    [type, `b14-test-${randomUUID()}`, status, JSON.stringify(result)],
  );
}

describe("audit_not_found", () => {
  it("lists a seeded not_found path with its referrer host and its redirect", async () => {
    await withRollback(async (db) => {
      const path = `/b14-missing-${randomUUID()}`;
      await db.query(
        `insert into public.analytics_events (event, path, data, occurred_at)
         select 'not_found', $1, '{"referrer_host": "ref.example"}', now() from generate_series(1, 60)`,
        [path],
      );
      await db.query(
        "insert into public.redirects (from_path, to_path) values ($1, '/california')",
        [path],
      );
      const rows = await db.query("select * from public.audit_not_found(7, 50) where path = $1", [
        path,
      ]);
      expect(rows.rows).toEqual([
        { path, count: 60, top_referrer_host: "ref.example", redirected: true },
      ]);
    });
  });

  it("reads analytics_events through B2's analytics_events_event_occurred_idx", async () => {
    await withRollback(async (db) => {
      expect(
        await value(
          db,
          "select count(*)::int as value from pg_indexes where indexname = 'analytics_events_event_occurred_idx'",
        ),
      ).toBe(1);
    });
  });
});

describe("audit_health", () => {
  it("analytics_trend sums last month's daily rows and leaves a month 14 months back out", async () => {
    await withRollback(async (db) => {
      const month = await value<string>(
        db,
        "select to_char(date_trunc('month', now() at time zone 'utc') - interval '1 month', 'YYYY-MM') as value",
      );
      const trendOf = async (wanted: string) =>
        (await health(db)).analytics_trend.filter(
          (row) => row.month === wanted && row.event === "not_found",
        );
      const before = (await trendOf(month))[0]?.events ?? 0;
      await db.query(
        `insert into public.analytics_daily (day, event, path, events)
         values ((date_trunc('month', now() at time zone 'utc') - interval '1 month')::date + 1, 'not_found', '/b14-a', 3),
                ((date_trunc('month', now() at time zone 'utc') - interval '1 month')::date + 2, 'not_found', '/b14-b', 4),
                ((date_trunc('month', now() at time zone 'utc') - interval '14 months')::date, 'not_found', '/b14-c', 5)`,
      );
      expect((await trendOf(month))[0]?.events).toBe(before + 7);
      const old = await value<string>(
        db,
        "select to_char(date_trunc('month', now() at time zone 'utc') - interval '14 months', 'YYYY-MM') as value",
      );
      expect(await trendOf(old)).toEqual([]);
    });
  });

  it("counts a jobs_done row finished keep_for plus 31 days ago as overdue in retention", async () => {
    await withRollback(async (db) => {
      const overdue = async () =>
        (await health(db)).retention.find((row) => row.key === "jobs_done")?.overdue;
      const before = (await overdue()) ?? 0;
      await job(
        db,
        "b14_probe",
        "done",
        "now() - (select keep_for + interval '31 days' from public.retention_policies where key = 'jobs_done')",
      );
      expect(await overdue()).toBe(before + 1);
    });
  });

  it("groups inquiries by utm_source while the attribution column exists", async () => {
    await withRollback(async (db) => {
      const countOf = async (source: string) =>
        (await health(db)).inquiries_by_source?.find((row) => row.source === source)?.count_7d ?? 0;
      const [instagram, none] = [await countOf("instagram"), await countOf("(none)")];
      await db.query(
        `insert into public.inquiries (intent, name, email, message, source_path, attribution)
         values ('general', 'A', 'a@example.test', 'Hello', '/', '{"first_touch": {"utm_source": "instagram"}}'),
                ('general', 'B', 'b@example.test', 'Hello', '/', '{}')`,
      );
      expect([await countOf("instagram"), await countOf("(none)")]).toEqual([
        instagram + 1,
        none + 1,
      ]);
    });
  });

  it("answers inquiries_by_source null once the attribution column is gone", async () => {
    await withRollback(async (db) => {
      await db.query("alter table public.inquiries drop column attribution");
      expect((await health(db)).inquiries_by_source).toBeNull();
    });
  });
});

describe("audit_usage", () => {
  it("email_sent_month counts a sent row and not a skipped one", async () => {
    await withRollback(async (db) => {
      const before = (await usage(db)).email_sent_month;
      await db.query(
        `insert into public.email_messages (template_key, kind, status, sent_at)
         values ('b14_test', 'test', 'sent', now()), ('b14_test', 'test', 'skipped', null)`,
      );
      expect((await usage(db)).email_sent_month).toBe(before + 1);
    });
  });

  it("email_sent_month adds a sent broadcast's recipients and leaves a dry_ broadcast out", async () => {
    await withRollback(async (db) => {
      const before = (await usage(db)).email_sent_month;
      const id = await value<string>(
        db,
        `insert into public.newsletter_issues (number, status, sent_at, resend_broadcast_id, metrics)
         values ((select coalesce(max(number), 0) + 1 from public.newsletter_issues), 'sent', now(), 'b_test',
                 '{"recipients": 80}')
         returning id as value`,
      );
      expect((await usage(db)).email_sent_month).toBe(before + 80);
      await db.query(
        "update public.newsletter_issues set resend_broadcast_id = 'dry_test' where id = $1",
        [id],
      );
      expect((await usage(db)).email_sent_month).toBe(before);
    });
  });

  it("model_usage_month sums a done write_captions job's tokens and reels_month counts a done render_reel", async () => {
    await withRollback(async (db) => {
      const reels = (await usage(db)).reels_month;
      await job(db, "write_captions", "done", "now()", {
        usage: { model: "b14-test-model", input_tokens: 100, output_tokens: 40 },
      });
      await job(db, "render_reel", "done", "now()");
      const after = await usage(db);
      expect(after.model_usage_month.filter((row) => row.model === "b14-test-model")).toEqual([
        { model: "b14-test-model", input_tokens: 100, output_tokens: 40, jobs: 1 },
      ]);
      expect(after.reels_month).toBe(reels + 1);
    });
  });
});

describe("audit_record_run", () => {
  it("sets last_run_at of audit only, writes one audit_log row and no automation_revisions row", async () => {
    await withRollback(async (db) => {
      const agent = await createStaffUser(db, ["commercial"]);
      await db.query("update public.user_roles set actor_kind = 'agent' where user_id = $1", [
        agent,
      ]);
      const snapshot = () =>
        db.query<{ key: string; row: Record<string, unknown> }>(
          "select key, to_jsonb(s) - 'last_run_at' - 'updated_at' as row from public.schedule_settings s order by key",
        );
      const others = () =>
        db.query(
          "select to_jsonb(s) as row from public.schedule_settings s where key <> 'audit' order by key",
        );
      const [before, othersBefore] = [(await snapshot()).rows, (await others()).rows];
      const requestId = `req-${randomUUID()}`;
      const returned = await value<Date>(
        db,
        "select public.audit_record_run($1, 'agent', $2) as value",
        [agent, requestId],
      );
      expect(
        await value(
          db,
          "select last_run_at = now() as value from public.schedule_settings where key = 'audit'",
        ),
      ).toBe(true);
      expect(returned).toEqual(await value<Date>(db, "select now() as value"));
      expect((await snapshot()).rows).toEqual(before);
      expect((await others()).rows).toEqual(othersBefore);
      expect(
        (
          await db.query(
            "select actor_id, actor_kind, entity from public.audit_log where action = 'audit.record_run' and request_id = $1",
            [requestId],
          )
        ).rows,
      ).toEqual([{ actor_id: agent, actor_kind: "agent", entity: "schedule_settings.audit" }]);
      expect(
        await value(
          db,
          `select count(*)::int as value from public.automation_revisions
           where row_id = (select id from public.schedule_settings where key = 'audit') and at >= now()`,
        ),
      ).toBe(0);
    });
  });

  it("refuses audit_usage and audit_record_run to authenticated", async () => {
    await withRollback(async (db) => {
      const user = await createStaffUser(db, ["admin"]);
      await asRole(db, "authenticated", user);
      expect(await attempt(db, "select public.audit_usage()")).toBe(
        "42501 permission denied for function audit_usage",
      );
      expect(await attempt(db, `select public.audit_record_run('${user}', 'human', 'r')`)).toBe(
        "42501 permission denied for function audit_record_run",
      );
    });
  });
});

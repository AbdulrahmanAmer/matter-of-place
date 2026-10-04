// B8 steps 6 and 6a: the job-runner cron row and liveness (DO-03, JOB-04, rulings H9, H10 and H34 (2)). Every case
// runs in a rolled-back transaction. Each case first quiets the shared database (every waiting or dead job cancelled,
// every beat fresh), so a name in `failing` comes from the case's own rows.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

interface Health {
  ok: boolean;
  failing: string[];
}

const CRON_MIGRATION = new URL(
  "../../supabase/migrations/20261004023709_job_cron.sql",
  import.meta.url,
);

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

async function quiet(db: Db): Promise<void> {
  await db.query(
    `update public.jobs set status = 'cancelled', finished_at = now() - interval '30 days'
     where status in ('queued', 'failed', 'dead')`,
  );
  await db.query(
    "select public.beat(name, '{}') from unnest(array['runner', 'keepwarm', 'backup']) as name",
  );
}

/** `ops_health` at the transaction's `now()` plus `minutes`. */
async function health(db: Db, minutes = 0): Promise<Health> {
  const { result } = await one<{ result: Health }>(
    db,
    "select public.ops_health(now() + make_interval(mins => $1)) as result",
    [minutes],
  );
  return result;
}

/** A queued job whose run_after is `minutes` before now(). */
async function queued(db: Db, minutes: number, local = false): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `select public.enqueue_job('test.job', '{"params": {}, "data": {}}', $1,
       p_run_after => now() - make_interval(mins => $2), p_local => $3) as id`,
    [`test:${randomUUID()}`, minutes, local],
  );
  return id;
}

/** Turns on or off the keepwarm and backup rows, making B8b's table in the transaction when it does not exist yet. */
async function schedules(db: Db, keepwarm: boolean, backup: boolean): Promise<void> {
  const { exists } = await one<{ exists: boolean }>(
    db,
    "select to_regclass('public.schedule_settings') is not null as exists",
  );
  if (!exists) {
    await db.query(
      "create table public.schedule_settings (key text primary key, enabled boolean not null)",
    );
    await db.query(
      "insert into public.schedule_settings values ('keepwarm', false), ('backup', false)",
    );
  }
  await db.query(
    `update public.schedule_settings
     set enabled = case key when 'keepwarm' then $1::boolean else $2::boolean end
     where key in ('keepwarm', 'backup')`,
    [keepwarm, backup],
  );
}

describe("ops_health", () => {
  it("answers ok with no failing name when every beat is fresh and no job waits", async () => {
    const result = await withRollback(async (db) => {
      await quiet(db);
      return health(db);
    });
    expect(result).toEqual({ ok: true, failing: [] });
  });

  it("names runner when its beat is 4 minutes old and not when it is 2 minutes old", async () => {
    const [atTwo, atFour] = await withRollback(async (db) => {
      await quiet(db);
      return [await health(db, 2), await health(db, 4)];
    });
    expect(atTwo).toEqual({ ok: true, failing: [] });
    expect(atFour).toEqual({ ok: false, failing: ["runner"] });
  });

  it("names runner when the runner has never beaten", async () => {
    const result = await withRollback(async (db) => {
      await quiet(db);
      await db.query("delete from public.ops_heartbeats where name = 'runner'");
      return health(db);
    });
    expect(result).toEqual({ ok: false, failing: ["runner"] });
  });

  it("names stale_queue for a job due 16 minutes ago, not 14, and never for a run_local job", async () => {
    const [local, recent, stale] = await withRollback(async (db) => {
      await quiet(db);
      await queued(db, 60, true);
      const afterLocal = await health(db);
      await queued(db, 14);
      const afterRecent = await health(db);
      await queued(db, 16);
      return [afterLocal, afterRecent, await health(db)];
    });
    expect(local).toEqual({ ok: true, failing: [] });
    expect(recent).toEqual({ ok: true, failing: [] });
    expect(stale).toEqual({ ok: false, failing: ["stale_queue"] });
  });

  it("names dead_jobs for a job dead 23 hours ago and not 25 hours ago", async () => {
    const [old, recent] = await withRollback(async (db) => {
      await quiet(db);
      const id = await queued(db, 0);
      const dead = (hours: number) =>
        db.query(
          "update public.jobs set status = 'dead', finished_at = now() - make_interval(hours => $2) where id = $1",
          [id, hours],
        );
      await dead(25);
      const afterOld = await health(db);
      await dead(23);
      return [afterOld, await health(db)];
    });
    expect(old).toEqual({ ok: true, failing: [] });
    expect(recent).toEqual({ ok: false, failing: ["dead_jobs"] });
  });

  it("watches keepwarm and backup only while their schedule row is enabled", async () => {
    const result = await withRollback(async (db) => {
      await quiet(db);
      await db.query("delete from public.ops_heartbeats where name in ('keepwarm', 'backup')");
      await schedules(db, false, false);
      const off = await health(db);
      await schedules(db, true, true);
      const absent = await health(db);
      await db.query(
        "select public.beat(name, '{}') from unnest(array['keepwarm', 'backup']) as name",
      );
      return {
        off,
        absent,
        keepwarm24: await health(db, 24),
        keepwarm26: await health(db, 26),
        backup25h: await health(db, 25 * 60),
        backup27h: await health(db, 27 * 60),
      };
    });
    expect(result).toEqual({
      off: { ok: true, failing: [] },
      absent: { ok: false, failing: ["keepwarm", "backup"] },
      keepwarm24: { ok: false, failing: ["runner"] },
      keepwarm26: { ok: false, failing: ["runner", "keepwarm"] },
      backup25h: { ok: false, failing: ["runner", "keepwarm"] },
      backup27h: { ok: false, failing: ["runner", "keepwarm", "backup"] },
    });
  });
});

describe("jobs_liveness", () => {
  it("answers the runner beat time and the age of the oldest due job, leaving run_local jobs out", async () => {
    const result = await withRollback(async (db) => {
      await quiet(db);
      await queued(db, 60, true);
      await queued(db, 10);
      return one<{ beat_is_now: boolean; age: number }>(
        db,
        `select (l ->> 'runner_beat_at')::timestamptz = now() as beat_is_now,
           (l ->> 'oldest_due_age_s')::int as age
         from public.jobs_liveness(now()) as l`,
      );
    });
    expect(result).toEqual({ beat_is_now: true, age: 600 });
  });
});

describe("beat", () => {
  it("keeps one row per name and replaces its detail", async () => {
    const rows = await withRollback(async (db) => {
      await db.query(`select public.beat('runner', '{"claimed": 1}')`);
      await db.query(`select public.beat('runner', '{"claimed": 4}')`);
      return (
        await db.query<{ detail: unknown }>(
          "select detail from public.ops_heartbeats where name = 'runner'",
        )
      ).rows;
    });
    expect(rows).toEqual([{ detail: { claimed: 4 } }]);
  });

  it("only service_role may execute beat, ops_health and jobs_liveness", async () => {
    const grants = await withRollback(async (db) => {
      const { rows } = await db.query<{ grant: string }>(
        `select f || ' ' || r || ' ' || has_function_privilege(r, f, 'execute')::text as grant
         from unnest(array['public.beat(text, jsonb)', 'public.ops_health(timestamptz)',
           'public.jobs_liveness(timestamptz)']) as f,
           unnest(array['anon', 'authenticated', 'service_role']) as r
         order by f, r`,
      );
      return rows.map((row) => row.grant);
    });
    expect(grants).toEqual([
      "public.beat(text, jsonb) anon false",
      "public.beat(text, jsonb) authenticated false",
      "public.beat(text, jsonb) service_role true",
      "public.jobs_liveness(timestamptz) anon false",
      "public.jobs_liveness(timestamptz) authenticated false",
      "public.jobs_liveness(timestamptz) service_role true",
      "public.ops_health(timestamptz) anon false",
      "public.ops_health(timestamptz) authenticated false",
      "public.ops_health(timestamptz) service_role true",
    ]);
  });
});

describe("job-runner cron", () => {
  it("re-applies to one row every minute that posts with the Vault bearer and a 55 s timeout", async () => {
    const migration = readFileSync(CRON_MIGRATION, "utf8");
    const rows = await withRollback(async (db) => {
      await db.query(migration);
      await db.query(migration);
      return (
        await db.query<{ schedule: string; command: string }>(
          "select schedule, command from cron.job where jobname = 'job-runner'",
        )
      ).rows;
    });
    expect(rows.map((row) => row.schedule)).toEqual(["* * * * *"]);
    const command = rows[0]?.command ?? "";
    for (const part of [
      "net.http_post",
      "name = 'job_runner_url'",
      "'Bearer ' ||",
      "name = 'job_runner_secret'",
      "timeout_milliseconds := 55000",
    ]) {
      expect(command).toContain(part);
    }
  });
});

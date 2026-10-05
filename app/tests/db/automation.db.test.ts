// B8b step 1: the automation migration (invariants 7, 8, 11 and 12, SEC-11, JOB-07's schedule claim). Every case runs
// in one rolled-back transaction (F22); fixture rows are upserted, so a seeded row changes no outcome.
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

interface Revision {
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  actor_id: string | null;
  actor_kind: string | null;
  note: string | null;
}

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

async function revisions(db: Db, rowId: string): Promise<Revision[]> {
  return (
    await db.query<Revision>(
      "select id, before, after, actor_id, actor_kind, note from public.automation_revisions where row_id = $1",
      [rowId],
    )
  ).rows;
}

const updates = (rows: Revision[]) => rows.filter((row) => row.before !== null);

async function recipe(db: Db, trigger: string): Promise<{ id: string; version: number }> {
  return one(
    db,
    `insert into public.automation_recipes (trigger, name) values ($1, 'Before')
     on conflict (trigger) do update set name = 'Before'
     returning id, version`,
    [trigger],
  );
}

async function template(db: Db): Promise<{ id: string; key: string }> {
  return one(
    db,
    `insert into public.email_templates (key, subject, body) values ($1, 'Subject', '[]') returning id, key`,
    [`test_${randomUUID()}`],
  );
}

/** The row of `key`, enabled, last run an hour ago and next run due tomorrow. */
async function schedule(db: Db, key: string): Promise<{ id: string; last_run_at: string }> {
  return one(
    db,
    `insert into public.schedule_settings (key, cron, last_run_at, next_run_at)
     values ($1, '0 14 * * 2', now() - interval '1 hour', now() + interval '1 day')
     on conflict (key) do update
     set enabled = true, last_run_at = excluded.last_run_at, next_run_at = excluded.next_run_at
     returning id, last_run_at::text`,
    [key],
  );
}

async function scheduleRow(
  db: Db,
  key: string,
): Promise<{ last_run_at: Date | null; next_run_at: Date | null; now: Date }> {
  return one(
    db,
    "select last_run_at, next_run_at, now() as now from public.schedule_settings where key = $1",
    [key],
  );
}

describe("revisions (invariant 7)", () => {
  it("automation_put_recipe writes one revision with its actor and actor_kind, and version rises by one", async () => {
    const result = await withRollback(async (db) => {
      const row = await recipe(db, "subject_request.received");
      const actor = await createStaffUser(db, ["admin"]);
      await db.query(
        `select public.automation_put_recipe('subject_request.received', '{"name": "Edited"}', $1, 'human', 'req-1')`,
        [actor],
      );
      const mine = (await revisions(db, row.id)).filter((r) => r.actor_id === actor);
      const { version } = await one<{ version: number }>(
        db,
        "select version from public.automation_recipes where id = $1",
        [row.id],
      );
      return {
        revisions: mine.map((r) => ({ kind: r.actor_kind, name: r.after?.["name"] })),
        risen: version - row.version,
      };
    });
    expect(result).toEqual({ revisions: [{ kind: "human", name: "Edited" }], risen: 1 });
  });

  it("a direct update writes one revision with a null actor and note direct", async () => {
    const result = await withRollback(async (db) => {
      const row = await recipe(db, "subject_request.received");
      await db.query("update public.automation_recipes set name = 'Direct' where id = $1", [
        row.id,
      ]);
      return (await revisions(db, row.id))
        .filter((r) => r.after?.["name"] === "Direct")
        .map((r) => ({ actor: r.actor_id, kind: r.actor_kind, note: r.note }));
    });
    expect(result).toEqual([{ actor: null, kind: null, note: "direct" }]);
  });

  it("an update of schedule_settings.last_run_at alone with no actor writes no revision", async () => {
    const counts = await withRollback(async (db) => {
      const row = await schedule(db, "digest");
      const before = (await revisions(db, row.id)).length;
      await db.query(
        "update public.schedule_settings set last_run_at = now() where key = 'digest'",
      );
      return { before, after: (await revisions(db, row.id)).length };
    });
    expect(counts.after).toBe(counts.before);
  });

  it("an update and a delete of an automation_revisions row each raise append_only", async () => {
    const outcomes = await withRollback(async (db) => {
      const row = await template(db);
      const [first] = await revisions(db, row.id);
      if (first === undefined) throw new Error("the insert wrote no revision");
      return [
        await attempt(db, "update public.automation_revisions set note = 'x' where id = $1", [
          first.id,
        ]),
        await attempt(db, "delete from public.automation_revisions where id = $1", [first.id]),
      ];
    });
    expect(outcomes).toEqual(["P0001 append_only", "P0001 append_only"]);
  });
});

describe("recipes (invariant 8)", () => {
  it("an update of trigger raises trigger_locked", async () => {
    const outcome = await withRollback(async (db) => {
      const row = await recipe(db, "subject_request.received");
      return attempt(
        db,
        "update public.automation_recipes set trigger = 'health.failed' where id = $1",
        [row.id],
      );
    });
    expect(outcome).toBe("P0001 trigger_locked");
  });

  it("automation_put_recipe on an unknown trigger raises unknown_trigger", async () => {
    const outcome = await withRollback(async (db) =>
      attempt(
        db,
        `select public.automation_put_recipe('nope.event', '{"name": "x"}', gen_random_uuid(), 'human', 'req-1')`,
      ),
    );
    expect(outcome).toBe("P0002 unknown_trigger");
  });

  it("a commercial staff user cannot update a recipe", async () => {
    const count = await withRollback(async (db) => {
      const row = await recipe(db, "subject_request.received");
      const user = await createStaffUser(db, ["commercial"]);
      await asRole(db, "authenticated", user);
      return (
        await db.query("update public.automation_recipes set name = 'Commercial' where id = $1", [
          row.id,
        ])
      ).rowCount;
    });
    expect(count).toBe(0);
  });

  it("an admin staff user cannot insert into automation_recipes", async () => {
    const outcome = await withRollback(async (db) => {
      const user = await createStaffUser(db, ["admin"]);
      await asRole(db, "authenticated", user);
      return attempt(
        db,
        "insert into public.automation_recipes (trigger, name) values ('health.failed', 'Admin')",
      );
    });
    expect(outcome).toBe("42501 permission denied for table automation_recipes");
  });
});

describe("claim_schedule (invariant 11)", () => {
  it("a guarded claim moves both columns and writes no revision, and a second claim with the same old value returns false", async () => {
    const result = await withRollback(async (db) => {
      const row = await schedule(db, "reconcile");
      const before = (await revisions(db, row.id)).length;
      const claim = `select public.claim_schedule('reconcile', true, $1::timestamptz, now(), now() + interval '15 minutes') as ok`;
      const first = await one<{ ok: boolean }>(db, claim, [row.last_run_at]);
      const moved = await scheduleRow(db, "reconcile");
      const second = await one<{ ok: boolean }>(db, claim, [row.last_run_at]);
      return {
        first: first.ok,
        lastIsNow: moved.last_run_at?.getTime() === moved.now.getTime(),
        nextMinutes: ((moved.next_run_at?.getTime() ?? 0) - moved.now.getTime()) / 60000,
        newRevisions: (await revisions(db, row.id)).length - before,
        second: second.ok,
      };
    });
    expect(result).toEqual({
      first: true,
      lastIsNow: true,
      nextMinutes: 15,
      newRevisions: 0,
      second: false,
    });
  });

  it("a guarded claim on a row set enabled = false returns false", async () => {
    const ok = await withRollback(async (db) => {
      const row = await schedule(db, "reconcile");
      await db.query("update public.schedule_settings set enabled = false where key = 'reconcile'");
      const claim = await one<{ ok: boolean }>(
        db,
        "select public.claim_schedule('reconcile', true, $1::timestamptz, now(), now() + interval '15 minutes') as ok",
        [row.last_run_at],
      );
      return claim.ok;
    });
    expect(ok).toBe(false);
  });

  it("an unguarded claim of keepwarm returns true whatever last_run_at holds", async () => {
    const ok = await withRollback(async (db) => {
      await schedule(db, "keepwarm");
      const claim = await one<{ ok: boolean }>(
        db,
        "select public.claim_schedule('keepwarm', false, null, now(), now() + interval '10 minutes') as ok",
      );
      return claim.ok;
    });
    expect(ok).toBe(true);
  });
});

describe("automation_put_schedule (invariants 11 and 12)", () => {
  it("a last_run_at patch is stored, clears next_run_at and writes exactly one revision", async () => {
    const result = await withRollback(async (db) => {
      const row = await schedule(db, "digest");
      const actor = await createStaffUser(db, ["admin"]);
      const before = (await revisions(db, row.id)).length;
      await db.query(
        `select public.automation_put_schedule('digest', '{"last_run_at": "2026-10-07T00:00:00Z"}', $1, 'human', 'req-1')`,
        [actor],
      );
      const stored = await scheduleRow(db, "digest");
      return {
        last: stored.last_run_at?.toISOString(),
        next: stored.next_run_at,
        newRevisions: (await revisions(db, row.id)).length - before,
      };
    });
    expect(result).toEqual({ last: "2026-10-07T00:00:00.000Z", next: null, newRevisions: 1 });
  });

  it("a key outside the four raises unknown_field", async () => {
    const outcome = await withRollback(async (db) => {
      await schedule(db, "digest");
      return attempt(
        db,
        `select public.automation_put_schedule('digest', '{"next_run_at": "2026-10-07T00:00:00Z"}', gen_random_uuid(), 'human', 'req-1')`,
      );
    });
    expect(outcome).toBe("22023 unknown_field");
  });

  it("a cron change of keepwarm raises external_clock", async () => {
    const outcome = await withRollback(async (db) => {
      await schedule(db, "keepwarm");
      return attempt(
        db,
        `select public.automation_put_schedule('keepwarm', '{"cron": "*/5 * * * *"}', gen_random_uuid(), 'human', 'req-1')`,
      );
    });
    expect(outcome).toBe("22023 external_clock");
  });
});

describe("templates, reasons and channels", () => {
  it("automation_put_template writes one revision, and an unknown key raises unknown_template", async () => {
    const result = await withRollback(async (db) => {
      const row = await template(db);
      await db.query(
        `select public.automation_put_template($1, '{"subject": "New subject"}', gen_random_uuid(), 'human', 'req-1')`,
        [row.key],
      );
      return {
        updates: updates(await revisions(db, row.id)).map((r) => r.after?.["subject"]),
        unknown: await attempt(
          db,
          `select public.automation_put_template('nope', '{"subject": "x"}', gen_random_uuid(), 'human', 'req-1')`,
        ),
      };
    });
    expect(result).toEqual({ updates: ["New subject"], unknown: "P0002 unknown_template" });
  });

  it("an agent's automation_put_template creates one notify_admin job keyed by its request id, a human's none", async () => {
    const jobs = await withRollback(async (db) => {
      const row = await template(db);
      const count = async (kind: string) => {
        const requestId = `req-${randomUUID()}`;
        await db.query(
          `select public.automation_put_template($1, '{"enabled": false}', gen_random_uuid(), $2, $3)`,
          [row.key, kind, requestId],
        );
        return (
          await db.query<{ type: string }>(
            "select type from public.jobs where idempotency_key = $1",
            [`agent_automation:${requestId}`],
          )
        ).rows.map((job) => job.type);
      };
      return { agent: await count("agent"), human: await count("human") };
    });
    expect(jobs).toEqual({ agent: ["notify_admin"], human: [] });
  });

  it("automation_put_reason with a null id inserts the reason last with one revision", async () => {
    const result = await withRollback(async (db) => {
      await db.query(
        "insert into public.decline_reasons (code, label, email_paragraph, sort) values ('test_existing', 'Test', 'x', 1000)",
      );
      const { id } = await one<{ id: string }>(
        db,
        `select public.automation_put_reason(null, '{"code": "test_reason", "label": "Test", "email_paragraph": "x"}',
           gen_random_uuid(), 'human', 'req-1') ->> 'id' as id`,
      );
      const { last } = await one<{ last: string }>(
        db,
        "select code as last from public.decline_reasons order by sort desc, code limit 1",
      );
      return { last, revisions: (await revisions(db, id)).length };
    });
    expect(result).toEqual({ last: "test_reason", revisions: 1 });
  });

  it("automation_reorder_reasons writes one revision per changed sort", async () => {
    const changed = await withRollback(async (db) => {
      for (const code of ["test_a", "test_b", "test_c"]) {
        await db.query(
          "insert into public.decline_reasons (code, label, email_paragraph) values ($1, 'Test', 'x')",
          [code],
        );
      }
      const ids = (
        await db.query<{ id: string }>("select id from public.decline_reasons order by sort, code")
      ).rows.map((row) => row.id);
      await db.query(
        "select public.automation_reorder_reasons($1, gen_random_uuid(), 'human', 'req-1')",
        [ids],
      );
      // Swap the last two: exactly two rows change position.
      const swapped = [...ids.slice(0, -2), ...ids.slice(-2).reverse()];
      const actor = await createStaffUser(db, ["admin"]);
      await db.query("select public.automation_reorder_reasons($1, $2, 'human', 'req-2')", [
        swapped,
        actor,
      ]);
      const { count } = await one<{ count: string }>(
        db,
        "select count(*) from public.automation_revisions where actor_id = $1",
        [actor],
      );
      return Number(count);
    });
    expect(changed).toBe(2);
  });
});

describe("automation_restore_revision", () => {
  it("restoring a recipe edit writes its before back with exactly one revision noted restore:<id>", async () => {
    const result = await withRollback(async (db) => {
      const row = await recipe(db, "subject_request.received");
      const actor = await createStaffUser(db, ["admin"]);
      await db.query(
        `select public.automation_put_recipe('subject_request.received', '{"name": "After"}', $1, 'human', 'req-1')`,
        [actor],
      );
      const edit = (await revisions(db, row.id)).find((r) => r.actor_id === actor);
      if (edit === undefined) throw new Error("the edit wrote no revision");
      await db.query("select public.automation_restore_revision($1, $2, 'human', 'req-2')", [
        edit.id,
        actor,
      ]);
      const { name } = await one<{ name: string }>(
        db,
        "select name from public.automation_recipes where id = $1",
        [row.id],
      );
      const restores = (await revisions(db, row.id)).filter((r) => r.note === `restore:${edit.id}`);
      return { name, restores: restores.map((r) => r.after?.["name"]) };
    });
    expect(result).toEqual({ name: "Before", restores: ["Before"] });
  });

  it("restoring an insert revision raises nothing_to_restore", async () => {
    const outcome = await withRollback(async (db) => {
      const row = await template(db);
      const insert = (await revisions(db, row.id)).find((r) => r.before === null);
      if (insert === undefined) throw new Error("the insert wrote no revision");
      return attempt(
        db,
        "select public.automation_restore_revision($1, gen_random_uuid(), 'human', 'req-1')",
        [insert.id],
      );
    });
    expect(outcome).toBe("22023 nothing_to_restore");
  });

  it("an agent restore that sets an approval_mode value to auto raises human_only", async () => {
    const outcome = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(
        db,
        `insert into public.channel_settings (channel, posting_window, approval_mode)
         values ('facebook', '{"tz": "UTC"}', '{"Feature": "auto", "Reach": "manual", "Campaign": "manual"}')
         on conflict (channel) do update set approval_mode = excluded.approval_mode
         returning id`,
      );
      const human = await createStaffUser(db, ["admin"]);
      await db.query(
        `select public.automation_put_channel('facebook',
           '{"approval_mode": {"Feature": "manual", "Reach": "manual", "Campaign": "manual"}}', $1, 'human', 'req-1')`,
        [human],
      );
      const edit = (await revisions(db, id)).find((r) => r.actor_id === human);
      if (edit === undefined) throw new Error("the edit wrote no revision");
      return attempt(
        db,
        "select public.automation_restore_revision($1, gen_random_uuid(), 'agent', 'req-2')",
        [edit.id],
      );
    });
    expect(outcome).toBe("42501 human_only");
  });
});

describe("decline_reasons", () => {
  it("keeps exactly B2's policies", async () => {
    const policies = await withRollback(
      async (db) =>
        (
          await db.query<{ policyname: string }>(
            "select policyname from pg_policies where schemaname = 'public' and tablename = 'decline_reasons' order by 1",
          )
        ).rows,
    );
    expect(policies.map((p) => p.policyname)).toEqual([
      "decline_reasons_insert_editors",
      "decline_reasons_select_staff",
      "decline_reasons_update_editors",
    ]);
  });
});

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

/** The text of the one migration whose name ends in `suffix`; a test runs it again inside its transaction. */
function migration(suffix: string): string {
  const names = readdirSync(MIGRATIONS).filter((name) => name.endsWith(suffix));
  if (names.length !== 1 || names[0] === undefined)
    throw new Error(`one *${suffix}, found ${String(names.length)}`);
  return readFileSync(new URL(names[0], MIGRATIONS), "utf8");
}

const seed = () => migration("_automation_seed.sql");

describe("seed (step 4)", () => {
  it("holds one recipe per event type with the plan's step counts", async () => {
    const rows = await withRollback(async (db) => {
      await db.query(seed());
      return (
        await db.query<{ trigger: string; steps: number }>(
          "select trigger, jsonb_array_length(steps) as steps from public.automation_recipes order by trigger",
        )
      ).rows;
    });
    expect(Object.fromEntries(rows.map((row) => [row.trigger, row.steps]))).toEqual({
      "asset.approved": 4,
      "asset.rejected": 0,
      "digest.due": 2,
      "health.failed": 1,
      "inquiry.received": 4,
      "invoice.issued": 1,
      "invoice.voided": 1,
      "payment.marked": 1,
      "property.published": 10,
      "property.unpublished": 2,
      "subject_request.received": 2,
      "submission.accepted": 1,
      "submission.activated": 0,
      "submission.awaiting_assets": 1,
      "submission.declined": 1,
      "submission.received": 2,
      "subscriber.confirmed": 0,
      "subscriber.created": 1,
    });
  });

  it("seeds the eight schedule rows with their UTC cron and switches", async () => {
    const rows = await withRollback(async (db) => {
      await db.query(seed());
      return (
        await db.query<{
          key: string;
          cron: string;
          interval_days: number | null;
          enabled: boolean;
        }>("select key, cron, interval_days, enabled from public.schedule_settings order by key")
      ).rows;
    });
    expect(rows).toEqual([
      { key: "audit", cron: "0 12 * * 6", interval_days: null, enabled: false },
      { key: "backup", cron: "17 3 * * *", interval_days: null, enabled: false },
      { key: "digest", cron: "0 14 * * 2", interval_days: 14, enabled: false },
      { key: "keepwarm", cron: "*/10 * * * *", interval_days: null, enabled: true },
      { key: "kpi_weekly", cron: "0 15 * * 6", interval_days: null, enabled: true },
      { key: "newsletter_hygiene", cron: "0 16 * * *", interval_days: null, enabled: true },
      { key: "prune", cron: "30 3 * * *", interval_days: null, enabled: true },
      { key: "reconcile", cron: "*/15 * * * *", interval_days: null, enabled: true },
    ]);
  });

  it("gives every channel a zone, and an insert without tz is refused", async () => {
    const result = await withRollback(async (db) => {
      await db.query(seed());
      const channels = (
        await db.query<{ channel: string; tz: string | null }>(
          "select channel, posting_window ->> 'tz' as tz from public.channel_settings order by channel",
        )
      ).rows;
      await db.query("delete from public.channel_settings where channel = 'youtube'");
      const refused = await attempt(
        db,
        `insert into public.channel_settings (channel, posting_window) values ('youtube', '{"days": [1]}')`,
      );
      return { channels, refused };
    });
    expect(result.channels.map((row) => row.channel)).toEqual([
      "facebook",
      "instagram",
      "linkedin",
      "newsletter",
      "x",
      "youtube",
    ]);
    expect(result.channels.filter((row) => row.tz === null || row.tz === "")).toEqual([]);
    expect(result.refused).toMatch(/^23514 /);
  });

  it("seeds six decline reasons in order, other with no paragraph and no em dash", async () => {
    const rows = await withRollback(async (db) => {
      await db.query(seed());
      return (
        await db.query<{ code: string; email_paragraph: string }>(
          "select code, email_paragraph from public.decline_reasons order by sort, code",
        )
      ).rows;
    });
    expect(rows.map((row) => row.code)).toEqual([
      "not_a_fit",
      "outside_markets",
      "new_development",
      "insufficient_material",
      "rights_unclear",
      "other",
    ]);
    expect(rows.find((row) => row.code === "other")?.email_paragraph).toBe("");
    expect(rows.filter((row) => row.email_paragraph.includes("\u2014"))).toEqual([]);
  });

  it("run twice in one transaction, the seed adds no revision the second time", async () => {
    const counts = await withRollback(async (db) => {
      const count = async () =>
        (await one<{ n: number }>(db, "select count(*)::int as n from public.automation_revisions"))
          .n;
      await db.query(seed());
      const first = await count();
      await db.query(seed());
      return { first, second: await count() };
    });
    expect(counts.second).toBe(counts.first);
  });
});

describe("schedules migration (step 4)", () => {
  it("removes B8's prune pg_cron job and keeps the runner's own jobs", async () => {
    const jobs = await withRollback(async (db) => {
      // B8's job as its migration schedules it, so the case holds before and after mop-dev runs this file.
      await db.query("select cron.schedule('prune', '30 3 * * *', 'select 1')");
      await db.query(migration("_automation_schedules.sql"));
      return (await db.query<{ jobname: string }>("select jobname from cron.job order by 1")).rows;
    });
    const names = jobs.map((job) => job.jobname);
    expect(names).not.toContain("prune");
    expect(names).not.toContain("reconcile_uploads");
    expect(names).toEqual(
      expect.arrayContaining(["health", "job-runner", "meta_token_refresh", "retention"]),
    );
  });
});

// H1 follow-ups (g7 steps 4 and 10): the SQL the fail and health drills use to claim and remove their own rows
// (`scripts/harden/drill-rows.ts`). Every case runs in one rolled-back transaction (F22); each reads the rows it made, so
// rows already on mop-dev change no outcome.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  emailDrillRows,
  healthEventOf,
  removeFailDrillRows,
  retireDrillAgent,
} from "../../scripts/harden/drill-rows";
import { createAuthUser, withRollback, type Db } from "../fixtures/db";

const reader = (db: Db) => ({
  rows: async (text: string, params: unknown[] = []) =>
    (await db.query<Record<string, string | null>>(text, params)).rows,
});

async function text(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  const row = (await db.query<{ value: string }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.value;
}

async function insertJob(
  db: Db,
  type: string,
  payload: unknown,
  createdAgo: string,
  finishedAgo: string | null,
): Promise<string> {
  return text(
    db,
    `insert into public.jobs (type, payload, idempotency_key, status, created_at, finished_at)
     values ($1, $2::jsonb, $3, 'done', now() - $4::interval,
       case when $5::text is null then null else now() - $5::interval end)
     returning id::text as value`,
    [type, JSON.stringify(payload), `drill-rows:${randomUUID()}`, createdAgo, finishedAgo],
  );
}

async function insertEvent(db: Db, checks: string[], ago: string): Promise<string> {
  return text(
    db,
    `insert into public.events (type, entity, payload, at)
     values ('health.failed', 'system', $1::jsonb, now() - $2::interval)
     returning id::text as value`,
    [JSON.stringify({ failed: checks.map((check) => ({ check, message: "forced" })) }), ago],
  );
}

describe("healthEventOf", () => {
  it("finds the event written inside the job's run window for the check, and no other", async () => {
    await withRollback(async (db) => {
      const jobId = await insertJob(db, "health", {}, "2 minutes", "1 minute");
      await insertEvent(db, ["dead_jobs_24h"], "5 minutes");
      await insertEvent(db, ["dead_jobs_24h"], "30 seconds");
      await insertEvent(db, ["storage_percent"], "90 seconds");
      const own = await insertEvent(db, ["dead_jobs_24h", "storage_percent"], "90 seconds");
      expect(await healthEventOf(reader(db), jobId, "dead_jobs_24h")).toBe(own);
    });
  });

  it("answers undefined when the only matching event lies outside the window", async () => {
    await withRollback(async (db) => {
      const jobId = await insertJob(db, "health", {}, "2 minutes", "1 minute");
      await insertEvent(db, ["dead_jobs_24h"], "10 minutes");
      expect(await healthEventOf(reader(db), jobId, "dead_jobs_24h")).toBeUndefined();
    });
  });

  it("throws when two events for the check fall inside the window", async () => {
    await withRollback(async (db) => {
      const jobId = await insertJob(db, "health", {}, "2 minutes", "1 minute");
      await insertEvent(db, ["dead_jobs_24h"], "100 seconds");
      await insertEvent(db, ["dead_jobs_24h"], "80 seconds");
      await expect(healthEventOf(reader(db), jobId, "dead_jobs_24h")).rejects.toThrow(
        /2 health\.failed events/,
      );
    });
  });

  it("reads a job with no finished_at as open until now", async () => {
    await withRollback(async (db) => {
      const jobId = await insertJob(db, "health", {}, "2 minutes", null);
      const own = await insertEvent(db, ["dead_jobs_24h"], "10 seconds");
      expect(await healthEventOf(reader(db), jobId, "dead_jobs_24h")).toBe(own);
    });
  });
});

describe("emailDrillRows", () => {
  const ADDRESS = "bounced@resend.dev";

  async function insertMessage(
    db: Db,
    to: string,
    jobId: string | null,
    createdAgo: string,
  ): Promise<string> {
    return text(
      db,
      `insert into public.email_messages (template_key, kind, to_email, status, job_id, created_at)
       values ('received', 'test', $1, 'skipped', $2, now() - $3::interval)
       returning id::text as value`,
      [to, jobId, createdAgo],
    );
  }

  it("finds the drill's message, its send_email job and that job's events, and nothing older or foreign", async () => {
    await withRollback(async (db) => {
      const start = await text(db, "select (now() - interval '1 hour')::text as value");
      const job = await insertJob(
        db,
        "send_email",
        { data: { actor_email: ADDRESS } },
        "5 minutes",
        null,
      );
      const message = await insertMessage(db, ADDRESS, job, "5 minutes");
      const events = (
        await db.query<{ id: string }>(
          "select id::text as id from public.job_events where job_id = $1",
          [job],
        )
      ).rows.map((row) => row.id);
      await db.query("insert into public.job_events (job_id, kind) values ($1, 'done')", [job]);
      const old = await insertJob(
        db,
        "send_email",
        { data: { actor_email: ADDRESS } },
        "3 hours",
        null,
      );
      await insertMessage(db, ADDRESS, old, "3 hours");
      const foreign = await insertJob(
        db,
        "send_email",
        { data: { actor_email: "a@example.test" } },
        "5 minutes",
        null,
      );
      await insertMessage(db, "a@example.test", foreign, "5 minutes");

      const found = await emailDrillRows(reader(db), ADDRESS, start);
      expect(found.email_messages).toEqual([message]);
      expect(found.jobs).toEqual([job]);
      const all = (
        await db.query<{ id: string }>(
          "select id::text as id from public.job_events where job_id = $1",
          [job],
        )
      ).rows.map((row) => row.id);
      expect([...(found.job_events ?? [])].sort()).toEqual([...all].sort());
      expect(all.length).toBeGreaterThan(events.length);
    });
  });

  it("finds a send_email job by the address in its payload when no message was written", async () => {
    await withRollback(async (db) => {
      const start = await text(db, "select (now() - interval '1 hour')::text as value");
      const job = await insertJob(
        db,
        "send_email",
        { data: { actor_email: ADDRESS } },
        "1 minute",
        null,
      );
      const found = await emailDrillRows(reader(db), ADDRESS, start);
      expect(found.jobs).toEqual([job]);
      expect(found.email_messages).toEqual([]);
    });
  });
});

describe("retireDrillAgent", () => {
  async function agent(db: Db) {
    const userId = await createAuthUser(db);
    const email = await text(db, "select email as value from auth.users where id = $1", [userId]);
    await db.query(
      `insert into public.user_roles (user_id, role, actor_kind, display_name)
       values ($1, 'media_ops', 'agent', 'Drill rows test agent')`,
      [userId],
    );
    const keyId = await text(
      db,
      `insert into public.agent_keys (user_id, key_hash, label, scopes)
       values ($1, $2, 'drill-rows test', '{jobs}') returning id::text as value`,
      [userId, `hash-${randomUUID()}`],
    );
    return { userId, email, keyId };
  }

  it("deletes the key row and disables the role of that user only", async () => {
    await withRollback(async (db) => {
      const mine = await agent(db);
      const other = await agent(db);
      await retireDrillAgent(reader(db), mine.keyId, mine.email);
      const keys = await db.query<{ id: string }>(
        "select id::text as id from public.agent_keys where id = any($1::uuid[])",
        [[mine.keyId, other.keyId]],
      );
      expect(keys.rows.map((row) => row.id)).toEqual([other.keyId]);
      const roles = await db.query<{ user_id: string; disabled: boolean }>(
        "select user_id::text as user_id, disabled_at is not null as disabled from public.user_roles where user_id = any($1::uuid[]) order by user_id",
        [[mine.userId, other.userId]],
      );
      expect(Object.fromEntries(roles.rows.map((row) => [row.user_id, row.disabled]))).toEqual({
        [mine.userId]: true,
        [other.userId]: false,
      });
    });
  });
});

describe("removeFailDrillRows", () => {
  it("lists the run's rows from the database, retires the agent, and leaves other rows out", async () => {
    await withRollback(async (db) => {
      const start = await text(db, "select (now() - interval '1 hour')::text as value");
      const userId = await createAuthUser(db);
      const email = await text(db, "select email as value from auth.users where id = $1", [userId]);
      await db.query(
        "insert into public.user_roles (user_id, role, actor_kind) values ($1, 'media_ops', 'agent')",
        [userId],
      );
      const keyId = await text(
        db,
        `insert into public.agent_keys (user_id, key_hash, label, scopes)
         values ($1, $2, 'drill-rows test', '{jobs}') returning id::text as value`,
        [userId, `hash-${randomUUID()}`],
      );
      const limit = await text(
        db,
        "insert into public.rate_limits (bucket, key_hash) values ($1, 'x') returning id::text as value",
        [`agent:${keyId}`],
      );
      await db.query(
        "insert into public.rate_limits (bucket, key_hash) values ('agent:other', 'x')",
      );
      const dead = await insertJob(db, "test.selftest_light", {}, "10 minutes", null);
      const send = await insertJob(
        db,
        "send_email",
        { data: { actor_email: "bounced@resend.dev" } },
        "9 minutes",
        null,
      );
      const message = await text(
        db,
        `insert into public.email_messages (template_key, kind, to_email, status, job_id)
         values ('received', 'test', 'bounced@resend.dev', 'skipped', $1) returning id::text as value`,
        [send],
      );
      const lists: unknown[] = [];
      await removeFailDrillRows(
        { rows: reader(db).rows, cleanup: (rows) => Promise.resolve(void lists.push(rows)) },
        { start, address: "bounced@resend.dev", agentEmail: email, jobId: dead, keyId },
      );
      expect(lists).toHaveLength(1);
      expect(lists[0]).toMatchObject({
        email_messages: [message],
        jobs: [send, dead],
        rate_limits: [limit],
      });
      const left = await db.query("select 1 from public.agent_keys where id = $1::uuid", [keyId]);
      expect(left.rowCount).toBe(0);
    });
  });
});

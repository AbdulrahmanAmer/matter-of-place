// B8b step 5: the fan-out functions (invariants 4 and 5, JOB-07, DL-10, G58, ruling H34 (2)). Every case runs in one
// rolled-back transaction (F22). An event is written with `at` in the year 2000, so it sorts before any real event
// and `fanout_pending_events(50)` returns it while it is unprocessed and not waiting.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

interface Planned {
  type?: string;
  key?: string;
  status?: "queued" | "waiting_approval";
  run_local?: boolean;
  max_attempts?: number;
  step_id?: string;
  params?: Record<string, unknown>;
  recipe_id?: string | null;
}

interface JobRow {
  status: string;
  msg_id: string | null;
  run_local: boolean;
  max_attempts: number;
  event_id: string | null;
  payload: { params: Record<string, unknown> };
}

interface JobEvent {
  kind: string;
  from_status: string | null;
  to_status: string | null;
  attempt: number;
}

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

async function newEvent(db: Db): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.events (type, entity, payload, at)
     values ('submission.received', 'submission', '{}', '2000-01-01T00:00:00Z') returning id`,
  );
  return id;
}

const planned = ({
  type = "test.job",
  key = `test:${randomUUID()}`,
  status = "queued",
  run_local = false,
  max_attempts = 5,
  step_id = "step",
  params = {},
  recipe_id = null,
}: Planned = {}) => ({
  type,
  payload: { params, data: {} },
  idempotency_key: key,
  heavy: false,
  run_local,
  status,
  recipe_id,
  step_id,
  max_attempts,
});

async function fanout(
  db: Db,
  eventId: string,
  jobs: ReturnType<typeof planned>[],
): Promise<number> {
  const { count } = await one<{ count: number }>(
    db,
    "select public.fanout_insert_jobs($1, $2::jsonb) as count",
    [eventId, JSON.stringify(jobs)],
  );
  return count;
}

const jobsOf = async (db: Db, eventId: string): Promise<JobRow[]> =>
  (
    await db.query<JobRow>(
      `select status, msg_id, run_local, max_attempts, event_id, payload
       from public.jobs where event_id = $1 order by created_at, idempotency_key`,
      [eventId],
    )
  ).rows;

const pendingIds = async (db: Db): Promise<string[]> =>
  (await db.query<{ id: string }>("select id from public.fanout_pending_events(50)")).rows.map(
    (row) => row.id,
  );

describe("fanout_insert_jobs (invariant 4, JOB-07)", () => {
  it("returns 0 and inserts nothing once processed_at is set", async () => {
    const result = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      const first = await fanout(db, eventId, [planned({ key: `test:${randomUUID()}` })]);
      const second = await fanout(db, eventId, [planned({ key: `test:${randomUUID()}` })]);
      return { first, second, jobs: (await jobsOf(db, eventId)).length };
    });
    expect(result).toEqual({ first: 1, second: 0, jobs: 1 });
  });

  it("sets processed_at, which takes the event out of the sweep", async () => {
    const result = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      const before = await pendingIds(db);
      await fanout(db, eventId, []);
      const { processed } = await one<{ processed: boolean }>(
        db,
        "select processed_at is not null as processed from public.events where id = $1",
        [eventId],
      );
      return {
        before: before.includes(eventId),
        processed,
        after: (await pendingIds(db)).includes(eventId),
      };
    });
    expect(result).toEqual({ before: true, processed: true, after: false });
  });

  it("called twice with the same planned jobs inserts them once", async () => {
    const result = await withRollback(async (db) => {
      const first = await newEvent(db);
      const second = await newEvent(db);
      const key = `test:${randomUUID()}`;
      const counts = [
        await fanout(db, first, [planned({ key })]),
        await fanout(db, second, [planned({ key })]),
      ];
      const { n } = await one<{ n: number }>(
        db,
        "select count(*)::int as n from public.jobs where idempotency_key = $1",
        [key],
      );
      return { counts, n };
    });
    expect(result).toEqual({ counts: [1, 0], n: 1 });
  });

  it("gives a queued job a message and a waiting_approval job none", async () => {
    const jobs = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      await fanout(db, eventId, [
        planned({ step_id: "queued", status: "queued" }),
        planned({ step_id: "waiting", status: "waiting_approval" }),
      ]);
      return (await jobsOf(db, eventId)).map((job) => [job.status, job.msg_id !== null]);
    });
    expect(jobs).toEqual(
      expect.arrayContaining([
        ["queued", true],
        ["waiting_approval", false],
      ]),
    );
    expect(jobs).toHaveLength(2);
  });

  it("makes a run_local element a queued job that has no message", async () => {
    const jobs = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      await fanout(db, eventId, [planned({ run_local: true })]);
      return (await jobsOf(db, eventId)).map((job) => [job.status, job.run_local, job.msg_id]);
    });
    expect(jobs).toEqual([["queued", true, null]]);
  });

  it("carries each element's max_attempts to its job", async () => {
    const attempts = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      await fanout(db, eventId, [
        planned({ step_id: "provider", max_attempts: 12 }),
        planned({ step_id: "plain", max_attempts: 7 }),
      ]);
      return (await jobsOf(db, eventId)).map((job) => job.max_attempts).sort((a, b) => a - b);
    });
    expect(attempts).toEqual([7, 12]);
  });

  it("writes the job_events of a direct enqueue_job call: one created row, and none on a repeat", async () => {
    const result = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      const key = `test:${randomUUID()}`;
      await fanout(db, eventId, [planned({ key, max_attempts: 12 })]);
      await fanout(db, eventId, [planned({ key, max_attempts: 12 })]);
      const direct = await one<{ id: string }>(
        db,
        `select public.enqueue_job('test.job', $1::jsonb, $2, false, 'queued'::public.job_status, now(), $3::uuid, null::uuid, 'step',
           p_max_attempts => 12, p_local => false) as id`,
        [JSON.stringify({ params: {}, data: {} }), `test:${randomUUID()}`, eventId],
      );
      const rows = async (where: string, value: string) =>
        (
          await db.query<JobEvent>(
            `select e.kind, e.from_status, e.to_status, e.attempt from public.job_events e
             join public.jobs j on j.id = e.job_id where ${where} = $1 order by e.id`,
            [value],
          )
        ).rows;
      return {
        fanned: await rows("j.idempotency_key", key),
        direct: await rows("j.id::text", direct.id),
      };
    });
    expect(result.fanned).toEqual(result.direct);
    expect(result.fanned.map((row) => row.kind)).toEqual(["created"]);
  });
});

describe("record_fanout_failure and fanout_pending_events (JOB-07)", () => {
  it("backs off to about four minutes on the second failure and leaves the event out until then", async () => {
    const result = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      const waiting = async () => (await pendingIds(db)).includes(eventId);
      const states = [await waiting()];
      await db.query("select public.record_fanout_failure($1, 'first')", [eventId]);
      await db.query("select public.record_fanout_failure($1, 'second')", [eventId]);
      states.push(await waiting());
      const row = await one<{ attempts: number; seconds: number }>(
        db,
        `select attempts, extract(epoch from next_at - now())::int as seconds
         from public.event_fanout_failures where event_id = $1`,
        [eventId],
      );
      await db.query(
        "update public.event_fanout_failures set next_at = now() - interval '1 second' where event_id = $1",
        [eventId],
      );
      states.push(await waiting());
      return { states, attempts: row.attempts, seconds: row.seconds };
    });
    expect(result).toEqual({ states: [true, false, true], attempts: 2, seconds: 240 });
  });

  it("deletes the failure row when the event is planned", async () => {
    const left = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      await db.query("select public.record_fanout_failure($1, 'failed')", [eventId]);
      await fanout(db, eventId, []);
      const { n } = await one<{ n: number }>(
        db,
        "select count(*)::int as n from public.event_fanout_failures where event_id = $1",
        [eventId],
      );
      return n;
    });
    expect(left).toBe(0);
  });
});

describe("a recipe edit after fan-out (invariant 5)", () => {
  it("leaves the job's payload.params as inserted", async () => {
    const params = await withRollback(async (db) => {
      const eventId = await newEvent(db);
      const { id: recipeId } = await one<{ id: string }>(
        db,
        "select id from public.automation_recipes where trigger = 'submission.received'",
      );
      await fanout(db, eventId, [
        planned({
          step_id: "send_received",
          recipe_id: recipeId,
          params: { template: "received" },
        }),
      ]);
      const edited = [
        {
          id: "send_received",
          step_type: "send_email",
          params: { template: "changed" },
          enabled: true,
          requires_approval: false,
          conditions: {},
        },
      ];
      await db.query(
        `select public.automation_put_recipe('submission.received', $1::jsonb, gen_random_uuid(), 'human', 'req-1')`,
        [JSON.stringify({ steps: edited })],
      );
      return (await jobsOf(db, eventId)).map((job) => job.payload.params);
    });
    expect(params).toEqual([{ template: "received" }]);
  });
});

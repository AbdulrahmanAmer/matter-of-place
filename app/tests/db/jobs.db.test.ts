// B8 steps 1, 2 and 2a: the jobs migration, the SQL lifecycle functions (invariants 1, 2, 4 and 5, JOB-02, DB-09,
// DL-10, ruling H34 (2)) and the events B3's public writes emit in their own transaction (G20). Every case runs in a rolled-back transaction except the parallel claim, which needs two
// connections and so commits rows keyed `test:<uuid>` that its cleanup removes (F22).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, committed, withRollback, type Db } from "../fixtures/db";

interface Job {
  status: string;
  attempts: number;
  locked_by: string | null;
  msg_id: string | null;
  run_local: boolean;
  result: unknown;
  error: string | null;
  idempotency_key: string;
  finished_at: Date | null;
}

interface JobEvent {
  kind: string;
  from_status: string | null;
  to_status: string | null;
  attempt: number | null;
  message: string | null;
  data: unknown;
  actor_id: string | null;
}

const testKey = () => `test:${randomUUID()}`;

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

/** A new job of type `test.job`; `named` adds named arguments such as `, p_heavy => true`. */
async function enqueue(db: Db, named = ""): Promise<string> {
  const { id } = await one<{ id: string | null }>(
    db,
    `select public.enqueue_job('test.job', '{"params": {}, "data": {}}', $1${named}) as id`,
    [testKey()],
  );
  if (id === null) throw new Error("enqueue_job returned null for a new key");
  return id;
}

async function claim(db: Db, id: string): Promise<string> {
  const { locked_by } = await one<{ locked_by: string | null }>(
    db,
    "select locked_by from public.claim_job($1)",
    [id],
  );
  if (locked_by === null) throw new Error("claim_job returned no claim");
  return locked_by;
}

async function fail(db: Db, id: string, claimToken: string, named = ""): Promise<boolean> {
  const { ok } = await one<{ ok: boolean }>(
    db,
    `select public.fail_job($1, $2, 'boom'${named}) as ok`,
    [id, claimToken],
  );
  return ok;
}

function job(db: Db, id: string): Promise<Job> {
  return one<Job>(db, "select * from public.jobs where id = $1", [id]);
}

async function events(db: Db, id: string): Promise<JobEvent[]> {
  return (
    await db.query<JobEvent>(
      `select kind, from_status, to_status, attempt, message, data, actor_id
       from public.job_events where job_id = $1 order by id`,
      [id],
    )
  ).rows;
}

async function kinds(db: Db, id: string): Promise<string[]> {
  return (await events(db, id)).map((event) => event.kind);
}

/** Messages for the job waiting in its pgmq queue. */
async function messages(db: Db, id: string, queue = "jobs_light"): Promise<number> {
  const { count } = await one<{ count: number }>(
    db,
    `select count(*)::int as count from pgmq.q_${queue} where message ->> 'job_id' = $1`,
    [id],
  );
  return count;
}

/** Runs `sql` under a savepoint and answers `ok` or the error's SQLSTATE and message (G-102). */
async function outcome(db: Db, sql: string, params: unknown[] = []): Promise<string> {
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

async function ageLock(db: Db, id: string, minutes: number): Promise<void> {
  await db.query(
    "update public.jobs set locked_at = now() - make_interval(mins => $2) where id = $1",
    [id, minutes],
  );
}

async function reap(db: Db): Promise<void> {
  await db.query("select public.reap_stale_jobs()");
}

describe("event type", () => {
  it("emit_event inserts a row of a catalog type", async () => {
    const entityId = randomUUID();
    const row = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(
        db,
        "select public.emit_event('subject_request.received', 'subject_request', $1, $2, null) as id",
        [entityId, { request_id: entityId, kind: "access" }],
      );
      return one<{ type: string; entity_id: string; processed_at: Date | null }>(
        db,
        "select type, entity_id, processed_at from public.events where id = $1",
        [id],
      );
    });
    expect(row).toEqual({
      type: "subject_request.received",
      entity_id: entityId,
      processed_at: null,
    });
  });

  it("emit_event refuses a type outside the catalog with the check violation", async () => {
    const result = await withRollback((db) =>
      outcome(db, "select public.emit_event('foo.bar', 'system', null, '{}', null)"),
    );
    expect(result).toMatch(/^23514 .*events_type_check/);
  });
});

describe("event entity", () => {
  it("job_event_entity_id gives the entity of the job's event, and null for a job without one", async () => {
    const entityId = randomUUID();
    const found = await withRollback(async (db) => {
      const { id: eventId } = await one<{ id: string }>(
        db,
        "select public.emit_event('property.published', 'property', $1, '{}', null) as id",
        [entityId],
      );
      const withEvent = await enqueue(db, `, p_event_id => '${eventId}'`);
      const without = await enqueue(db);
      const read = async (id: string) =>
        (
          await one<{ entity_id: string | null }>(
            db,
            "select public.job_event_entity_id(j) as entity_id from public.jobs j where j.id = $1",
            [id],
          )
        ).entity_id;
      return { withEvent: await read(withEvent), without: await read(without) };
    });
    expect(found).toEqual({ withEvent: entityId, without: null });
  });
});

describe("enqueue_job", () => {
  it("writes one created row and a message, and a repeat of the key returns null and writes nothing", async () => {
    const result = await withRollback(async (db) => {
      const key = testKey();
      const first = await one<{ id: string }>(
        db,
        "select public.enqueue_job('test.job', '{}', $1) as id",
        [key],
      );
      const repeat = await one<{ id: string | null }>(
        db,
        "select public.enqueue_job('test.job', '{}', $1) as id",
        [key],
      );
      return {
        repeat: repeat.id,
        events: await events(db, first.id),
        messages: await messages(db, first.id),
        jobs: (
          await one<{ count: number }>(
            db,
            "select count(*)::int as count from public.jobs where idempotency_key = $1",
            [key],
          )
        ).count,
      };
    });
    expect(result).toEqual({
      repeat: null,
      events: [
        {
          kind: "created",
          from_status: null,
          to_status: "queued",
          attempt: 0,
          message: null,
          data: null,
          actor_id: null,
        },
      ],
      messages: 1,
      jobs: 1,
    });
  });

  it("p_max_attempts 10 keeps the job failed, not dead, after its fifth failure", async () => {
    const after = await withRollback(async (db) => {
      const id = await enqueue(db, ", p_max_attempts => 10");
      for (let attempt = 0; attempt < 5; attempt += 1) await fail(db, id, await claim(db, id));
      return job(db, id);
    });
    expect({ status: after.status, attempts: after.attempts }).toEqual({
      status: "failed",
      attempts: 5,
    });
  });

  it("p_local queues the job with no message, and neither fail_job nor the reaper sends one", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db, ", p_local => true");
      const queued = await job(db, id);
      const queuedMessages = await messages(db, id);
      await fail(db, id, await claim(db, id));
      const failed = await job(db, id);
      const failedMessages = await messages(db, id);
      await db.query(
        "update public.jobs set run_after = now() - interval '6 minutes' where id = $1",
        [id],
      );
      await reap(db);
      return {
        queued: [queued.status, queued.run_local, queued.msg_id, queuedMessages],
        failed: [failed.status, failed.msg_id, failedMessages],
        reaped: [(await job(db, id)).msg_id, await messages(db, id)],
      };
    });
    expect(result).toEqual({
      queued: ["queued", true, null, 0],
      failed: ["failed", null, 0],
      reaped: [null, 0],
    });
  });
});

describe("enqueue_job_manual", () => {
  it("numbers keys :1 and :2, and :3 after :1 is pruned (DB-09)", async () => {
    const entityId = randomUUID();
    const keys = await withRollback(async (db) => {
      const keyOf = async () => {
        const { id } = await one<{ id: string | null }>(
          db,
          "select public.enqueue_job_manual('test.manual', $1, '{}') as id",
          [entityId],
        );
        if (id === null) return null;
        return (await job(db, id)).idempotency_key;
      };
      const first = await keyOf();
      const second = await keyOf();
      await db.query("select set_config('mop.retention', 'on', true)");
      await db.query("delete from public.jobs where idempotency_key = $1", [first]);
      return [first, second, await keyOf()];
    });
    expect(keys).toEqual([
      `test.manual:${entityId}:1`,
      `test.manual:${entityId}:2`,
      `test.manual:${entityId}:3`,
    ]);
  });
});

describe("claim_job", () => {
  it("returns a fresh claim each time, leaves attempts unchanged, and gives a running job to no one", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      const first = await claim(db, id);
      const again = (await db.query("select * from public.claim_job($1)", [id])).rows.length;
      await fail(db, id, first);
      const second = await claim(db, id);
      const after = await job(db, id);
      return {
        fresh: first !== second,
        again,
        attempts: after.attempts,
        status: after.status,
        claimed: (await kinds(db, id)).filter((kind) => kind === "claimed").length,
      };
    });
    expect(result).toEqual({ fresh: true, again: 0, attempts: 1, status: "running", claimed: 2 });
  });

  it("gives the job to exactly one of two parallel claims (committed)", async () => {
    const key = testKey();
    const claims = await committed(
      async (a) => {
        // A message visible an hour from now, so a live runner on the same database never takes this job.
        const { id } = await one<{ id: string }>(
          a,
          "select public.enqueue_job('test.job', '{}', $1, p_run_after => now() + interval '1 hour') as id",
          [key],
        );
        const b = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
        await b.connect();
        try {
          await a.query("begin");
          const first = await a.query("select locked_by from public.claim_job($1)", [id]);
          await b.query("begin");
          // committed() never applies a registered mutation (it would commit it). The second claim applies it in its
          // own transaction, which rolls back, so the replay of watched-fail (e) reaches the race (T-07).
          const mutation = process.env["MOP_MUTATION_SQL"];
          if (mutation !== undefined && mutation !== "") await b.query(mutation);
          const { pid } = await one<{ pid: number }>(b, "select pg_backend_pid() as pid");
          const second = b.query("select locked_by from public.claim_job($1)", [id]);
          // The second claim must be waiting on the first one's row lock before the first commits.
          let waiting = false;
          for (let poll = 0; poll < 50 && !waiting; poll += 1) {
            await a.query("select pg_stat_clear_snapshot()");
            const state = await a.query<{ wait: string | null }>(
              "select wait_event_type as wait from pg_stat_activity where pid = $1",
              [pid],
            );
            waiting = state.rows[0]?.wait === "Lock";
            if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
          }
          await a.query("commit");
          const secondRows = (await second).rows.length;
          await b.query("rollback");
          return { waiting, first: first.rows.length, second: secondRows };
        } finally {
          await b.end();
        }
      },
      async (a) => {
        await a.query("rollback");
        await a.query("begin");
        try {
          await a.query("select set_config('mop.retention', 'on', true)");
          await a.query(
            `select public.job_queue_delete(heavy, msg_id) from public.jobs
             where idempotency_key = $1 and msg_id is not null`,
            [key],
          );
          await a.query("delete from public.jobs where idempotency_key = $1", [key]);
          await a.query("commit");
        } catch (error) {
          // Leaves the connection usable, so the harness still releases its lock.
          await a.query("rollback");
          throw error;
        }
      },
    );
    expect(claims).toEqual({ waiting: true, first: 1, second: 0 });
  });
});

describe("fail_job", () => {
  it("retries with backoff and goes dead at attempt 5", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      const statuses: string[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await fail(db, id, await claim(db, id));
        statuses.push((await job(db, id)).status);
      }
      const dead = await job(db, id);
      return { statuses, attempts: dead.attempts, finished: dead.finished_at !== null };
    });
    expect(result).toEqual({
      statuses: ["failed", "failed", "failed", "failed", "dead"],
      attempts: 5,
      finished: true,
    });
  });

  // The first delay is 30 s plus or minus 20 percent from now(); pgmq counts from the clock, which runs on in the
  // test's transaction, hence the wide upper bound.
  it("a failed retry gets a new message delayed by the backoff", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      const before = (await job(db, id)).msg_id;
      await fail(db, id, await claim(db, id));
      const after = await job(db, id);
      const { delayed } = await one<{ delayed: boolean }>(
        db,
        `select q.vt between now() + interval '23 seconds' and now() + interval '2 minutes' as delayed
         from pgmq.q_jobs_light q where q.msg_id = $1`,
        [after.msg_id],
      );
      return { newMessage: after.msg_id !== before, messages: await messages(db, id), delayed };
    });
    expect(result).toEqual({ newMessage: true, messages: 1, delayed: true });
  });

  it("p_dead sends the job to dead at once", async () => {
    const after = await withRollback(async (db) => {
      const id = await enqueue(db);
      await fail(db, id, await claim(db, id), ", p_dead => true");
      return { job: await job(db, id), kinds: await kinds(db, id) };
    });
    expect({ status: after.job.status, attempts: after.job.attempts, kinds: after.kinds }).toEqual({
      status: "dead",
      attempts: 1,
      kinds: ["created", "claimed", "dead"],
    });
  });
});

describe("finish_job", () => {
  it("p_dispatched keeps the job running under its claim, stores result and writes one dispatched row", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db, ", p_heavy => true");
      const claimToken = await claim(db, id);
      const { ok } = await one<{ ok: boolean }>(
        db,
        "select public.finish_job($1, $2, p_result => $3, p_dispatched => true) as ok",
        [id, claimToken, { spec_hash: "abc" }],
      );
      const after = await job(db, id);
      return {
        ok,
        status: after.status,
        sameClaim: after.locked_by === claimToken,
        result: after.result,
        kinds: await kinds(db, id),
      };
    });
    expect(result).toEqual({
      ok: true,
      status: "running",
      sameClaim: true,
      result: { spec_hash: "abc" },
      kinds: ["created", "claimed", "dispatched"],
    });
  });

  it("p_run_url writes callback then done, and a second call returns false with no new row", async () => {
    const runUrl = "https://github.com/example/repo/actions/runs/1";
    const result = await withRollback(async (db) => {
      const id = await enqueue(db, ", p_heavy => true");
      const claimToken = await claim(db, id);
      const finish = async () =>
        (
          await one<{ ok: boolean }>(
            db,
            "select public.finish_job($1, $2, p_result => '{\"files\": 1}', p_run_url => $3) as ok",
            [id, claimToken, runUrl],
          )
        ).ok;
      const first = await finish();
      const rows = await events(db, id);
      const second = await finish();
      const after = await job(db, id);
      return {
        first,
        second,
        status: after.status,
        finished: after.finished_at !== null,
        tail: rows.slice(-2).map((row) => [row.kind, row.data]),
        rowsAfterSecond: (await events(db, id)).length - rows.length,
      };
    });
    expect(result).toEqual({
      first: true,
      second: false,
      status: "done",
      finished: true,
      tail: [
        ["callback", { run_url: runUrl }],
        ["done", null],
      ],
      rowsAfterSecond: 0,
    });
  });

  it("a wrong claim returns false and changes nothing", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      await claim(db, id);
      const before = { job: await job(db, id), events: await events(db, id) };
      const { ok } = await one<{ ok: boolean }>(
        db,
        "select public.finish_job($1, 'not-the-claim', p_result => '{\"x\": 1}') as ok",
        [id],
      );
      return { ok, unchanged: { job: await job(db, id), events: await events(db, id) }, before };
    });
    expect(result.ok).toBe(false);
    expect(result.unchanged).toEqual(result.before);
  });
});

describe("reap_stale_jobs", () => {
  it("fails a stale running light job with lease_expired, one attempt used and one stale row", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      await claim(db, id);
      await ageLock(db, id, 6);
      await reap(db);
      const after = await job(db, id);
      return {
        status: after.status,
        attempts: after.attempts,
        error: after.error,
        stale: (await events(db, id))
          .filter((row) => row.kind === "stale")
          .map((row) => row.message),
      };
    });
    expect(result).toEqual({
      status: "failed",
      attempts: 1,
      error: "lease_expired",
      stale: ["lease_expired"],
    });
  });

  it("sends a stale job reaped at attempts = max_attempts - 1 to dead", async () => {
    const after = await withRollback(async (db) => {
      const id = await enqueue(db);
      await db.query("update public.jobs set attempts = max_attempts - 1 where id = $1", [id]);
      await claim(db, id);
      await ageLock(db, id, 6);
      await reap(db);
      return job(db, id);
    });
    expect({ status: after.status, attempts: after.attempts, error: after.error }).toEqual({
      status: "dead",
      attempts: 5,
      error: "lease_expired",
    });
  });

  it("waits 30 minutes for a heavy job's callback, then fails it with callback_timeout", async () => {
    const result = await withRollback(async (db) => {
      const waiting = await enqueue(db, ", p_heavy => true");
      const late = await enqueue(db, ", p_heavy => true");
      for (const id of [waiting, late]) await claim(db, id);
      await ageLock(db, waiting, 10);
      await ageLock(db, late, 31);
      await reap(db);
      const lateJob = await job(db, late);
      return {
        waiting: (await job(db, waiting)).status,
        late: [lateJob.status, lateJob.error, lateJob.attempts],
      };
    });
    expect(result).toEqual({ waiting: "running", late: ["failed", "callback_timeout", 1] });
  });

  it("re-sends a message for a queued job whose message was deleted", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      const before = await job(db, id);
      await db.query("select public.job_queue_delete(false, $1)", [before.msg_id]);
      await db.query(
        "update public.jobs set run_after = now() - interval '6 minutes' where id = $1",
        [id],
      );
      const deleted = await messages(db, id);
      await reap(db);
      const after = await job(db, id);
      return {
        deleted,
        resent: await messages(db, id),
        newMessage: after.msg_id !== null && after.msg_id !== before.msg_id,
      };
    });
    expect(result).toEqual({ deleted: 0, resent: 1, newMessage: true });
  });
});

describe("requeue_job", () => {
  it("with the job's claim and a future run_after stores a new msg_id and keeps attempts", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      await fail(db, id, await claim(db, id));
      const claimToken = await claim(db, id);
      const before = await job(db, id);
      const { ok } = await one<{ ok: boolean }>(
        db,
        `select public.requeue_job($1, p_claim => $2, p_run_after => now() + interval '1 hour',
           p_kind => 'requeued', p_result => '{"sent": 3}') as ok`,
        [id, claimToken],
      );
      const after = await job(db, id);
      const { delayed } = await one<{ delayed: boolean }>(
        db,
        "select q.vt > now() + interval '59 minutes' as delayed from pgmq.q_jobs_light q where q.msg_id = $1",
        [after.msg_id],
      );
      return {
        ok,
        status: after.status,
        attempts: after.attempts,
        result: after.result,
        newMessage: after.msg_id !== null && after.msg_id !== before.msg_id,
        messages: await messages(db, id),
        delayed,
        last: (await kinds(db, id)).at(-1),
      };
    });
    expect(result).toEqual({
      ok: true,
      status: "queued",
      attempts: 1,
      result: { sent: 3 },
      newMessage: true,
      messages: 1,
      delayed: true,
      last: "requeued",
    });
  });

  it("manual_retry takes a dead job back to queued with attempts 0 and no error", async () => {
    const after = await withRollback(async (db) => {
      const id = await enqueue(db);
      await fail(db, id, await claim(db, id), ", p_dead => true");
      await db.query(
        "select public.requeue_job($1, p_claim => null, p_run_after => now(), p_kind => 'manual_retry')",
        [id],
      );
      return {
        job: await job(db, id),
        messages: await messages(db, id),
        last: (await kinds(db, id)).at(-1),
      };
    });
    expect({
      status: after.job.status,
      attempts: after.job.attempts,
      error: after.job.error,
      finished: after.job.finished_at,
      messages: after.messages,
      last: after.last,
    }).toEqual({
      status: "queued",
      attempts: 0,
      error: null,
      finished: null,
      messages: 1,
      last: "manual_retry",
    });
  });

  it("raises invalid_kind for any other kind", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      return outcome(db, "select public.requeue_job($1, null, now(), 'later')", [id]);
    });
    expect(result).toBe("P0001 invalid_kind");
  });
});

describe("cancel_job and approve_job", () => {
  it("cancel_job deletes the message, records the actor, and refuses a second cancel", async () => {
    const actorId = randomUUID();
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      const cancel = async () =>
        (
          await one<{ ok: boolean }>(
            db,
            "select public.cancel_job($1, p_actor_id => $2, p_message => 'not needed') as ok",
            [id, actorId],
          )
        ).ok;
      const first = await cancel();
      const second = await cancel();
      const after = await job(db, id);
      const last = (await events(db, id)).at(-1);
      return {
        first,
        second,
        status: after.status,
        msgId: after.msg_id,
        finished: after.finished_at !== null,
        messages: await messages(db, id),
        last: [last?.kind, last?.actor_id, last?.message],
      };
    });
    expect(result).toEqual({
      first: true,
      second: false,
      status: "cancelled",
      msgId: null,
      finished: true,
      messages: 0,
      last: ["cancelled", actorId, "not needed"],
    });
  });

  it("approve_job queues a waiting job with a message and refuses a second approval", async () => {
    const actorId = randomUUID();
    const result = await withRollback(async (db) => {
      const id = await enqueue(db, ", p_status => 'waiting_approval'");
      const waitingMessages = await messages(db, id);
      const approve = async () =>
        (
          await one<{ ok: boolean }>(db, "select public.approve_job($1, p_actor_id => $2) as ok", [
            id,
            actorId,
          ])
        ).ok;
      const first = await approve();
      const second = await approve();
      const last = (await events(db, id)).at(-1);
      return {
        waitingMessages,
        first,
        second,
        status: (await job(db, id)).status,
        messages: await messages(db, id),
        last: [last?.kind, last?.actor_id],
      };
    });
    expect(result).toEqual({
      waitingMessages: 0,
      first: true,
      second: false,
      status: "queued",
      messages: 1,
      last: ["approved", actorId],
    });
  });
});

describe("append-only", () => {
  it("updating events.payload as the service role raises", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(
        db,
        "select public.emit_event('health.failed', 'system', null, '{}', null) as id",
      );
      await asRole(db, "service_role");
      return outcome(db, `update public.events set payload = '{"x": 1}' where id = $1`, [id]);
    });
    expect(result).toBe("P0001 append_only");
  });

  it("setting events.processed_at once succeeds and a second set raises", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(
        db,
        "select public.emit_event('health.failed', 'system', null, '{}', null) as id",
      );
      await asRole(db, "service_role");
      const mark = "update public.events set processed_at = now() where id = $1";
      return [await outcome(db, mark, [id]), await outcome(db, mark, [id])];
    });
    expect(result).toEqual(["ok", "P0001 append_only"]);
  });

  it("updating a job_events row raises", async () => {
    const result = await withRollback(async (db) => {
      const id = await enqueue(db);
      await asRole(db, "service_role");
      return outcome(db, "update public.job_events set message = 'x' where job_id = $1", [id]);
    });
    expect(result).toBe("P0001 append_only");
  });

  it("events and job_events refuse a delete unless mop.retention is on", async () => {
    const result = await withRollback(async (db) => {
      const { id: eventId } = await one<{ id: string }>(
        db,
        "select public.emit_event('health.failed', 'system', null, '{}', null) as id",
      );
      const id = await enqueue(db);
      const deletes = async () => [
        await outcome(db, "delete from public.job_events where job_id = $1", [id]),
        await outcome(db, "delete from public.events where id = $1", [eventId]),
      ];
      const refused = await deletes();
      await db.query("select set_config('mop.retention', 'on', true)");
      return { refused, retention: await deletes() };
    });
    expect(result).toEqual({
      refused: ["P0001 append_only", "P0001 append_only"],
      retention: ["ok", "ok"],
    });
  });
});

// B8 step 8: one health_counts read serves six checks of the daily health job, with a fixed p_now (the transaction's
// now()). Each case first quiets the shared database (every waiting, failed or dead job cancelled), so a count comes
// from the case's own rows.
interface Counts {
  dead_jobs_24h: number;
  stale_queue: number;
  retention_stalled: string[];
  long_waits: number;
  local_oldest_age_s: number | null;
  backup: { enabled: boolean; last_run_at: string | null } | null;
}

async function quietJobs(db: Db): Promise<void> {
  await db.query(
    `update public.jobs set status = 'cancelled', finished_at = now() - interval '30 days'
     where status in ('queued', 'failed', 'dead')`,
  );
}

async function counts(db: Db): Promise<Counts> {
  const { result } = await one<{ result: Counts }>(
    db,
    "select public.health_counts(now()) as result",
  );
  return result;
}

/** A job inserted directly, with the columns the counts read set relative to now(). */
async function jobAt(
  db: Db,
  {
    status,
    finishedHours = null,
    runAfterMinutes = 0,
    createdDays = 0,
    local = false,
  }: {
    status: string;
    finishedHours?: number | null;
    runAfterMinutes?: number;
    createdDays?: number;
    local?: boolean;
  },
): Promise<void> {
  await db.query(
    `insert into public.jobs (type, idempotency_key, status, run_local, finished_at, run_after, created_at)
     values ('test.job', $1, $2::public.job_status, $3,
       now() - make_interval(hours => $4::int), now() - make_interval(mins => $5),
       now() - make_interval(days => $6))`,
    [testKey(), status, local, finishedHours, runAfterMinutes, createdDays],
  );
}

async function policy(db: Db, key: string, lastRunDays: number): Promise<void> {
  await db.query(
    `insert into public.retention_policies (key, table_name, keep_for, action, last_run_at)
     values ($1, 'jobs', interval '1 day', 'delete', now() - make_interval(days => $2))`,
    [key, lastRunDays],
  );
}

describe("health_counts", () => {
  it("counts a dead job finished 23 hours earlier in dead_jobs_24h and not one finished 25 hours earlier", async () => {
    const result = await withRollback(async (db) => {
      await quietJobs(db);
      await jobAt(db, { status: "dead", finishedHours: 23 });
      await jobAt(db, { status: "dead", finishedHours: 25 });
      return (await counts(db)).dead_jobs_24h;
    });
    expect(result).toBe(1);
  });

  it("counts a queued job 16 minutes overdue in stale_queue and not one 14 minutes overdue", async () => {
    const result = await withRollback(async (db) => {
      await quietJobs(db);
      await jobAt(db, { status: "queued", runAfterMinutes: 16 });
      await jobAt(db, { status: "queued", runAfterMinutes: 14 });
      return (await counts(db)).stale_queue;
    });
    expect(result).toBe(1);
  });

  it("lists an enabled delete policy last run 3 days ago in retention_stalled and not one run 1 day ago", async () => {
    const result = await withRollback(async (db) => {
      await policy(db, "test_stalled", 3);
      await policy(db, "test_fresh", 1);
      return (await counts(db)).retention_stalled;
    });
    expect(result).toContain("test_stalled");
    expect(result).not.toContain("test_fresh");
  });

  it("lists a policy whose last retention.run left rows behind", async () => {
    const result = await withRollback(async (db) => {
      await policy(db, "test_remaining", 0);
      await policy(db, "test_cleared", 0);
      await db.query(
        `insert into public.audit_log (action, entity, after)
         values ('retention.run', 'retention',
           '{"test_remaining": {"affected": 1, "remaining": 2}, "test_cleared": {"affected": 1, "remaining": 0}}')`,
      );
      return (await counts(db)).retention_stalled;
    });
    expect(result).toContain("test_remaining");
    expect(result).not.toContain("test_cleared");
  });

  it("counts a queued job created 8 days earlier in long_waits and not one created 6 days earlier", async () => {
    const result = await withRollback(async (db) => {
      await quietJobs(db);
      await jobAt(db, { status: "queued", createdDays: 8 });
      await jobAt(db, { status: "queued", createdDays: 6 });
      return (await counts(db)).long_waits;
    });
    expect(result).toBe(1);
  });

  it("leaves a run_local job out of stale_queue and long_waits and reports its age, null with none", async () => {
    const result = await withRollback(async (db) => {
      await quietJobs(db);
      const before = (await counts(db)).local_oldest_age_s;
      await jobAt(db, {
        status: "queued",
        local: true,
        runAfterMinutes: 60 * 24 * 8,
        createdDays: 8,
      });
      const after = await counts(db);
      return {
        before,
        stale: after.stale_queue,
        long: after.long_waits,
        age: after.local_oldest_age_s,
      };
    });
    expect(result).toEqual({ before: null, stale: 0, long: 0, age: 8 * 24 * 3600 });
  });

  it("returns backup null while the schedule_settings backup row is absent", async () => {
    const backup = await withRollback(async (db) => {
      await db.query("delete from public.schedule_settings where key = 'backup'");
      return (await counts(db)).backup;
    });
    expect(backup).toBeNull();
  });

  it("returns the backup row enabled flag and last run time", async () => {
    const backup = await withRollback(async (db) => {
      await db.query(
        `insert into public.schedule_settings (key, cron, enabled, last_run_at)
         values ('backup', '0 2 * * *', true, '2026-10-01T03:00:00Z')
         on conflict (key) do update set enabled = excluded.enabled, last_run_at = excluded.last_run_at`,
      );
      return (await counts(db)).backup;
    });
    expect(backup?.enabled).toBe(true);
    expect(new Date(backup?.last_run_at ?? "").toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});

interface Emitted {
  entity_id: string;
  payload: unknown;
}

/** Every `type` event of this transaction: `at` defaults to `now()`, the transaction's start, so no other row matches. */
async function emitted(db: Db, type: string): Promise<Emitted[]> {
  const result = await db.query<Emitted>(
    "select entity_id, payload from public.events where type = $1 and at = now()",
    [type],
  );
  return result.rows;
}

const testEmail = () => `test+${randomUUID()}@example.invalid`;

async function upsertSubscriber(
  db: Db,
  email: string,
  source: string,
  sealedToken: string | null,
): Promise<string> {
  const { id } = await one<{ id: string }>(db, "select public.upsert_subscriber($1) as id", [
    {
      email,
      source,
      markets: [],
      confirm_token_hash: `test-${randomUUID()}`,
      sealed_token: sealedToken,
    },
  ]);
  return id;
}

describe("public write events (step 2a)", () => {
  it("create_submission emits one submission.received, and its 10-minute repeat returns the same id with still one row", async () => {
    const result = await withRollback(async (db) => {
      const payload = {
        address: "1 Test Way",
        city: "Berkeley",
        state: "California",
        zip: "94702",
        property_type: "Residence",
        submitter_kind: "agent",
        submitter_name: "Test Agent",
        submitter_email: testEmail(),
        brokerage: "Test Brokerage",
        story: "x",
        significance: "x",
        package: "The Feature",
        source_path: "/__test",
        rights_version: "test-v1",
        rights_confirmed_at: "2026-10-01T00:00:00Z",
        rights_ip_hash: "test-hash",
        media: [],
      };
      const sql = "select id from public.create_submission($1)";
      const first = await one<{ id: string }>(db, sql, [payload]);
      const repeat = await one<{ id: string }>(db, sql, [payload]);
      return { first, repeat, rows: await emitted(db, "submission.received") };
    });
    expect(result.repeat.id).toBe(result.first.id);
    expect(result.rows).toEqual([
      { entity_id: result.first.id, payload: { submission_id: result.first.id } },
    ]);
  });

  it("confirm_subscriber emits one subscriber.confirmed for a valid hash and none for a wrong one", async () => {
    const result = await withRollback(async (db) => {
      const hash = `test-${randomUUID()}`;
      const { id } = await one<{ id: string }>(db, "select public.upsert_subscriber($1) as id", [
        {
          email: testEmail(),
          source: "stories",
          markets: [],
          confirm_token_hash: hash,
          sealed_token: null,
        },
      ]);
      const wrong = await one<{ id: string | null }>(
        db,
        "select public.confirm_subscriber($1) as id",
        [`test-${randomUUID()}`],
      );
      const afterWrong = await emitted(db, "subscriber.confirmed");
      const valid = await one<{ id: string | null }>(
        db,
        "select public.confirm_subscriber($1) as id",
        [hash],
      );
      return { id, wrong, afterWrong, valid, rows: await emitted(db, "subscriber.confirmed") };
    });
    expect(result.wrong.id).toBeNull();
    expect(result.afterWrong).toEqual([]);
    expect(result.valid.id).toBe(result.id);
    expect(result.rows).toEqual([{ entity_id: result.id, payload: { subscriber_id: result.id } }]);
  });

  it("create_inquiry emits one inquiry.received with the inquiry id", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(db, "select id from public.create_inquiry($1)", [
        {
          intent: "ask",
          name: "Test Visitor",
          email: testEmail(),
          message: "x",
          source_path: "/__test",
        },
      ]);
      return { id, rows: await emitted(db, "inquiry.received") };
    });
    expect(result.rows).toEqual([{ entity_id: result.id, payload: { inquiry_id: result.id } }]);
  });

  it("create_subject_request emits one subject_request.received with the request id and kind", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(
        db,
        "select id from public.create_subject_request($1)",
        [{ email: testEmail(), kind: "correction", ip_hash: "test-hash", turnstile_ok: true }],
      );
      return { id, rows: await emitted(db, "subject_request.received") };
    });
    expect(result.rows).toEqual([
      { entity_id: result.id, payload: { request_id: result.id, kind: "correction" } },
    ]);
  });

  it("upsert_subscriber emits subscriber.created with the sealed token for a new address, and none once it is confirmed", async () => {
    const result = await withRollback(async (db) => {
      const email = testEmail();
      const id = await upsertSubscriber(db, email, "stories", "sealed-one");
      await db.query("update public.subscribers set confirmed_at = now() where id = $1", [id]);
      await upsertSubscriber(db, email, "stories", "sealed-two");
      return { id, rows: await emitted(db, "subscriber.created") };
    });
    expect(result.rows).toEqual([
      { entity_id: result.id, payload: { subscriber_id: result.id, sealed_token: "sealed-one" } },
    ]);
  });

  it("upsert_subscriber emits one subscriber.created for a confirmed interest address given a Place Notes source (DL-06)", async () => {
    const result = await withRollback(async (db) => {
      const email = testEmail();
      const id = await upsertSubscriber(db, email, "interest:california", null);
      await db.query("update public.subscribers set confirmed_at = now() where id = $1", [id]);
      await upsertSubscriber(db, email, "stories", "sealed-notes");
      return { id, rows: await emitted(db, "subscriber.created") };
    });
    expect(result.rows).toEqual([
      { entity_id: result.id, payload: { subscriber_id: result.id, sealed_token: "sealed-notes" } },
    ]);
  });

  it("upsert_subscriber without a sealed_token emits nothing", async () => {
    const rows = await withRollback(async (db) => {
      const email = testEmail();
      await upsertSubscriber(db, email, "stories", null);
      await upsertSubscriber(db, email, "stories", null);
      return emitted(db, "subscriber.created");
    });
    expect(rows).toEqual([]);
  });
});

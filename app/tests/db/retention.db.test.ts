// B8 steps 8 and 8a: prune and retention (GD-03, G16, G43). Every case runs in a rolled-back transaction, finds its
// rows by id or key and never by a count of the shared database, and takes every time from the transaction's now().
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

const testKey = () => `test:${randomUUID()}`;

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

async function exists(db: Db, sql: string, params: unknown[]): Promise<boolean> {
  return (await db.query(sql, params)).rows.length > 0;
}

/** A job in `status` that finished `days` before now(), with one job_events row. */
async function finishedJob(db: Db, status: string, days: number): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.jobs (type, idempotency_key, status, finished_at)
     values ('test.job', $1, $2::public.job_status, now() - make_interval(days => $3))
     returning id`,
    [testKey(), status, days],
  );
  await db.query("insert into public.job_events (job_id, kind) values ($1, 'created')", [id]);
  return id;
}

const jobExists = (db: Db, id: string) =>
  exists(db, "select 1 from public.jobs where id = $1", [id]);
const jobEventsExist = (db: Db, id: string) =>
  exists(db, "select 1 from public.job_events where job_id = $1", [id]);

async function prune(db: Db, dryRun = false): Promise<number> {
  const { count } = await one<{ count: number }>(
    db,
    `select public.prune_jobs(
       (select keep_for from public.retention_policies where key = 'jobs_done'), $1) as count`,
    [dryRun],
  );
  return count;
}

async function deleteRows(db: Db, key: string, dryRun = false): Promise<number> {
  const { count } = await one<{ count: number }>(
    db,
    "select public.retention_delete_rows($1, $2) as count",
    [key, dryRun],
  );
  return count;
}

async function rateLimit(db: Db, hours: number): Promise<string> {
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.rate_limits (bucket, key_hash, at) values ('test', $1, now() - make_interval(hours => $2))
     returning id::text`,
    [randomUUID(), hours],
  );
  return id;
}

async function receipt(db: Db, days: number): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.webhook_receipts (provider, id, received_at)
     values ('test', $1, now() - make_interval(days => $2))`,
    [id, days],
  );
  return id;
}

const rateLimitExists = (db: Db, id: string) =>
  exists(db, "select 1 from public.rate_limits where id = $1::bigint", [id]);
const receiptExists = (db: Db, id: string) =>
  exists(db, "select 1 from public.webhook_receipts where provider = 'test' and id = $1", [id]);

describe("prune", () => {
  it("prune_jobs deletes a done job 31 days old with its job_events and keeps one 29 days old", async () => {
    const result = await withRollback(async (db) => {
      const old = await finishedJob(db, "done", 31);
      const young = await finishedJob(db, "done", 29);
      await prune(db);
      return {
        old: await jobExists(db, old),
        oldEvents: await jobEventsExist(db, old),
        young: await jobExists(db, young),
        youngEvents: await jobEventsExist(db, young),
      };
    });
    expect(result).toEqual({ old: false, oldEvents: false, young: true, youngEvents: true });
  });

  it("prune_jobs keeps a dead job 31 days old and records the run on jobs_done", async () => {
    const result = await withRollback(async (db) => {
      const dead = await finishedJob(db, "dead", 31);
      await finishedJob(db, "cancelled", 31);
      const count = await prune(db);
      const policy = await one<{ ran: boolean; last_count: number }>(
        db,
        "select last_run_at = now() as ran, last_count from public.retention_policies where key = 'jobs_done'",
      );
      return { dead: await jobExists(db, dead), count, policy };
    });
    expect(result.dead).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);
    expect(result.policy).toEqual({ ran: true, last_count: result.count });
  });

  it("deletes a rate_limits row 26 hours old and keeps one 3 hours old", async () => {
    const result = await withRollback(async (db) => {
      const old = await rateLimit(db, 26);
      const young = await rateLimit(db, 3);
      await deleteRows(db, "rate_limits");
      return { old: await rateLimitExists(db, old), young: await rateLimitExists(db, young) };
    });
    expect(result).toEqual({ old: false, young: true });
  });

  it("deletes a webhook_receipts row 31 days old and keeps one 29 days old", async () => {
    const result = await withRollback(async (db) => {
      const old = await receipt(db, 31);
      const young = await receipt(db, 29);
      await deleteRows(db, "webhook_receipts");
      return { old: await receiptExists(db, old), young: await receiptExists(db, young) };
    });
    expect(result).toEqual({ old: false, young: true });
  });

  it("retention_delete_rows('audit_log') raises and deletes nothing", async () => {
    const result = await withRollback(async (db) => {
      await db.query("savepoint refused");
      const error = await deleteRows(db, "audit_log").then(
        () => null,
        (caught: unknown) => (caught instanceof Error ? caught.message : String(caught)),
      );
      await db.query("rollback to savepoint refused");
      return error;
    });
    expect(result).toBe("bad_request");
  });

  it("a dry run counts and changes nothing, rows or policy", async () => {
    const result = await withRollback(async (db) => {
      const job = await finishedJob(db, "done", 31);
      const limit = await rateLimit(db, 26);
      const old = await receipt(db, 31);
      await db.query(
        "update public.retention_policies set last_run_at = null, last_count = null where key in ('jobs_done', 'rate_limits', 'webhook_receipts')",
      );
      const counts = [
        await prune(db, true),
        await deleteRows(db, "rate_limits", true),
        await deleteRows(db, "webhook_receipts", true),
      ];
      const { untouched } = await one<{ untouched: boolean }>(
        db,
        `select bool_and(last_run_at is null and last_count is null) as untouched
         from public.retention_policies where key in ('jobs_done', 'rate_limits', 'webhook_receipts')`,
      );
      return {
        counted: counts.every((count) => count >= 1),
        job: await jobExists(db, job),
        limit: await rateLimitExists(db, limit),
        receipt: await receiptExists(db, old),
        untouched,
      };
    });
    expect(result).toEqual({
      counted: true,
      job: true,
      limit: true,
      receipt: true,
      untouched: true,
    });
  });
});

// Step 8a: the retention functions. A period is always the policy row's own keep_for.
const SUBMISSION = `insert into public.submissions (
    address, city, state, zip, property_type, submitter_kind, submitter_name, submitter_email, story, significance,
    package, source_path, rights_version, rights_confirmed_at, rights_ip_hash, workflow_state, contact_id,
    reviewed_at, accepted_at, updated_at
  ) values (
    '1 Test Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'Test Person', $5, 'x',
    'x', 'The Feature', '/submit', 'test-v1', now(), 'test-hash', $1::public.submission_state, $2,
    now() - make_interval(days => $3), case when $1 = 'Declined' then null else now() end,
    now() - make_interval(days => $4)
  ) returning id`;

const email = () => `test-${randomUUID()}@example.test`;

/** A request in `state`, reviewed `reviewedDays` ago and last changed `updatedDays` ago. */
async function request(
  db: Db,
  state: string,
  {
    reviewedDays = 0,
    updatedDays = 0,
    contactId = null,
  }: { reviewedDays?: number; updatedDays?: number; contactId?: string | null } = {},
): Promise<string> {
  const { id } = await one<{ id: string }>(db, SUBMISSION, [
    state,
    contactId,
    reviewedDays,
    updatedDays,
    email(),
  ]);
  return id;
}

async function upload(db: Db, submissionId: string): Promise<string> {
  const id = randomUUID();
  await db.query(
    "insert into public.submission_media (id, submission_id, name, storage_path) values ($1, $2, 'a.jpg', $3)",
    [id, submissionId, `${submissionId}/${id}.jpg`],
  );
  return id;
}

/**
 * The property of a request, with each photograph `stored` (its variants exist) or `staged`: a new original waits in
 * staging while the old variants still have their key (a row without a key is always staged, by its check).
 */
async function propertyOf(
  db: Db,
  submissionId: string,
  photos: ("stored" | "staged")[],
): Promise<void> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.properties (slug, title, market_slug, city, state, address, type, submission_id)
     values ($1, 'Test house', 'california', 'Berkeley', 'CA', '1 Test Way', 'Residence', $2) returning id`,
    [`test-${randomUUID()}`, submissionId],
  );
  for (const [n, photo] of photos.entries()) {
    await db.query(
      `insert into public.property_media (property_id, media_key, staging_path, orientation, sort_order)
       values ($1, $2, $3, $4::public.media_orientation, $5)`,
      photo === "stored"
        ? [id, `test/${randomUUID()}`, null, "landscape", n]
        : [id, `test/${randomUUID()}`, `staging/${randomUUID()}.jpg`, "landscape", n],
    );
  }
}

async function listed(db: Db, fn: string, key: string): Promise<string[]> {
  const result = await db.query<{ media_id: string }>(
    `select media_id from public.${fn}((select keep_for from public.retention_policies where key = $1))`,
    [key],
  );
  return result.rows.map((row) => row.media_id);
}

/** Runs a `(p_keep, p_dry_run)` retention function with the period of `key`. */
async function keepRun(db: Db, fn: string, key: string, dryRun = false): Promise<number> {
  const { count } = await one<{ count: number }>(
    db,
    `select public.${fn}((select keep_for from public.retention_policies where key = $1), $2) as count`,
    [key, dryRun],
  );
  return count;
}

/** Runs `sql` under a savepoint and answers `ok` or the error message (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof Error) return error.message;
    throw error;
  }
}

describe("retention media", () => {
  it("lists a declined request's media at 91 days and not at 89", async () => {
    const result = await withRollback(async (db) => {
      const old = await upload(db, await request(db, "Declined", { reviewedDays: 91 }));
      const young = await upload(db, await request(db, "Declined", { reviewedDays: 89 }));
      return {
        old,
        young,
        ids: await listed(db, "retention_declined_media", "declined_submission_media"),
      };
    });
    expect(result.ids).toContain(result.old);
    expect(result.ids).not.toContain(result.young);
  });

  it("lists a withdrawn request's media 91 days after its last change and not at 89 (DL-04)", async () => {
    const result = await withRollback(async (db) => {
      const old = await upload(db, await request(db, "Withdrawn", { updatedDays: 91 }));
      const young = await upload(db, await request(db, "Withdrawn", { updatedDays: 89 }));
      return {
        old,
        young,
        ids: await listed(db, "retention_declined_media", "declined_submission_media"),
      };
    });
    expect(result.ids).toContain(result.old);
    expect(result.ids).not.toContain(result.young);
  });

  it("lists an accepted request's originals reviewed 1 day ago once every photograph has its variants", async () => {
    const result = await withRollback(async (db) => {
      const doneRequest = await request(db, "Accepted", { reviewedDays: 1 });
      const done = await upload(db, doneRequest);
      await propertyOf(db, doneRequest, ["stored", "stored"]);
      const stagedRequest = await request(db, "Accepted", { reviewedDays: 1 });
      const staged = await upload(db, stagedRequest);
      await propertyOf(db, stagedRequest, ["stored", "staged"]);
      const emptyRequest = await request(db, "Accepted", { reviewedDays: 1 });
      const empty = await upload(db, emptyRequest);
      await propertyOf(db, emptyRequest, []);
      const ids = await listed(db, "retention_accepted_media", "accepted_submission_media");
      return { done: ids.includes(done), staged: ids.includes(staged), empty: ids.includes(empty) };
    });
    expect(result).toEqual({ done: true, staged: false, empty: false });
  });

  it("retention_delete_media deletes exactly the rows it is given", async () => {
    const result = await withRollback(async (db) => {
      const submission = await request(db, "Declined", { reviewedDays: 91 });
      const gone = await upload(db, submission);
      const kept = await upload(db, submission);
      const { count } = await one<{ count: number }>(
        db,
        "select public.retention_delete_media(array[$1]::uuid[]) as count",
        [gone],
      );
      const rows = await db.query<{ id: string }>(
        "select id from public.submission_media where id = any($1::uuid[])",
        [[gone, kept]],
      );
      return { count, left: rows.rows.map((row) => row.id) };
    });
    expect(result.count).toBe(1);
    expect(result.left).toHaveLength(1);
  });
});

describe("retention rows", () => {
  it("deletes a cron.job_run_details row whose end_time is 8 days old and keeps one 6 days old", async () => {
    const result = await withRollback(async (db) => {
      // postgres may not use runid_seq on mop-dev, so each row brings its own negative runid, which no real run has.
      const insert = `insert into cron.job_run_details (runid, jobid, job_pid, database, username, command, status,
          return_message, start_time, end_time)
        values (-1 - floor(random() * 1e12)::bigint, 0, 0, 'postgres', 'postgres', 'select 1', 'succeeded', 'test',
          now() - make_interval(days => $1), now() - make_interval(days => $1))
        returning runid::text`;
      const { runid: old } = await one<{ runid: string }>(db, insert, [8]);
      const { runid: young } = await one<{ runid: string }>(db, insert, [6]);
      await deleteRows(db, "cron_history");
      const left = await db.query<{ runid: string }>(
        "select runid::text from cron.job_run_details where runid = any($1::bigint[])",
        [[old, young]],
      );
      return { old, young, left: left.rows.map((row) => row.runid) };
    });
    expect(result.left).toEqual([result.young]);
  });

  it("leaves a waiting job created 15 days ago only its newest claimed and newest requeued rows", async () => {
    const result = await withRollback(async (db) => {
      const { id } = await one<{ id: string }>(
        db,
        `insert into public.jobs (type, idempotency_key, status, created_at)
         values ('test.job', $1, 'queued', now() - interval '15 days') returning id`,
        [testKey()],
      );
      await db.query(
        `insert into public.job_events (job_id, kind, at)
         select $1, kind, now() - interval '15 days' + make_interval(hours => h)
           + case kind when 'requeued' then interval '1 minute' else interval '0' end
         from generate_series(0, 23) as h, unnest(array['claimed', 'requeued']) as kind`,
        [id],
      );
      await deleteRows(db, "job_wait_events");
      const left = await db.query<{ kind: string; newest: boolean }>(
        `select kind, at = now() - interval '15 days' + interval '23 hours'
           + case kind when 'requeued' then interval '1 minute' else interval '0' end as newest
         from public.job_events where job_id = $1 order by kind`,
        [id],
      );
      return left.rows;
    });
    expect(result).toEqual([
      { kind: "claimed", newest: true },
      { kind: "requeued", newest: true },
    ]);
  });

  it("deletes a dead job finished 91 days ago with its job_events and keeps one 89 days old", async () => {
    const result = await withRollback(async (db) => {
      const old = await finishedJob(db, "dead", 91);
      const young = await finishedJob(db, "dead", 89);
      const done = await finishedJob(db, "done", 91);
      await deleteRows(db, "jobs_dead");
      return {
        old: await jobExists(db, old),
        oldEvents: await jobEventsExist(db, old),
        young: await jobExists(db, young),
        done: await jobExists(db, done),
      };
    });
    expect(result).toEqual({ old: false, oldEvents: false, young: true, done: true });
  });

  it("deletes an event processed 181 days ago that no job points at, and keeps the others", async () => {
    const result = await withRollback(async (db) => {
      const event = async (days: number | null) =>
        (
          await one<{ id: string }>(
            db,
            `insert into public.events (type, entity, payload, processed_at)
             values ('health.failed', 'system', '{}', now() - make_interval(days => $1::int)) returning id`,
            [days],
          )
        ).id;
      const old = await event(181);
      const young = await event(179);
      const unprocessed = await event(null);
      const referenced = await event(181);
      await db.query(
        "insert into public.jobs (type, idempotency_key, status, event_id) values ('test.job', $1, 'done', $2)",
        [testKey(), referenced],
      );
      await deleteRows(db, "events_processed");
      const left = await db.query<{ id: string }>(
        "select id from public.events where id = any($1::uuid[])",
        [[old, young, unprocessed, referenced]],
      );
      const ids = left.rows.map((row) => row.id);
      const plain = await attempt(db, "delete from public.events where id = $1", [young]);
      return {
        old: ids.includes(old),
        young: ids.includes(young),
        unprocessed: ids.includes(unprocessed),
        referenced: ids.includes(referenced),
        plain,
      };
    });
    expect(result).toEqual({
      old: false,
      young: true,
      unprocessed: true,
      referenced: true,
      plain: "append_only",
    });
  });

  it("deletes a closed subject request 25 months old and keeps an open one and a closed one 23 months old", async () => {
    const result = await withRollback(async (db) => {
      const subject = async (status: string, months: number) =>
        (
          await one<{ id: string }>(
            db,
            `insert into public.subject_requests (email, kind, status, received_at)
             values ($1, 'deletion', $2, now() - make_interval(months => $3)) returning id`,
            [email(), status, months],
          )
        ).id;
      const old = await subject("fulfilled", 25);
      const open = await subject("received", 25);
      const young = await subject("rejected", 23);
      await deleteRows(db, "subject_requests");
      const left = await db.query<{ id: string }>(
        "select id from public.subject_requests where id = any($1::uuid[])",
        [[old, open, young]],
      );
      const ids = left.rows.map((row) => row.id);
      return { old: ids.includes(old), open: ids.includes(open), young: ids.includes(young) };
    });
    expect(result).toEqual({ old: false, open: true, young: true });
  });

  it("deletes an unconfirmed subscriber created 31 days ago and keeps one of 29 days and a confirmed one", async () => {
    const result = await withRollback(async (db) => {
      const subscriber = async (days: number, confirmed: boolean) =>
        (
          await one<{ id: string }>(
            db,
            `insert into public.subscribers (email, source, created_at, confirmed_at)
             values ($1, 'test', now() - make_interval(days => $2),
               case when $3::boolean then now() - make_interval(days => $2) end) returning id`,
            [email(), days, confirmed],
          )
        ).id;
      const old = await subscriber(31, false);
      const young = await subscriber(29, false);
      const confirmed = await subscriber(31, true);
      await deleteRows(db, "unconfirmed_subscribers");
      const left = await db.query<{ id: string }>(
        "select id from public.subscribers where id = any($1::uuid[])",
        [[old, young, confirmed]],
      );
      const ids = left.rows.map((row) => row.id);
      return {
        old: ids.includes(old),
        young: ids.includes(young),
        confirmed: ids.includes(confirmed),
      };
    });
    expect(result).toEqual({ old: false, young: true, confirmed: true });
  });
});

describe("retention anonymise", () => {
  it("anonymises an inquiry 25 months old and drops result.body of its webhook job, and leaves one 23 months old", async () => {
    const result = await withRollback(async (db) => {
      const inquiry = async (months: number) =>
        (
          await one<{ id: string }>(
            db,
            `insert into public.inquiries (intent, name, email, phone, location, message, details, source_path,
               forwarded_payload, received_at)
             values ('ask', 'Test Person', 'person@example.test', '555', 'Berkeley', 'hello', '{"a": 1}', '/contact',
               '{"b": 2}', now() - make_interval(months => $1)) returning id`,
            [months],
          )
        ).id;
      const webhook = async (inquiryId: string) =>
        (
          await one<{ id: string }>(
            db,
            `insert into public.jobs (type, idempotency_key, status, payload, result)
             values ('webhook_omnikom', $1, 'dead', jsonb_build_object('data', jsonb_build_object('inquiry_id', $2::text)),
               '{"body": "hello", "status": 500}') returning id`,
            [testKey(), inquiryId],
          )
        ).id;
      const old = await inquiry(25);
      const young = await inquiry(23);
      const oldJob = await webhook(old);
      const youngJob = await webhook(young);
      await keepRun(db, "retention_anonymise_inquiries", "inquiries_anonymise");
      const row = (id: string) =>
        one<Record<string, unknown>>(
          db,
          `select name, message, phone, location, details, forwarded_payload, anonymised_at is not null as anonymised,
             email = encode(sha256(convert_to('person@example.test', 'UTF8')), 'hex') || '@anonymised.invalid' as hashed
           from public.inquiries where id = $1`,
          [id],
        );
      const jobResult = async (id: string) =>
        (await one<{ result: unknown }>(db, "select result from public.jobs where id = $1", [id]))
          .result;
      return {
        old: await row(old),
        young: await row(young),
        oldJob: await jobResult(oldJob),
        youngJob: await jobResult(youngJob),
      };
    });
    expect(result.old).toEqual({
      name: "",
      message: "",
      phone: null,
      location: null,
      details: {},
      forwarded_payload: null,
      anonymised: true,
      hashed: true,
    });
    expect(result.oldJob).toEqual({ status: 500 });
    expect(result.young).toMatchObject({
      name: "Test Person",
      message: "hello",
      anonymised: false,
    });
    expect(result.youngJob).toEqual({ body: "hello", status: 500 });
  });

  it("a dry run of the anonymise functions counts and changes nothing", async () => {
    const result = await withRollback(async (db) => {
      await db.query(
        `insert into public.inquiries (intent, name, email, message, source_path, received_at)
         values ('ask', 'Test Person', 'person@example.test', 'hello', '/contact', now() - interval '25 months')`,
      );
      const counted = await keepRun(
        db,
        "retention_anonymise_inquiries",
        "inquiries_anonymise",
        true,
      );
      const { left } = await one<{ left: number }>(
        db,
        `select count(*)::int as left from public.inquiries
         where received_at < now() - interval '24 months' and anonymised_at is null`,
      );
      return { counted, left };
    });
    expect(result.counted).toBeGreaterThanOrEqual(1);
    expect(result.left).toBe(result.counted);
  });

  it("anonymises a contact whose only request was declined 25 months ago, with that request, and no other (S55)", async () => {
    const result = await withRollback(async (db) => {
      const contact = async () =>
        (
          await one<{ id: string }>(
            db,
            `insert into public.contacts (kind, name, email, phone, updated_at)
             values ('owner', 'Test Person', $1, '555', now() - interval '30 months') returning id`,
            [email()],
          )
        ).id;
      const old = await contact();
      const oldRequest = await request(db, "Declined", { updatedDays: 25 * 31, contactId: old });
      const young = await contact();
      await request(db, "Declined", { updatedDays: 23 * 30, contactId: young });
      const open = await contact();
      await request(db, "Scheduled", { updatedDays: 30 * 31, contactId: open });
      await keepRun(db, "retention_anonymise_contacts", "contacts_anonymise");
      const person = (id: string) =>
        one<{ name: string; email: string; archived: boolean }>(
          db,
          "select name, email, archived_at is not null as archived from public.contacts where id = $1",
          [id],
        );
      const submitted = await one<{ submitter_name: string; submitter_email: string }>(
        db,
        "select submitter_name, submitter_email from public.submissions where id = $1",
        [oldRequest],
      );
      return {
        old: await person(old),
        young: await person(young),
        open: await person(open),
        submitted,
      };
    });
    expect(result.old.name).toBe("");
    expect(result.old.email).toMatch(/^[0-9a-f]{64}@anonymised\.invalid$/);
    expect(result.old.archived).toBe(true);
    expect(result.submitted).toEqual({ submitter_name: "", submitter_email: result.old.email });
    expect([result.young.name, result.young.archived]).toEqual(["Test Person", false]);
    expect([result.open.name, result.open.archived]).toEqual(["Test Person", false]);
  });

  it("retention_anonymise_email answers 0 while B5's email tables are absent (skipped: email_messages absent)", async () => {
    const result = await withRollback(async (db) => {
      const { absent } = await one<{ absent: boolean }>(
        db,
        "select to_regclass('public.email_messages') is null as absent",
      );
      const { count } = await one<{ count: number }>(
        db,
        "select public.retention_anonymise_email() as count",
      );
      return { absent, count };
    });
    expect(result).toEqual({ absent: true, count: 0 });
  });
});

describe("analytics aggregates", () => {
  /** The name and bounds of the monthly partition `offset` months from the current one, in B2's naming. */
  async function month(db: Db, offset: number) {
    return one<{ name: string; from: string; to: string; day: string }>(
      db,
      `select 'analytics_events_y' || to_char(m, 'YYYY') || 'm' || to_char(m, 'MM') as name,
         (m at time zone 'UTC')::text as "from", ((m + interval '1 month') at time zone 'UTC')::text as "to",
         (m + interval '1 day')::date::text as day
       from (select date_trunc('month', now() at time zone 'UTC') + make_interval(months => $1::int) as m) as t`,
      [offset],
    );
  }

  async function partition(db: Db, offset: number): Promise<{ name: string; day: string }> {
    const { name, from, to, day } = await month(db, offset);
    await db.query(
      `create table if not exists public.${name} partition of public.analytics_events
       for values from ('${from}') to ('${to}')`,
    );
    return { name, day };
  }

  const exists = async (db: Db, name: string) =>
    (
      await one<{ found: boolean }>(db, "select to_regclass($1) is not null as found", [
        `public.${name}`,
      ])
    ).found;

  it("rolls up and drops a 4-month-old partition, keeps a 2-month-old one, and keeps the aggregates (H16)", async () => {
    const result = await withRollback(async (db) => {
      await db.query("set local time zone 'UTC'");
      const old = await partition(db, -4);
      const kept = await partition(db, -2);
      await db.query(
        `insert into public.analytics_events (event, path, data, occurred_at)
         select 'web_vitals', '/', jsonb_build_object('name', 'LCP', 'value', v), $1::date + interval '12 hours'
         from unnest(array[1200, 2000]) as v
         union all
         select 'not_found', '/x', '{}', $1::date + interval '1 day 12 hours' from generate_series(1, 3)`,
        [old.day],
      );
      await db.query("select public.retention_drop_analytics()");
      const aggregates = await db.query<{
        day: string;
        event: string;
        path: string;
        dim: string;
        events: number;
        p75: string | null;
      }>(
        `select day::text, event, path, dim, events, p75::text from public.analytics_daily
         where day in ($1::date, $1::date + 1) order by day, event`,
        [old.day],
      );
      return {
        dropped: !(await exists(db, old.name)),
        kept: await exists(db, kept.name),
        day: old.day,
        aggregates: aggregates.rows,
      };
    });
    expect(result.dropped).toBe(true);
    expect(result.kept).toBe(true);
    const next = new Date(Date.parse(`${result.day}T00:00:00Z`) + 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(result.aggregates).toEqual([
      { day: result.day, event: "web_vitals", path: "/", dim: "LCP", events: 2, p75: "1800" },
      { day: next, event: "not_found", path: "/x", dim: "", events: 3, p75: null },
    ]);
  });

  it("rollup_analytics_daily run twice over a day with raw rows keeps the same events", async () => {
    const result = await withRollback(async (db) => {
      const path = `/test-${randomUUID()}`;
      await db.query(
        `insert into public.analytics_events (event, path, occurred_at)
         select 'page_view', $1, date_trunc('day', now()) - interval '12 hours' from generate_series(1, 3)`,
        [path],
      );
      const rollup = "select public.rollup_analytics_daily(current_date - 1, current_date - 1)";
      await db.query(rollup);
      await db.query(rollup);
      const { events } = await one<{ events: number }>(
        db,
        "select events from public.analytics_daily where event = 'page_view' and path = $1",
        [path],
      );
      return events;
    });
    expect(result).toBe(3);
  });

  it("deletes an analytics_daily row 14 months back and keeps one 12 months back", async () => {
    const result = await withRollback(async (db) => {
      const path = `/test-${randomUUID()}`;
      await db.query(
        `insert into public.analytics_daily (day, event, path, dim, events)
         values ((now() - interval '14 months')::date, 'page_view', $1, '', 1),
           ((now() - interval '12 months')::date, 'page_view', $1, '', 1)`,
        [path],
      );
      await deleteRows(db, "analytics_daily");
      const left = await db.query<{ months: string }>(
        `select extract(year from age(now()::date, day)) * 12 + extract(month from age(now()::date, day)) as months
         from public.analytics_daily where path = $1`,
        [path],
      );
      return left.rows.map((row) => Number(row.months));
    });
    expect(result).toEqual([12]);
  });
});

describe("retention run", () => {
  it("retention_log_run writes exactly one retention.run row with no actor and records each named policy", async () => {
    const result = await withRollback(async (db) => {
      const after = { rate_limits: { affected: 4, remaining: 0 } };
      const { id } = await one<{ id: string }>(db, "select public.retention_log_run($1) as id", [
        after,
      ]);
      const rows = await db.query<{
        actor_id: string | null;
        actor_kind: string | null;
        after: unknown;
      }>(
        `select actor_id, actor_kind, after from public.audit_log
         where action = 'retention.run' and entity = 'retention' and at = now()`,
      );
      const policy = await one<{ ran: boolean; last_count: number }>(
        db,
        "select last_run_at = now() as ran, last_count from public.retention_policies where key = 'rate_limits'",
      );
      return { id: typeof id, rows: rows.rows, policy };
    });
    expect(result.rows).toEqual([
      { actor_id: null, actor_kind: null, after: { rate_limits: { affected: 4, remaining: 0 } } },
    ]);
    expect(result.policy).toEqual({ ran: true, last_count: 4 });
  });

  it("a second run of the retention cron command the same day enqueues no second job", async () => {
    const result = await withRollback(async (db) => {
      const { command } = await one<{ command: string }>(
        db,
        "select command from cron.job where jobname = 'retention'",
      );
      await db.query(command);
      await db.query(command);
      const { jobs } = await one<{ jobs: number }>(
        db,
        `select count(*)::int as jobs from public.jobs
         where idempotency_key = 'retention:' || to_char(now() at time zone 'utc', 'YYYY-MM-DD')`,
      );
      return jobs;
    });
    expect(result).toBe(1);
  });
});

describe("vault and Meta token", () => {
  it("get_vault_secret returns what set_vault_secret stored, and refuses a name outside the allow-list", async () => {
    const result = await withRollback(async (db) => {
      const read = async (name: string) =>
        (
          await one<{ value: string | null }>(db, "select public.get_vault_secret($1) as value", [
            name,
          ])
        ).value;
      await db.query("select public.set_vault_secret('meta_page_token', 'test-meta')");
      await db.query("select public.set_vault_secret('x_oauth_token', 'test-x')");
      await db.query("select public.set_vault_secret('x_oauth_token', 'test-x-2')");
      return {
        meta: await read("meta_page_token"),
        x: await read("x_oauth_token"),
        refused: await attempt(db, "select public.get_vault_secret('job_runner_secret')"),
        refusedWrite: await attempt(db, "select public.set_vault_secret('job_runner_secret', 'x')"),
      };
    });
    expect(result).toEqual({
      meta: "test-meta",
      x: "test-x-2",
      refused: "forbidden",
      refusedWrite: "forbidden",
    });
  });

  it("meta_token_record merges its fields into settings.meta and keeps the others", async () => {
    const result = await withRollback(async (db) => {
      await db.query(
        `insert into public.settings (key, value) values ('meta', '{"page_id": "1", "graph_version": "v21.0"}')
         on conflict (key) do update set value = excluded.value`,
      );
      const { answer } = await one<{ answer: string }>(
        db,
        `select public.meta_token_record(now(), 'ok', '{}', p_expires_at => now() + interval '30 days') as answer`,
      );
      const { value } = await one<{ value: Record<string, unknown> }>(
        db,
        "select value from public.settings where key = 'meta'",
      );
      return { answer, keys: Object.keys(value).sort(), state: value["token_state"] };
    });
    expect(result).toEqual({
      answer: "ok",
      keys: [
        "data_access_expires_at",
        "graph_version",
        "missing_scopes",
        "page_id",
        "token_checked_at",
        "token_expires_at",
        "token_state",
      ],
      state: "ok",
    });
  });

  it("meta_token_record with a new token writes Vault and one secret.rotated row", async () => {
    const result = await withRollback(async (db) => {
      await db.query(
        `insert into public.settings (key, value) values ('meta', '{"page_id": "1"}')
         on conflict (key) do update set value = excluded.value`,
      );
      await db.query(
        "select public.meta_token_record(now(), 'ok', '{}', p_new_token => 'test-renewed')",
      );
      const { value } = await one<{ value: string | null }>(
        db,
        "select public.get_vault_secret('meta_page_token') as value",
      );
      const rows = await db.query<{ actor_id: string | null }>(
        `select actor_id from public.audit_log
         where action = 'secret.rotated' and entity = 'META_PAGE_TOKEN' and at = now()`,
      );
      return { value, rotated: rows.rows };
    });
    expect(result).toEqual({ value: "test-renewed", rotated: [{ actor_id: null }] });
  });

  it("meta_token_record refuses a token state outside ok, dead and scopes_missing", async () => {
    const result = await withRollback((db) =>
      attempt(db, "select public.meta_token_record(now(), 'never', '{}')"),
    );
    expect(result).toBe("invalid_token_state");
  });
});

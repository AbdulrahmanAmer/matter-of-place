// `bun run scripts/harden/retention-drill.ts --env dev` (H1-36, GD-03), with the dev profile loaded. It seeds backdated rows
// on both sides of each retention period (the row the policy removes and a control just inside the period), enqueues the
// `retention` and `prune` system jobs, asks the job runner, waits up to 90 seconds for both to be `done`, and asserts that
// exactly the old rows went: 6 purged and 7 kept. It also compares `retention_policies` with `expectedPolicies` key by key
// and reads the `remaining` counts of the run's audit row. It commits rows and Storage objects to the one database, so it
// refuses production first (ruling H35 (5)), holds the writer lock (G34) and removes what it seeded by H1's cleanup rule
// (the 3 year old `audit_log` row stays: the table is immutable by design).
// Prints `retention ok: purged 6, kept 7`, or the failing check and exit 1.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { z } from "zod";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import { devProject } from "../lib/storage-env.ts";
import { askRunner, enqueue, idsOf, waitForDone } from "./drill-lib.ts";
import { openProbeDb, type ProbeDb } from "./probe-db.ts";

const BUCKET = "submissions";
const DOMAIN = "example.invalid";
type Bucket = ReturnType<SupabaseClient["storage"]["from"]>;
type Check = [label: string, holds: () => Promise<boolean>];

/** One entry per key of architecture 10 and G16: `keep_for` as an interval literal (null: kept for ever) and the action. */
const expectedPolicies: Record<string, { keepFor: string | null; action: string }> = {
  declined_submission_media: { keepFor: "90 days", action: "delete" },
  accepted_submission_media: { keepFor: "0 days", action: "delete" },
  inquiries_anonymise: { keepFor: "24 months", action: "anonymise" },
  contacts_anonymise: { keepFor: "24 months", action: "anonymise" },
  analytics_events: { keepFor: "90 days", action: "delete" },
  analytics_daily: { keepFor: "13 months", action: "delete" },
  subject_requests: { keepFor: "24 months", action: "delete" },
  audit_log: { keepFor: null, action: "keep" },
  jobs_done: { keepFor: "30 days", action: "delete" },
  jobs_dead: { keepFor: "90 days", action: "delete" },
  events_processed: { keepFor: "180 days", action: "delete" },
  unconfirmed_subscribers: { keepFor: "30 days", action: "delete" },
  cron_history: { keepFor: "7 days", action: "delete" },
  job_wait_events: { keepFor: "14 days", action: "delete" },
  rate_limits: { keepFor: "25 hours", action: "delete" },
  webhook_receipts: { keepFor: "30 days", action: "delete" },
  email_pii: { keepFor: "90 days", action: "anonymise" },
};

const runTally = z.record(z.string(), z.object({ remaining: z.number() }));

interface Seeded {
  submissions: string[];
  media: string[];
  paths: string[];
  inquiries: string[];
  jobs: string[];
  events: string[];
  analyticsEvents: string[];
  partitions: string[];
}

interface Media {
  submission: string;
  media: string;
  path: string;
}

interface Analytics {
  id: string;
  partition: string;
  day: string;
}

async function first(db: ProbeDb, text: string, params: unknown[] = []): Promise<string> {
  const value = (await db.rows(text, params))[0]?.["v"];
  if (value === null || value === undefined) throw new Error(`retention drill: no row for ${text}`);
  return value;
}

const count = async (db: ProbeDb, from: string, params: unknown[]) =>
  Number(await first(db, `select count(*)::text as v from ${from}`, params));

async function seedSubmission(
  db: ProbeDb,
  seeded: Seeded,
  bucket: Bucket,
  run: string,
  daysAgo: number,
): Promise<Media> {
  const id = await first(
    db,
    `insert into public.submissions (address, city, state, zip, property_type, submitter_kind, submitter_name,
       submitter_email, story, significance, package, source_path, rights_version, rights_confirmed_at, rights_ip_hash,
       workflow_state, reviewed_at)
     values ('1 H1 Drill Way', 'Berkeley', 'California', '94702', 'Residence', 'owner', 'H1 Drill', $1, 'x', 'x',
       'The Feature', '/submit', 'h1-drill', now(), 'h1-drill', 'Declined', now() - make_interval(days => $2::int))
     returning id::text as v`,
    [`h1-drill+${run}-${String(daysAgo)}@${DOMAIN}`, daysAgo],
  );
  seeded.submissions.push(id);
  const media = crypto.randomUUID();
  const path = `${id}/${media}.jpg`;
  await db.rows(
    "insert into public.submission_media (id, submission_id, name, storage_path, bytes, mime) values ($1, $2, 'h1-drill.jpg', $3, 8, 'image/jpeg')",
    [media, id, path],
  );
  seeded.media.push(media);
  seeded.paths.push(path);
  const { error } = await bucket.upload(path, new TextEncoder().encode("h1-drill"), {
    contentType: "image/jpeg",
  });
  if (error !== null) throw new Error(`retention drill: Storage refused ${path}: ${error.message}`);
  return { submission: id, media, path };
}

async function seedInquiry(
  db: ProbeDb,
  seeded: Seeded,
  run: string,
  monthsAgo: number,
): Promise<string> {
  const id = await first(
    db,
    `insert into public.inquiries (intent, name, email, phone, message, source_path, received_at)
     values ('general', 'H1 Drill', $1, '+15550100', 'h1 drill message', '/contact',
       now() - make_interval(months => $2::int))
     returning id::text as v`,
    [`h1-drill+${run}-${String(monthsAgo)}@${DOMAIN}`, monthsAgo],
  );
  seeded.inquiries.push(id);
  return id;
}

async function seedJob(
  db: ProbeDb,
  seeded: Seeded,
  run: string,
  status: "done" | "dead",
  daysAgo: number,
): Promise<string> {
  const id = await first(
    db,
    `insert into public.jobs (type, payload, idempotency_key, status, finished_at)
     values ('h1_drill', '{}'::jsonb, $1, $2::public.job_status, now() - make_interval(days => $3::int))
     returning id::text as v`,
    [`h1_drill:${run}:${status}:${String(daysAgo)}`, status, daysAgo],
  );
  seeded.jobs.push(id);
  await db.rows(
    "insert into public.job_events (job_id, kind, to_status) values ($1, $2, $3::public.job_status)",
    [id, status, status],
  );
  return id;
}

async function seedEvent(db: ProbeDb, seeded: Seeded, daysAgo: number): Promise<string> {
  const id = await first(
    db,
    "insert into public.events (type, processed_at) values ('digest.due', now() - make_interval(days => $1::int)) returning id::text as v",
    [daysAgo],
  );
  seeded.events.push(id);
  return id;
}

/** A row on the third day of the month `monthsBack` back, in that month's partition, which it creates when it is missing. */
async function seedAnalytics(db: ProbeDb, seeded: Seeded, monthsBack: number): Promise<Analytics> {
  const lower = await first(
    db,
    "select to_char(date_trunc('month', now() at time zone 'utc') - make_interval(months => $1::int), 'YYYY-MM-DD') as v",
    [monthsBack],
  );
  const partition = `analytics_events_y${lower.slice(0, 4)}m${lower.slice(5, 7)}`;
  if (
    (await first(db, "select (to_regclass('public.' || $1) is null)::text as v", [partition])) ===
    "true"
  ) {
    await db.rows(
      `create table public.${partition} partition of public.analytics_events
       for values from ('${lower} 00:00:00+00') to ((('${lower}'::date + interval '1 month')) at time zone 'utc')`,
    );
    seeded.partitions.push(partition);
  }
  const id = await first(
    db,
    `insert into public.analytics_events (event, path, data, occurred_at)
     values ('not_found', '/h1-drill', '{}'::jsonb, ($1::date + 2)::timestamp at time zone 'utc')
     returning id::text as v`,
    [lower],
  );
  seeded.analyticsEvents.push(id);
  return { id, partition, day: await first(db, "select ($1::date + 2)::text as v", [lower]) };
}

async function checkPolicies(db: ProbeDb, start: string): Promise<void> {
  const keepFor = Object.fromEntries(
    Object.entries(expectedPolicies).flatMap(([key, policy]) =>
      policy.keepFor === null ? [] : [[key, policy.keepFor]],
    ),
  );
  const canonical = new Map(
    (
      await db.rows(
        "select k as key, (v::interval)::text as keep_for from jsonb_each_text($1::jsonb) as t(k, v)",
        [JSON.stringify(keepFor)],
      )
    ).map((row) => [row["key"], row["keep_for"]]),
  );
  const rows = await db.rows(
    `select key, keep_for::text as keep_for, action::text as action, (last_run_at >= $1::timestamptz)::text as fresh
     from public.retention_policies order by key`,
    [start],
  );
  for (const row of rows) {
    const key = row["key"] ?? "";
    const expected = expectedPolicies[key];
    if (expected === undefined) throw new Error(`retention drill: policy ${key} is not expected`);
    if (row["action"] !== expected.action || row["keep_for"] !== (canonical.get(key) ?? null)) {
      throw new Error(
        `retention drill: policy ${key} is ${String(row["keep_for"])} ${String(row["action"])}, expected ${String(expected.keepFor)} ${expected.action}`,
      );
    }
    if (expected.action !== "keep" && row["fresh"] !== "true") {
      throw new Error(`retention drill: policy ${key} has no last_run_at from this run`);
    }
  }
  const present = new Set(rows.map((row) => row["key"]));
  for (const key of Object.keys(expectedPolicies)) {
    if (!present.has(key)) throw new Error(`retention drill: policy ${key} is missing`);
  }
}

async function checkRunAudit(db: ProbeDb, start: string): Promise<void> {
  const text = await first(
    db,
    "select after::text as v from public.audit_log where action = 'retention.run' and at >= $1 order by id desc limit 1",
    [start],
  );
  for (const [key, tally] of Object.entries(runTally.parse(JSON.parse(text)))) {
    if (tally.remaining !== 0) {
      throw new Error(`retention drill: ${key} left ${String(tally.remaining)} rows after the run`);
    }
  }
}

async function cleanup(db: ProbeDb, seeded: Seeded, bucket: Bucket): Promise<void> {
  const removed = await bucket.remove(seeded.paths);
  if (removed.error !== null) {
    throw new Error(`cleanup failed storage ${seeded.paths.join(",")}: ${removed.error.message}`);
  }
  await db.cleanup({
    submission_media: seeded.media,
    submissions: seeded.submissions,
    inquiries: seeded.inquiries,
    job_events: await idsOf(
      db,
      "select id::text as id from job_events where job_id::text = any($1::text[])",
      [seeded.jobs],
    ),
    jobs: seeded.jobs,
    events: seeded.events,
  });
  try {
    await db.rows("delete from public.analytics_events where id::text = any($1::text[])", [
      seeded.analyticsEvents,
    ]);
    await db.rows("delete from public.analytics_daily where path = '/h1-drill'");
    for (const partition of seeded.partitions) {
      await db.rows(`drop table if exists public.${partition}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cleanup failed analytics_events ${seeded.analyticsEvents.join(",")}: ${reason}`,
    );
  }
}

async function drill(db: ProbeDb, seeded: Seeded, bucket: Bucket, start: string): Promise<string> {
  const run = Date.now().toString();
  const oldMedia = await seedSubmission(db, seeded, bucket, run, 91);
  const newMedia = await seedSubmission(db, seeded, bucket, run, 89);
  const oldInquiry = await seedInquiry(db, seeded, run, 25);
  const newInquiry = await seedInquiry(db, seeded, run, 23);
  const oldDone = await seedJob(db, seeded, run, "done", 31);
  const newDone = await seedJob(db, seeded, run, "done", 29);
  const oldDead = await seedJob(db, seeded, run, "dead", 91);
  const newDead = await seedJob(db, seeded, run, "dead", 89);
  const oldEvent = await seedEvent(db, seeded, 181);
  const newEvent = await seedEvent(db, seeded, 179);
  const oldAnalytics = await seedAnalytics(db, seeded, 4);
  const newAnalytics = await seedAnalytics(db, seeded, 2);
  const audit = await first(
    db,
    "insert into public.audit_log (at, action, entity, note) values (now() - interval '3 years', 'h1.drill', 'retention', 'h1-drill') returning id::text as v",
  );

  const systemJobs = new Map<string, string>();
  for (const type of ["retention", "prune"]) {
    const id = await enqueue(db, type, { params: {}, data: {} }, `${type}:h1-drill-${run}`);
    seeded.jobs.push(id);
    systemJobs.set(type, id);
  }
  await askRunner();
  for (const [type, id] of systemJobs) await waitForDone(db, id, type, "retention drill");

  const stored = async (path: string) => (await bucket.download(path)).error === null;
  const rows = (from: string, ...params: unknown[]) => count(db, from, params);
  const dropped = async (partition: string) =>
    (await first(db, "select (to_regclass('public.' || $1) is null)::text as v", [partition])) ===
    "true";
  const purged: Check[] = [
    [
      "the 91 day declined submission's media rows and objects (the submission row stays)",
      async () =>
        (await rows("public.submission_media where id = $1", oldMedia.media)) === 0 &&
        !(await stored(oldMedia.path)) &&
        (await rows("public.submissions where id = $1", oldMedia.submission)) === 1,
    ],
    [
      "the 25 month inquiry's name, message, phone and address (the row stays, anonymised)",
      async () =>
        (await rows(
          `public.inquiries where id = $1 and anonymised_at is not null and email like '%@anonymised.invalid'
             and name = '' and message = '' and phone is null`,
          oldInquiry,
        )) === 1,
    ],
    [
      "the 31 day done job and its job_events",
      async () =>
        (await rows("public.jobs where id = $1", oldDone)) === 0 &&
        (await rows("public.job_events where job_id = $1", oldDone)) === 0,
    ],
    ["the 91 day dead job", async () => (await rows("public.jobs where id = $1", oldDead)) === 0],
    [
      "the 181 day processed event",
      async () => (await rows("public.events where id = $1", oldEvent)) === 0,
    ],
    [
      "the 4 month analytics partition, rolled up into analytics_daily first",
      async () =>
        (await dropped(oldAnalytics.partition)) &&
        (await rows(
          "public.analytics_daily where day = $1::date and event = 'not_found' and path = '/h1-drill' and events = 1",
          oldAnalytics.day,
        )) === 1,
    ],
  ];
  const kept: Check[] = [
    [
      "the 89 day declined submission's media row and object",
      async () =>
        (await rows("public.submission_media where id = $1", newMedia.media)) === 1 &&
        (await stored(newMedia.path)),
    ],
    [
      "the 23 month inquiry",
      async () =>
        (await rows(
          "public.inquiries where id = $1 and anonymised_at is null and name = 'H1 Drill'",
          newInquiry,
        )) === 1,
    ],
    [
      "the 29 day done job and its job_events",
      async () =>
        (await rows("public.jobs where id = $1", newDone)) === 1 &&
        (await rows("public.job_events where job_id = $1", newDone)) === 1,
    ],
    ["the 89 day dead job", async () => (await rows("public.jobs where id = $1", newDead)) === 1],
    [
      "the 179 day processed event",
      async () => (await rows("public.events where id = $1", newEvent)) === 1,
    ],
    [
      "the 2 month analytics partition and its row",
      async () => (await rows("public.analytics_events where id = $1", newAnalytics.id)) === 1,
    ],
    [
      "the 3 year old audit row",
      async () => (await rows("public.audit_log where id = $1", audit)) === 1,
    ],
  ];
  for (const [verb, checks] of [
    ["purged", purged],
    ["kept", kept],
  ] as const) {
    for (const [label, holds] of checks) {
      if (!(await holds())) throw new Error(`retention drill: not ${verb}: ${label}`);
    }
  }
  await checkPolicies(db, start);
  await checkRunAudit(db, start);
  return `retention ok: purged ${String(purged.length)}, kept ${String(kept.length)}`;
}

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { env: { type: "string" } } });
  if (values.env !== "dev") {
    console.error("usage: bun run scripts/harden/retention-drill.ts --env dev");
    return 64;
  }
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const project = devProject();
  const bucket = createClient(project.url, project.key, {
    auth: { persistSession: false },
  }).storage.from(BUCKET);
  const db = await openProbeDb(dbUrl ?? "");
  const start = await db.now();
  const seeded: Seeded = {
    submissions: [],
    media: [],
    paths: [],
    inquiries: [],
    jobs: [],
    events: [],
    analyticsEvents: [],
    partitions: [],
  };
  let failure: string | null = null;
  try {
    console.log(await drill(db, seeded, bucket, start));
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  try {
    await cleanup(db, seeded, bucket);
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await db.close();
  }
  if (failure !== null) {
    console.error(failure);
    return 1;
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

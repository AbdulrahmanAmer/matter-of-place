import type { Db } from "../../lib/db.ts";
import { AppError } from "../../lib/errors.ts";
import type { StepContext, SystemJobDefinition } from "../types.ts";
import { isDryRun, readPolicies, type Policy } from "./policies.ts";

// The daily retention job (GD-03, G16, G43): the only code that hard-deletes. It runs policy by policy, each with its
// row's keep_for, records { affected, remaining } per policy, and writes its one audit row through retention_log_run.
// audit_log and automation_revisions are never touched. params.dry_run counts and changes nothing.

const REMOVE_BATCH = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

// A type, not an interface, so a record of them is Json for jobs.result and the audit row.
type Tally = { affected: number; remaining: number };

interface MediaRow {
  media_id: string;
  storage_path: string;
}

type MediaLister = "retention_declined_media" | "retention_accepted_media";
type KeepCounter = "retention_anonymise_inquiries" | "retention_anonymise_contacts";

const POLICY_KEYS = [
  "declined_submission_media",
  "accepted_submission_media",
  "inquiries_anonymise",
  "contacts_anonymise",
  "analytics_events",
  "analytics_daily",
  "subject_requests",
  "jobs_dead",
  "events_processed",
  "email_pii",
  "unconfirmed_subscribers",
  "cron_history",
  "job_wait_events",
] as const;

// The plain row deletes of retention_delete_rows, in order: jobs_dead before events_processed, so a dead job's event
// goes with it once both are old enough (G16).
const ROW_KEYS_BEFORE_EMAIL = [
  "analytics_daily",
  "subject_requests",
  "jobs_dead",
  "events_processed",
];
const ROW_KEYS_AFTER_EMAIL = ["unconfirmed_subscribers", "cron_history", "job_wait_events"];

function unavailable(fn: string): AppError {
  return new AppError("unavailable", undefined, `The job system did not answer (${fn}).`);
}

/** PERF-08 (a): each original has a `<media_id>.thumb.jpg` sibling in its request's folder. */
function thumbnailOf(row: MediaRow): string {
  const folder = row.storage_path.slice(0, row.storage_path.lastIndexOf("/") + 1);
  return `${folder}${row.media_id}.thumb.jpg`;
}

async function listMedia(db: Db, fn: MediaLister, keep: string): Promise<MediaRow[]> {
  const { data, error } = await db.rpc(fn, { p_keep: keep });
  if (error !== null) throw unavailable(fn);
  return data;
}

/**
 * Removes the files in batches, then the rows of exactly the files removed (a missing object counts as removed). A
 * Storage error leaves that batch's rows and throws, so the job runs again.
 */
async function removeMedia(db: Db, rows: MediaRow[]): Promise<number> {
  let removed = 0;
  for (let start = 0; start < rows.length; start += REMOVE_BATCH) {
    const batch = rows.slice(start, start + REMOVE_BATCH);
    const { error } = await db.storage
      .from("submissions")
      .remove(batch.flatMap((row) => [row.storage_path, thumbnailOf(row)]));
    if (error !== null) {
      throw new AppError(
        "storage_unavailable",
        undefined,
        `Storage did not remove ${String(batch.length)} retention files.`,
      );
    }
    const deleted = await db.rpc("retention_delete_media", {
      p_ids: batch.map((row) => row.media_id),
    });
    if (deleted.error !== null) throw unavailable("retention_delete_media");
    removed += deleted.data;
  }
  return removed;
}

async function mediaPolicy(
  db: Db,
  fn: MediaLister,
  policy: Policy,
  dryRun: boolean,
): Promise<Tally> {
  const rows = await listMedia(db, fn, policy.keepFor);
  if (dryRun) return { affected: rows.length, remaining: rows.length };
  const affected = await removeMedia(db, rows);
  return { affected, remaining: (await listMedia(db, fn, policy.keepFor)).length };
}

async function keepCount(db: Db, fn: KeepCounter, keep: string, dryRun: boolean): Promise<number> {
  const { data, error } = await db.rpc(fn, { p_keep: keep, p_dry_run: dryRun });
  if (error !== null) throw unavailable(fn);
  return data;
}

async function anonymisePolicy(
  db: Db,
  fn: KeepCounter,
  policy: Policy,
  dryRun: boolean,
): Promise<Tally> {
  const affected = await keepCount(db, fn, policy.keepFor, dryRun);
  return {
    affected,
    remaining: dryRun ? affected : await keepCount(db, fn, policy.keepFor, true),
  };
}

/** A function whose dry run answers what its real run would change. */
async function counted(run: (dryRun: boolean) => Promise<number>, dryRun: boolean): Promise<Tally> {
  const affected = await run(dryRun);
  return { affected, remaining: dryRun ? affected : await run(true) };
}

async function deleteRows(db: Db, key: string, dryRun: boolean): Promise<number> {
  const { data, error } = await db.rpc("retention_delete_rows", { p_key: key, p_dry_run: dryRun });
  if (error !== null) throw unavailable("retention_delete_rows");
  return data;
}

async function dropAnalytics(db: Db, dryRun: boolean): Promise<number> {
  const { data, error } = await db.rpc("retention_drop_analytics", { p_dry_run: dryRun });
  if (error !== null) throw unavailable("retention_drop_analytics");
  return data;
}

async function anonymiseEmail(db: Db, dryRun: boolean): Promise<number> {
  const { data, error } = await db.rpc("retention_anonymise_email", { p_dry_run: dryRun });
  if (error !== null) throw unavailable("retention_anonymise_email");
  return data;
}

/** Ruling H16: yesterday and the day before, which can still receive beacons, into analytics_daily. */
async function rollupRecentDays(ctx: StepContext): Promise<number> {
  const day = (back: number) =>
    new Date(ctx.now.getTime() - back * DAY_MS).toISOString().slice(0, 10);
  const { data, error } = await ctx.db.rpc("rollup_analytics_daily", {
    p_from: day(2),
    p_to: day(1),
  });
  if (error !== null) throw unavailable("rollup_analytics_daily");
  return data;
}

export const retention: SystemJobDefinition = {
  type: "retention",
  sideEffect: "none",
  timeoutMs: 40_000,
  async run(ctx, params) {
    const { db } = ctx;
    const dryRun = isDryRun(params);
    const policies = await readPolicies(db, POLICY_KEYS);
    const after: Record<string, Tally> = {};
    // Each step runs only while its row is enabled with a period, in the order G16 needs.
    const steps: [string, (policy: Policy) => Promise<Tally>][] = [
      [
        "declined_submission_media",
        (policy) => mediaPolicy(db, "retention_declined_media", policy, dryRun),
      ],
      [
        "accepted_submission_media",
        (policy) => mediaPolicy(db, "retention_accepted_media", policy, dryRun),
      ],
      [
        "inquiries_anonymise",
        (policy) => anonymisePolicy(db, "retention_anonymise_inquiries", policy, dryRun),
      ],
      [
        "contacts_anonymise",
        (policy) => anonymisePolicy(db, "retention_anonymise_contacts", policy, dryRun),
      ],
      ["analytics_events", () => counted((dry) => dropAnalytics(db, dry), dryRun)],
      ...ROW_KEYS_BEFORE_EMAIL.map((key): [string, () => Promise<Tally>] => [
        key,
        () => counted((dry) => deleteRows(db, key, dry), dryRun),
      ]),
      ["email_pii", () => counted((dry) => anonymiseEmail(db, dry), dryRun)],
      ...ROW_KEYS_AFTER_EMAIL.map((key): [string, () => Promise<Tally>] => [
        key,
        () => counted((dry) => deleteRows(db, key, dry), dryRun),
      ]),
    ];

    // The aggregates are written before the partitions they come from can be dropped.
    const rolledUp = dryRun ? 0 : await rollupRecentDays(ctx);
    for (const [key, step] of steps) {
      const policy = policies.get(key);
      if (policy !== undefined) after[key] = await step(policy);
    }
    if (!dryRun) {
      const { error } = await db.rpc("retention_log_run", { p_after: { ...after } });
      if (error !== null) throw unavailable("retention_log_run");
    }
    return {
      status: "done",
      result: { dry_run: dryRun, analytics_rollup: rolledUp, policies: { ...after } },
    };
  },
};

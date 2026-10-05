// B5 step 4a: the email chain on the one database, before L1's launch switch only (ruling H35 (5)). From `app/`:
//   eval "$(node scripts/load-env.mjs --profile dev)"; env -u CLOUDFLARE_API_TOKEN bun run scripts/email-chain.ts
// One test submission through `create_submission` writes `submission.received` in the same transaction (G20); the
// deployed job runner plans it and sends `received` and `admin_notify`. The script prints one line per message,
// `<template_key> <status> <resend_id>`, and deletes its submission at the end. The event row stays: `events` is
// append-only (B2 invariant 3).
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";
import { currentRightsVersion } from "../src/domain/contracts.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

const POLL_MS = 5_000;
// The runner ticks every minute, so three ticks fit.
const GIVE_UP_MS = 180_000;
// Resend's test inbox: it accepts and delivers, and the dev allow-list holds `*@resend.dev`.
const SUBMITTER = "delivered@resend.dev";

interface ChainRow {
  step_id: string | null;
  job_status: string;
  job_error: string | null;
  template_key: string | null;
  status: string | null;
  resend_id: string | null;
  error: string | null;
}

/** A unique address per run, so the 10-minute repeat check of `create_submission` never answers an older row. */
async function createTestSubmission(client: pg.Client): Promise<string> {
  const result = await client.query<{ id: string }>(
    "select id from public.create_submission($1::jsonb)",
    [
      JSON.stringify({
        address: `${String(Date.now())} Email Chain Lane`,
        city: "Malibu",
        state: "California",
        zip: "90265",
        property_type: "Residence",
        submitter_kind: "owner",
        submitter_name: "Email Chain Test",
        submitter_email: SUBMITTER,
        listed_with_agent: false,
        story: "A test submission of the email chain proof.",
        significance: "None: it is deleted when the proof ends.",
        package: "The Feature",
        source_path: "/submit",
        turnstile_ok: true,
        ip_hash: "email-chain",
        rights_version: currentRightsVersion,
        rights_confirmed_at: new Date().toISOString(),
        rights_ip_hash: "email-chain",
      }),
    ],
  );
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error("email-chain: create_submission returned no row");
  return id;
}

async function receivedEvent(client: pg.Client, submissionId: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    "select id from public.events where type = 'submission.received' and entity_id = $1",
    [submissionId],
  );
  const [event, ...more] = result.rows;
  if (event === undefined || more.length > 0) {
    throw new Error(
      `email-chain: ${String(result.rows.length)} submission.received events for the submission, expected 1`,
    );
  }
  return event.id;
}

async function chainRows(client: pg.Client, eventId: string): Promise<ChainRow[]> {
  const result = await client.query<ChainRow>(
    `select j.step_id, j.status::text as job_status, j.error as job_error,
       m.template_key, m.status, m.resend_id, m.error
     from public.jobs j
     left join public.email_messages m on m.job_id = j.id
     where j.event_id = $1
     order by j.created_at, m.created_at`,
    [eventId],
  );
  return result.rows;
}

/** Sent, already delivered, or under a dry run (invariant 16) skipped with a `dry_` id. */
const reached = (row: ChainRow): boolean =>
  row.status === "sent" ||
  row.status === "delivered" ||
  (row.status === "skipped" && row.resend_id?.startsWith("dry_") === true);

const FINAL = new Set(["sent", "delivered", "bounced", "complained", "failed", "skipped"]);

/** The rows once the chain is complete, undefined while it is still running; throws when it went wrong. */
function judge(rows: ChainRow[]): ChainRow[] | undefined {
  const dead = rows.find((row) => row.job_status === "dead");
  if (dead !== undefined) {
    throw new Error(
      `email-chain: job ${dead.step_id ?? "?"} dead: ${dead.job_error ?? "no error"}`,
    );
  }
  const received = rows.filter((row) => row.template_key === "received");
  const [first] = received;
  if (received.length > 1) {
    throw new Error(`email-chain: ${String(received.length)} received messages, expected 1`);
  }
  if (first !== undefined && FINAL.has(first.status ?? "") && !reached(first)) {
    throw new Error(`email-chain: received ${first.status ?? ""} ${first.error ?? "no error"}`);
  }
  const done =
    first !== undefined &&
    reached(first) &&
    rows.some((row) => row.template_key === "admin_notify" && reached(row));
  return done ? rows.filter((row) => row.template_key !== null) : undefined;
}

async function waitForChain(client: pg.Client, eventId: string): Promise<ChainRow[]> {
  const deadline = Date.now() + GIVE_UP_MS;
  for (;;) {
    const rows = await chainRows(client, eventId);
    const complete = judge(rows);
    if (complete !== undefined) return complete;
    if (Date.now() >= deadline) {
      const jobs = rows.map(
        (row) => `${row.step_id ?? "?"} ${row.job_status} ${row.job_error ?? ""}`,
      );
      throw new Error(
        `email-chain: no complete chain within ${String(GIVE_UP_MS / 1000)} s; jobs: ${jobs.join("; ") || "none"}`,
      );
    }
    await sleep(POLL_MS);
  }
}

/** One transaction; `mop.retention` allows the hard delete for it alone (B2 invariant 4). */
async function removeSubmission(client: pg.Client, submissionId: string): Promise<void> {
  await client.query("begin");
  try {
    await client.query("select set_config('mop.retention', 'on', true)");
    await client.query("delete from public.submissions where id = $1", [submissionId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main(): Promise<void> {
  guardEnv();
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const client = new pg.Client({ connectionString: dbUrl });
  let submissionId: string | undefined;
  const release = await holdDevLock();
  try {
    await client.connect();
    submissionId = await createTestSubmission(client);
    const eventId = await receivedEvent(client, submissionId);
    for (const row of await waitForChain(client, eventId)) {
      console.log(`${row.template_key ?? ""} ${row.status ?? ""} ${row.resend_id ?? ""}`.trim());
    }
  } finally {
    try {
      if (submissionId !== undefined) await removeSubmission(client, submissionId);
    } catch (error) {
      console.error(
        `email-chain: cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exitCode = 1;
    } finally {
      await client.end();
      await release();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

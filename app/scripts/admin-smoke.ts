// `bun run scripts/admin-smoke.ts decline` with the dev profile loaded and `bun run dev` serving the site on mop-dev:
// before the launch switch only (it inserts a test request, ruling H35 (5)). It inserts one request, starts its review
// and declines it through the admin API with the agent key `scripts/seed-admin-users.ts` printed (`ADMIN_SMOKE_KEY`),
// then waits up to 90 seconds for the letter the decline's `send_email` job records, and prints
// `<template> <status> <first four characters of the Resend id>`. On mop-dev every send is a dry run until B5 step 5
// sets EMAIL_LIVE, so the line reads `declined skipped dry_`. The request is deleted afterwards; its events, jobs,
// email and audit rows stay (append-only, or pruned by B8's retention).
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { committed, dbNow, type Db } from "../tests/fixtures/db.ts";
import { createSubmission } from "../tests/fixtures/factories.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

const SITE = "http://localhost:8080";
// A real address of our own domain: `send_email` skips a reserved domain, and mop-dev allows only its listed recipients.
const SUBMITTER = "admin+smoke@matterofplace.com";
// The deterministic request of `createSubmission`, so a run after a failed cleanup reuses the row.
const SMOKE_N = 9900;
const WAIT_MS = 90_000;
const POLL_MS = 5_000;
const USAGE = "usage: bun run scripts/admin-smoke.ts decline";

const decisionAnswer = z.object({ event_id: z.string().uuid() });
const letter = z.object({
  template_key: z.string(),
  status: z.string(),
  resend_id: z.string().nullable(),
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`admin-smoke: ${name} is not set`);
  return value;
}

/** One admin API call as the smoke agent; a refusal stops the run with its status and body. */
async function post(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${SITE}/api/admin/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${requiredEnv("ADMIN_SMOKE_KEY")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`admin-smoke: POST ${path} answered ${String(response.status)} ${text}`);
  }
  return JSON.parse(text);
}

async function enabledReason(db: Db): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select id from public.decline_reasons where enabled order by sort, label limit 1",
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("admin-smoke: no enabled decline reason");
  return id;
}

/** The letter of the decline's `send_email` job, once the runner has recorded it. */
async function waitForLetter(db: Db, eventId: string): Promise<z.infer<typeof letter> | null> {
  for (let waited = 0; waited <= WAIT_MS; waited += POLL_MS) {
    const { rows } = await db.query(
      `select template_key, status, resend_id from public.email_messages
       where job_id in (select id from public.jobs where event_id = $1)`,
      [eventId],
    );
    if (rows[0] !== undefined) return letter.parse(rows[0]);
    await sleep(POLL_MS);
  }
  return null;
}

async function declineLeg(): Promise<void> {
  let submissionId: string | undefined;
  const found = await committed(
    async (db) => {
      submissionId = await createSubmission(db, {
        state: "Submitted",
        n: SMOKE_N,
        base: await dbNow(db),
        submitter_kind: "agent",
        submitter_email: SUBMITTER,
      });
      await post("submissions/start-review", { ids: [submissionId] });
      const answer = decisionAnswer.parse(
        await post(`submissions/${submissionId}/decline`, {
          decline_reason_id: await enabledReason(db),
        }),
      );
      return waitForLetter(db, answer.event_id);
    },
    async (db) => {
      if (submissionId === undefined) return;
      // B2's refuse_hard_delete lets a delete of `submissions` through only with the retention flag set.
      await db.query("begin");
      await db.query("select set_config('mop.retention', 'on', true)");
      await db.query("delete from public.submissions where id = $1", [submissionId]);
      await db.query("commit");
    },
  );
  if (found === null) {
    console.log("declined pending");
    process.exitCode = 1;
    return;
  }
  console.log(`${found.template_key} ${found.status} ${(found.resend_id ?? "").slice(0, 4)}`);
}

async function main(): Promise<void> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const leg = process.argv[2];
  if (leg !== "decline") throw new Error(USAGE);
  await declineLeg();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

// `bun run scripts/admin-smoke.ts decline|upload [--render]` with the dev profile loaded and `bun run dev` serving the
// site on mop-dev: before the launch switch only (it inserts test rows, ruling H35 (5)). Both legs call the admin API
// with the agent key `scripts/seed-admin-users.ts` printed (`ADMIN_SMOKE_KEY`).
// `decline` inserts one request, starts its review and declines it, then waits up to 90 seconds for the letter the
// decline's `send_email` job records, and prints `<template> <status> <first four characters of the Resend id>`. On
// mop-dev every send is a dry run until B5 step 5 sets EMAIL_LIVE, so the line reads `declined skipped dry_`.
// `upload` inserts one draft property, stages `tests/fixtures/tiny.jpg` through `media/upload-url` and the signed PUT,
// attaches it and prints `attached staged <staging path>`. With `--render` (once B9's render_variants is deployed) it
// waits up to 600 seconds for the property's render, prints `rendered <media key>` and `media <status>` of
// `/media/<media key>`, and exits 1 naming the job's error when the time runs out.
// Each leg deletes its rows and files afterwards; events, jobs, email and audit rows stay (append-only, or pruned by
// B8's retention).
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { uploadUrlAnswerSchema } from "../src/domain/admin-media.ts";
import { removeStaged } from "../src/server/media/staging.ts";
import { committed, dbNow, type Db } from "../tests/fixtures/db.ts";
import { createSubmission, publishedProperty } from "../tests/fixtures/factories.ts";
import { serviceClient } from "../tests/fixtures/service.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";
import { variantKeys } from "./variants.ts";

const SITE = "http://localhost:8080";
// A real address of our own domain: `send_email` skips a reserved domain, and mop-dev allows only its listed recipients.
const SUBMITTER = "admin+smoke@matterofplace.com";
// The deterministic request of `createSubmission`, so a run after a failed cleanup reuses the row.
const SMOKE_N = 9900;
// The deterministic draft property of the upload leg.
const UPLOAD_N = 9901;
const WAIT_MS = 90_000;
const POLL_MS = 5_000;
const RENDER_WAIT_MS = 600_000;
const RENDER_POLL_MS = 10_000;
const TINY_JPG = new URL("../tests/fixtures/tiny.jpg", import.meta.url);
// The stored master `o/<owner>/<n>-<sha8>.webp` render_variants writes (`variantKeys` in scripts/variants.ts).
const MASTER_KEY = /^o\/([^/]+)\/(\d+)-([0-9a-f]{8})\.webp$/;
const USAGE = "usage: bun run scripts/admin-smoke.ts decline|upload [--render]";

const decisionAnswer = z.object({ event_id: z.string().uuid() });
const letter = z.object({
  template_key: z.string(),
  status: z.string(),
  resend_id: z.string().nullable(),
});
const mediaRow = z.object({
  staging_path: z.string().nullable(),
  media_key: z.string().nullable(),
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

async function mediaRowOf(db: Db, mediaId: string): Promise<z.infer<typeof mediaRow>> {
  const { rows } = await db.query(
    "select staging_path, media_key from public.property_media where id = $1",
    [mediaId],
  );
  return mediaRow.parse(rows[0]);
}

/** The stored key once the property's render has run, or null when the time ran out. */
async function waitForRender(db: Db, mediaId: string): Promise<string | null> {
  for (let waited = 0; waited <= RENDER_WAIT_MS; waited += RENDER_POLL_MS) {
    const row = await mediaRowOf(db, mediaId);
    if (row.staging_path === null && row.media_key !== null) return row.media_key;
    await sleep(RENDER_POLL_MS);
  }
  return null;
}

async function renderError(db: Db, propertyId: string): Promise<string> {
  const { rows } = await db.query<{ error: string | null }>(
    `select error from public.jobs where type = 'render_variants' and payload -> 'data' ->> 'property_id' = $1
     order by created_at desc limit 1`,
    [propertyId],
  );
  return rows[0]?.error ?? "no render_variants job";
}

/** Every key the stored photograph owns in the public bucket `media`. */
function storedKeys(mediaKey: string): string[] {
  const [, owner, n, sha8] = MASTER_KEY.exec(mediaKey) ?? [];
  if (owner === undefined || n === undefined || sha8 === undefined) return [mediaKey];
  return Object.values(variantKeys(owner, Number(n), sha8));
}

async function uploadLeg(render: boolean): Promise<void> {
  // The one-database client (G-901): built from the dev profile's own names, never from the shell's SUPABASE_URL.
  const storage = serviceClient();
  let propertyId: string | undefined;
  let stagingPath: string | undefined;
  let mediaKey: string | null = null;
  await committed(
    async (db) => {
      // `publishedProperty` sets its role with `set local`, so it runs in a transaction of its own.
      await db.query("begin");
      const property = await publishedProperty(db, {
        n: UPLOAD_N,
        editorial_state: "draft",
        published_at: null,
        hero_image: null,
      });
      await db.query("commit");
      propertyId = property.id;
      const bytes = await readFile(TINY_JPG);
      const staged = uploadUrlAnswerSchema.parse(
        await post("media/upload-url", {
          scope: "property",
          target: propertyId,
          mime: "image/jpeg",
          size: bytes.byteLength,
        }),
      );
      stagingPath = staged.path;
      const put = await fetch(staged.url, {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      });
      if (!put.ok) throw new Error(`admin-smoke: the signed PUT answered ${String(put.status)}`);
      const mediaId = staged.media_id ?? "";
      await post("media/attach", {
        property_id: propertyId,
        media_id: mediaId,
        staging_path: staged.path,
      });
      const row = await mediaRowOf(db, mediaId);
      if (row.staging_path !== staged.path || row.media_key !== null) {
        throw new Error(`admin-smoke: the attached row is ${JSON.stringify(row)}`);
      }
      console.log(`attached staged ${row.staging_path}`);
      if (!render) return;
      mediaKey = await waitForRender(db, mediaId);
      if (mediaKey === null) {
        console.log(`render pending: ${await renderError(db, propertyId)}`);
        process.exitCode = 1;
        return;
      }
      console.log(`rendered ${mediaKey}`);
      const served = await fetch(`${SITE}/media/${mediaKey}`, {
        signal: AbortSignal.timeout(30_000),
      });
      console.log(`media ${String(served.status)}`);
      if (served.status !== 200) process.exitCode = 1;
    },
    async (db) => {
      if (stagingPath !== undefined) await removeStaged(storage, stagingPath);
      if (mediaKey !== null) {
        const removed = await storage.storage.from("media").remove(storedKeys(mediaKey));
        if (removed.error !== null) {
          throw new Error(`admin-smoke: media cleanup: ${removed.error.message}`);
        }
      }
      if (propertyId === undefined) return;
      // B2's refuse_hard_delete lets a delete of `properties` through only with the retention flag set.
      await db.query("begin");
      await db.query("select set_config('mop.retention', 'on', true)");
      await db.query("delete from public.property_media where property_id = $1", [propertyId]);
      await db.query("delete from public.properties where id = $1", [propertyId]);
      await db.query("commit");
    },
  );
}

async function main(): Promise<void> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const leg = process.argv[2];
  if (leg === "decline") await declineLeg();
  else if (leg === "upload") await uploadLeg(process.argv.includes("--render"));
  else throw new Error(USAGE);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

// `bun run scripts/harden/upload-probe.ts <base>` (H1-11), with the dev profile loaded, against a Worker that holds
// Turnstile's always-pass test secret (E10). Through `POST /api/public/submissions` it sends (1) a photograph declared
// one byte over 25 MiB and (2) one declared `image/svg+xml`, each must be 422 `validation` with no row; then (3) a valid
// submission whose one photograph is an `.exe` renamed `.jpg`: it PUTs those bytes to the signed URL it gets back
// (Storage takes them, the type is only declared), then 26 MiB to the same URL, which the bucket's `file_size_limit`
// refuses. It enqueues one `reconcile` system job (G10) with `data.since` at the probe's start, asks the job runner
// when `JOB_RUNNER_SECRET` is set (else the runner's minute tick takes it) and waits up to 90 seconds for `done`; the
// job must count a deleted object and the `.exe` must be gone from the `submissions` bucket. It commits rows and an
// object to the one database, so it refuses production first (ruling H35 (5)), holds the writer lock (G34), removes
// the object and then its rows by H1's cleanup rule. Prints `upload ok`, or the failing check and exit 1.
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import { devProject } from "../lib/storage-env.ts";
import { openProbeDb, type ProbeDb } from "./probe-db.ts";

const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
// The IP bucket of a local Worker is keyed on the `cf-connecting-ip` it is sent; a new documentation address per run
// keeps the hits other lanes make from 127.0.0.1 out of this run's bucket (rate-probe.ts says why).
const CLIENT_IP = `2001:db8::${Date.now().toString(16)}`;
const BUCKET = "submissions";
const MAX_BYTES = 26_214_400;
const OVERSIZE_PUT_BYTES = 26 * 1024 * 1024;
const JOB_WAIT_MS = 90_000;
const POLL_MS = 3000;
const TIMEOUT_MS = 60_000;
// A Windows executable's first bytes, then padding: what a renamed `.exe` holds.
const EXE = Buffer.concat([
  Buffer.from("MZ\x90\x00\x03\x00\x00\x00", "latin1"),
  Buffer.alloc(4088, 0x41),
]);

const receipt = z.object({
  id: z.string().uuid(),
  uploads: z.array(z.object({ media_id: z.string(), url: z.string().url() })).length(1),
});
const failure = z.object({ error: z.object({ code: z.string() }) });
const jobResult = z.object({ uploads: z.object({ deleted: z.number().int() }) });

function submission(email: string, media: { name: string; size: number; type: string }[]) {
  return {
    address: "1 Probe Lane",
    city: "Los Angeles",
    state: "California",
    zip: "90001",
    currency: "USD",
    propertyType: "Residence",
    submitterKind: "owner",
    submitterName: "H1 Probe",
    submitterEmail: email,
    story: "An upload probe of the hardening slice.",
    significance: "None; it is removed when the probe ends.",
    package: "The Feature",
    rightsConfirmed: true,
    media,
    sourcePath: "/submit",
  };
}

const post = (base: string, body: unknown) =>
  fetch(`${base}/api/public/submissions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-turnstile-token": TOKEN,
      "cf-connecting-ip": CLIENT_IP,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

const put = (url: string, bytes: Uint8Array) =>
  fetch(url, {
    method: "PUT",
    headers: { "content-type": "image/jpeg" },
    body: bytes,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

async function ids(db: ProbeDb, text: string, params: unknown[]): Promise<string[]> {
  return (await db.rows(text, params)).flatMap((row) =>
    row["id"] === null || row["id"] === undefined ? [] : [row["id"]],
  );
}

/** Cases (1) and (2): a 422 `validation` and no submission row for that address. */
async function refused(
  base: string,
  db: ProbeDb,
  email: string,
  media: { name: string; size: number; type: string },
) {
  const response = await post(base, submission(email, [media]));
  const body = failure.safeParse(await response.json());
  const rows = await ids(db, "select id::text as id from submissions where submitter_email = $1", [
    email,
  ]);
  if (response.status !== 422 || body.data?.error.code !== "validation" || rows.length !== 0) {
    throw new Error(
      `upload probe: ${media.type} of ${String(media.size)} bytes answered ${String(response.status)} ${body.data?.error.code ?? "?"} with ${String(rows.length)} rows`,
    );
  }
}

async function waitForJob(db: ProbeDb, jobId: string): Promise<z.infer<typeof jobResult>> {
  const deadline = Date.now() + JOB_WAIT_MS;
  let status = "missing";
  while (Date.now() < deadline) {
    const [row] = await db.rows(
      "select status::text as status, result::text as result from jobs where id = $1",
      [jobId],
    );
    status = row?.["status"] ?? "missing";
    if (status === "done") return jobResult.parse(JSON.parse(row?.["result"] ?? "null"));
    if (status === "dead") break;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`upload probe: reconcile ${status}`);
}

async function askRunner(): Promise<void> {
  const secret = process.env["JOB_RUNNER_SECRET"];
  if (secret === undefined || secret === "") return;
  const response = await fetch(`${devProject().url}/functions/v1/job-runner`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await response.body?.cancel();
}

async function main(): Promise<number> {
  const base = process.argv[2]?.replace(/\/+$/, "");
  if (base === undefined || !URL.canParse(base)) {
    console.error("usage: bun run scripts/harden/upload-probe.ts <base>");
    return 64;
  }
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const project = devProject();
  const storage = createClient(project.url, project.key, {
    auth: { persistSession: false },
  }).storage.from(BUCKET);
  const db = await openProbeDb(dbUrl ?? "");
  const start = await db.now();
  const run = Date.now().toString();
  const email = (label: string) => `h1-upload+${run}-${label}@example.invalid`;
  let submissionId: string | undefined;
  let jobId: string | undefined;
  try {
    await refused(base, db, email("oversize"), {
      name: "large.jpg",
      size: MAX_BYTES + 1,
      type: "image/jpeg",
    });
    await refused(base, db, email("svg"), {
      name: "drawing.svg",
      size: 512,
      type: "image/svg+xml",
    });

    const created = await post(
      base,
      submission(email("exe"), [{ name: "photo.jpg", size: EXE.byteLength, type: "image/jpeg" }]),
    );
    if (created.status !== 201)
      throw new Error(
        `upload probe: the submission answered ${String(created.status)}: ${await created.text()}`,
      );
    const sent = receipt.parse(await created.json());
    submissionId = sent.id;
    const upload = sent.uploads[0];
    if (upload === undefined) throw new Error("upload probe: no signed URL");
    const first = await put(upload.url, EXE);
    await first.body?.cancel();
    if (!first.ok) throw new Error(`upload probe: the .exe PUT answered ${String(first.status)}`);
    const oversize = await put(upload.url, new Uint8Array(OVERSIZE_PUT_BYTES));
    const oversizeText = await oversize.text();
    if (oversize.ok)
      throw new Error(`upload probe: the 26 MiB PUT was taken (${String(oversize.status)})`);
    console.log(
      `26 MiB PUT refused by Storage: ${String(oversize.status)} ${oversizeText.slice(0, 120)}`,
    );

    const [{ id: queued = null } = {}] = await db.rows(
      "select public.enqueue_job(p_type => 'reconcile', p_payload => $1::jsonb, p_idempotency_key => $2)::text as id",
      [JSON.stringify({ params: {}, data: { since: start } }), `reconcile:h1-probe-${run}`],
    );
    if (queued === null) throw new Error("upload probe: enqueue_job answered no job");
    jobId = queued;
    await askRunner();
    const result = await waitForJob(db, jobId);
    const [media] = await db.rows(
      "select storage_path from submission_media where submission_id = $1",
      [submissionId],
    );
    const kept = await storage.download(media?.["storage_path"] ?? "");
    const gone =
      kept.error !== null &&
      /NoSuchKey|not.?found/i.test(`${kept.error.message} ${JSON.stringify(kept.error)}`);
    if (result.uploads.deleted < 1 || !gone) {
      throw new Error(
        `upload probe: reconcile deleted ${String(result.uploads.deleted)} and the .exe is ${kept.error === null ? "still stored" : "unreadable"}`,
      );
    }
    console.log(`reconcile done: ${String(result.uploads.deleted)} deleted`);
    console.log("upload ok");
    return 0;
  } finally {
    await cleanup(db, storage, submissionId, jobId, start);
  }
}

async function cleanup(
  db: ProbeDb,
  storage: ReturnType<ReturnType<typeof createClient>["storage"]["from"]>,
  submissionId: string | undefined,
  jobId: string | undefined,
  start: string,
): Promise<void> {
  try {
    const submissions = submissionId === undefined ? [] : [submissionId];
    const paths = (
      await db.rows(
        "select storage_path from submission_media where submission_id::text = any($1::text[])",
        [submissions],
      )
    ).flatMap((row) =>
      row["storage_path"] === null || row["storage_path"] === undefined
        ? []
        : [row["storage_path"], row["storage_path"].replace(/\.[^./]+$/, ".thumb.jpg")],
    );
    if (paths.length > 0) {
      const removed = await storage.remove(paths);
      if (removed.error !== null)
        throw new Error(`cleanup failed storage ${paths.join(",")}: ${removed.error.message}`);
    }
    const events = await ids(
      db,
      "select id::text as id from events where entity = 'submission' and entity_id::text = any($1::text[])",
      [submissions],
    );
    const jobs = [
      ...(jobId === undefined ? [] : [jobId]),
      ...(await ids(db, "select id::text as id from jobs where event_id::text = any($1::text[])", [
        events,
      ])),
    ];
    await db.cleanup({
      submission_media: await ids(
        db,
        "select id::text as id from submission_media where submission_id::text = any($1::text[])",
        [submissions],
      ),
      submissions,
      contacts: await ids(
        db,
        "select contact_id::text as id from submissions where id::text = any($1::text[])",
        [submissions],
      ),
      job_events: await ids(
        db,
        "select id::text as id from job_events where job_id::text = any($1::text[])",
        [jobs],
      ),
      jobs,
      events,
      rate_limits: await ids(
        db,
        "select id::text as id from rate_limits where bucket like 'submissions:%' and at >= $1",
        [start],
      ),
    });
  } finally {
    await db.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

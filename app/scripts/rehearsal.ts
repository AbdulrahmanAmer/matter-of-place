// L1 step 2: the rehearsal of the whole path on the one database in its preview stage, before the launch switch.
// `bun run scripts/rehearsal.ts --env dev --base <url> --property scripts/fixtures/first-property.json` from `app/`, with
// the dev profile loaded (`eval "$(node scripts/load-env.mjs --profile dev)"`). Every row writes test rows, so the first
// call is the production guard (ruling H35 (5)); `--env` accepts only `dev`. It holds the `mop-dev-tests` lock for the
// whole run (G34), prints its start time first, filters every evidence query on that time, and prints the timeline.
// A human row prints `WAIT <screen> <what>` and polls every 10 s for up to 30 minutes. Exit 0 only when every row is
// `ok`; the one BLOCKED it may print is the Omnikom mock (row 10), repeated on the last line.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { z } from "zod";
import {
  createFromSubmissionAnswerSchema,
  propertyDetailSchema,
  publishAnswerSchema,
  versionAnswerSchema,
} from "../src/domain/admin-properties.ts";
import { reorderAnswerSchema } from "../src/domain/admin-media.ts";
import {
  decisionAnswerSchema,
  startReviewAnswerSchema,
  submissionDetailSchema,
} from "../src/domain/admin-submissions.ts";
import { inquirySchema, receiptSchema, submissionSchema } from "../src/domain/contracts.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { pgClientConfig } from "./lib/pg-connect.mjs";
import { requireSecret, runScript } from "./lib/social-script.ts";

const USAGE =
  "usage: bun run scripts/rehearsal.ts --env dev [--base <url>] --property scripts/fixtures/first-property.json";
const APP = new URL("../", import.meta.url);
// Cloudflare's always-pass token, which the dev and preview Turnstile test secret accepts.
const TURNSTILE_PASS = "XXXX.DUMMY.TOKEN.XXXX";
const OMNIKOM_MOCK = "https://omnikom-mock.holy-meadow-4327.workers.dev";
const POLL_MS = 10_000;
const HUMAN_WAIT_MS = 30 * 60_000;
const JOB_WAIT_MS = 20 * 60_000;
const DIGEST_CRON = "0 14 * * 2";
const RENDER_JOBS = [
  "render_variants",
  "render_cover",
  "render_carousel",
  "render_story",
  "write_captions",
  "build_newsletter_block",
];
const POST_JOBS = ["post_meta", "post_x", "post_linkedin"];
// Every actor step of rows 2 to 5, as `audit_log.action` names it (the matrix action).
const AGENT_ACTIONS = [
  "submissions.start_review",
  "submissions.decline",
  "submissions.accept",
  "payments.issue",
  "properties.create_from_submission",
  "properties.update",
  "media.reorder",
  "properties.rank",
];

const fixtureSchema = z.object({
  propertyFixture: z.string(),
  extraPhotographs: z.array(z.string()),
  submission: z.record(z.unknown()),
  duplicate: z.record(z.unknown()),
  invoice: z.object({ product: z.string(), preferredMethod: z.string() }),
  property: z.record(z.unknown()),
  photoOrder: z.array(z.number().int().nonnegative()),
  ranks: z.object({ hero_rank: z.number().int(), featured_rank: z.number().int() }),
  newsletter: z.object({ approver: z.string(), audience: z.array(z.string()).length(3) }),
  inquiry: z.object({
    intent: z.string(),
    name: z.string(),
    email: z.string(),
    message: z.string(),
  }),
});
const b9FixtureSchema = z.object({
  property: z.object({ name: z.string(), slug: z.string(), deck: z.string(), place: z.string() }),
  images: z.array(z.object({ path: z.string() })),
});
const submittedSchema = receiptSchema.extend({
  uploads: z.array(
    z.object({ media_id: z.string(), index: z.number().int(), url: z.string().optional() }),
  ),
});
const issuedSchema = z.object({ payment_id: z.string(), event_id: z.string() });
const paymentSchema = z.object({ status: z.string(), invoice_number: z.string().nullable() });
const errorSchema = z.object({ error: z.object({ code: z.string() }) });
const secretNamesSchema = z.object({
  secrets: z.array(z.object({ name: z.string(), value: z.string() })),
});

type Fixture = z.infer<typeof fixtureSchema>;
type Outcome = { ok: true; note: string } | { ok: false; note: string; blocked?: true };

interface Run {
  base: URL;
  agentKey: string;
  db: pg.Client;
  start: string;
  fixture: Fixture;
  photographs: string[];
  dossier: z.infer<typeof b9FixtureSchema>["property"];
  secrets: Map<string, string>;
  ids: { submission?: string; property?: string };
}

const ok = (note: string): Outcome => ({ ok: true, note });
const fail = (note: string): Outcome => ({ ok: false, note });

/** Rows of one select, parsed. */
async function select<T>(
  db: pg.Client,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  const result = await db.query(sql, params);
  return z.array(schema).parse(result.rows);
}

/** Polls `probe` until it answers a value or `ms` pass; undefined on timeout. */
async function poll<T>(ms: number, probe: () => Promise<T | undefined>): Promise<T | undefined> {
  const until = Date.now() + ms;
  for (;;) {
    const found = await probe();
    if (found !== undefined || Date.now() > until) return found;
    await sleep(POLL_MS);
  }
}

/** A human row: says what to do on which screen, then polls the entity until the step is done. */
async function human<T>(
  screen: string,
  what: string,
  probe: () => Promise<T | undefined>,
): Promise<T | undefined> {
  process.stdout.write(`WAIT ${screen} ${what}\n`);
  return poll(HUMAN_WAIT_MS, probe);
}

/** A JSON body, or the raw text of an answer that is not JSON (a platform error page). */
function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

interface Answer {
  status: number;
  body: unknown;
}

async function call(
  run: Run,
  method: string,
  path: string,
  body?: unknown,
  turnstile = false,
): Promise<Answer> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (path.startsWith("/api/admin/")) headers["authorization"] = `Bearer ${run.agentKey}`;
  if (turnstile) headers["x-turnstile-token"] = TURNSTILE_PASS;
  const response = await fetch(new URL(path, run.base), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: parseBody(await response.text()) };
}

/** The parsed body of a 2xx answer; anything else throws with the status and error code. */
async function expectOk<T>(
  run: Run,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  method: string,
  path: string,
  body?: unknown,
  turnstile = false,
): Promise<T> {
  const answer = await call(run, method, path, body, turnstile);
  if (answer.status < 200 || answer.status > 299) {
    const code = errorSchema.safeParse(answer.body);
    throw new Error(
      `${method} ${path} answered ${String(answer.status)} ${code.success ? code.data.error.code : ""}`,
    );
  }
  return schema.parse(answer.body);
}

/** True when the answer is 403 `human_only`: the step is a person's (S23, architecture 6). */
function isHumanOnly(answer: Answer): boolean {
  const code = errorSchema.safeParse(answer.body);
  return answer.status === 403 && code.success && code.data.error.code === "human_only";
}

/** The letters of one entity sent for real, never by the dry path (G14). */
async function mailSent(run: Run, template: string, entityId: string): Promise<boolean> {
  const rows = await select(
    run.db,
    z.object({ n: z.coerce.number() }),
    `select count(*) as n from email_messages where template_key = $1 and entity_id = $2 and created_at >= $3
       and status in ('sent', 'delivered') and resend_id is not null and resend_id not like 'dry_%'`,
    [template, entityId, run.start],
  );
  return (rows[0]?.n ?? 0) > 0;
}

const waitMail = (run: Run, template: string, entityId: string) =>
  poll(JOB_WAIT_MS, async () => ((await mailSent(run, template, entityId)) ? true : undefined));

function mediaType(path: string): "image/jpeg" | "image/png" | "image/webp" {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function submit(
  run: Run,
  overrides: Record<string, unknown>,
): Promise<z.infer<typeof submittedSchema>> {
  const media = run.photographs.map((path) => ({
    name: basename(path),
    size: readFileSync(new URL(path, APP)).byteLength,
    type: mediaType(path),
  }));
  const body = submissionSchema.parse({ ...run.fixture.submission, ...overrides, media });
  return expectOk(run, submittedSchema, "POST", "/api/public/submissions", body, true);
}

/** Row 1: the public form, then one PUT of each photograph to the signed URL it was given. */
async function row1(run: Run): Promise<Outcome> {
  const sent = await submit(run, {});
  run.ids.submission = sent.id;
  for (const upload of sent.uploads) {
    const path = run.photographs[upload.index];
    if (upload.url === undefined || path === undefined)
      return fail(`no signed URL for photograph ${String(upload.index)}`);
    const put = await fetch(upload.url, {
      method: "PUT",
      headers: { "content-type": mediaType(path) },
      body: readFileSync(new URL(path, APP)),
    });
    if (!put.ok) return fail(`PUT of ${path} answered ${String(put.status)}`);
  }
  const state = await select(
    run.db,
    z.object({ workflow_state: z.string(), media: z.coerce.number() }),
    `select s.workflow_state, (select count(*) from submission_media m where m.submission_id = s.id) as media
       from submissions s where s.id = $1 and s.received_at >= $2`,
    [sent.id, run.start],
  );
  const row = state[0];
  if (row?.workflow_state !== "Submitted" || row.media !== run.photographs.length) {
    return fail(
      `submission ${row?.workflow_state ?? "missing"}, ${String(row?.media ?? 0)} media rows`,
    );
  }
  if ((await waitMail(run, "received", sent.id)) === undefined)
    return fail("no received letter sent");
  return ok(`submission ${sent.id}, ${String(row.media)} photographs, received letter sent`);
}

/** Row 2: start review of both, decline the duplicate as outside our markets. */
async function row2(run: Run): Promise<Outcome> {
  const duplicate = await submit(run, run.fixture.duplicate);
  const ids = [run.ids.submission, duplicate.id];
  await expectOk(run, startReviewAnswerSchema, "POST", "/api/admin/submissions/start-review", {
    ids,
  });
  const [reason] = await select(
    run.db,
    z.object({ id: z.string() }),
    "select id from decline_reasons where code = 'outside_markets'",
    [],
  );
  if (reason === undefined) return fail("no outside_markets decline reason");
  const decision = await expectOk(
    run,
    decisionAnswerSchema,
    "POST",
    `/api/admin/submissions/${duplicate.id}/decline`,
    { decline_reason_id: reason.id },
  );
  const letter = await poll(JOB_WAIT_MS, async () => {
    const rows = await select(
      run.db,
      z.object({ reason: z.string().nullable() }),
      `select e.payload->>'decline_reason_id' as reason from email_messages m
         join jobs j on j.id = m.job_id join events e on e.id = j.event_id
        where e.id = $1 and m.template_key = 'declined' and m.created_at >= $2
          and m.status in ('sent', 'delivered') and m.resend_id not like 'dry_%'`,
      [decision.event_id, run.start],
    );
    return rows[0];
  });
  if (letter === undefined) return fail("no declined letter sent for the decline event");
  if (letter.reason !== reason.id) return fail("the decline event names another reason");
  return ok("declined letter sent; read its reason paragraph in the +rehearsal mailbox");
}

/** Row 3: accept the real fixture. */
async function row3(run: Run, submission: string): Promise<Outcome> {
  await expectOk(
    run,
    decisionAnswerSchema,
    "POST",
    `/api/admin/submissions/${submission}/accept`,
    {},
  );
  const detail = await expectOk(
    run,
    submissionDetailSchema,
    "GET",
    `/api/admin/submissions/${submission}`,
  );
  if (detail.accepted_at === null) return fail("accepted_at not set");
  if ((await waitMail(run, "accepted", submission)) === undefined)
    return fail("no accepted letter sent");
  return ok(`accepted ${detail.accepted_at}, letter sent`);
}

/** Row 4: issue the invoice; marking it paid and activating the agent are a person's (human_only). */
async function row4(run: Run, submission: string): Promise<Outcome> {
  const issued = await expectOk(run, issuedSchema, "POST", "/api/admin/payments/issue-invoice", {
    submissionId: submission,
    product: run.fixture.invoice.product,
    preferredMethod: run.fixture.invoice.preferredMethod,
  });
  const first = await expectOk(
    run,
    paymentSchema,
    "GET",
    `/api/admin/payments/${issued.payment_id}`,
  );
  if (!/^MOP-\d{4}-\d{4}$/.test(first.invoice_number ?? "")) {
    return fail(`invoice number ${String(first.invoice_number)}`);
  }
  const paid = await human(
    "/admin/payments",
    `mark ${String(first.invoice_number)} paid`,
    async () => {
      const payment = await expectOk(
        run,
        paymentSchema,
        "GET",
        `/api/admin/payments/${issued.payment_id}`,
      );
      return payment.status === "paid" ? payment : undefined;
    },
  );
  if (paid === undefined) return fail("waiting-timeout: the invoice is not paid");
  const scheduled = await human("/admin/submissions", "activate the request", async () => {
    const detail = await expectOk(
      run,
      submissionDetailSchema,
      "GET",
      `/api/admin/submissions/${submission}`,
    );
    return detail.workflow_state === "Scheduled" ? detail : undefined;
  });
  if (scheduled === undefined) return fail("waiting-timeout: the request is not Scheduled");
  return ok(`${String(first.invoice_number)} paid, request Scheduled`);
}

/** Row 5: the property from the request, its dossier, photo order and ranks, then publish. */
async function row5(run: Run, submission: string): Promise<Outcome> {
  const created = await expectOk(
    run,
    createFromSubmissionAnswerSchema,
    "POST",
    "/api/admin/properties/from-submission",
    {
      submission_id: submission,
    },
  );
  const id = created.property_id;
  run.ids.property = id;
  const read = () => expectOk(run, propertyDetailSchema, "GET", `/api/admin/properties/${id}`);
  // The photographs arrive with the copy job (E2E-02); the order can be set once every one is there.
  const copied = await poll(JOB_WAIT_MS, async () => {
    const detail = await read();
    return detail.media.length === run.photographs.length ? detail : undefined;
  });
  if (copied === undefined) return fail("the photographs were not copied to the property");
  const { version } = await expectOk(
    run,
    versionAnswerSchema,
    "PATCH",
    `/api/admin/properties/${id}`,
    {
      expected_version: copied.property.version,
      patch: {
        ...run.fixture.property,
        title: run.dossier.name,
        story: [run.dossier.deck],
        place: run.dossier.place,
      },
    },
  );
  // PATCH carries no order (B7 `propertyFieldsSchema`); the order is `media/reorder`.
  const bySequence = [...copied.media].sort((a, b) => a.sort_order - b.sort_order);
  const order = run.fixture.photoOrder.map((index) => bySequence[index]?.id ?? "");
  await expectOk(run, reorderAnswerSchema, "POST", "/api/admin/media/reorder", {
    property_id: id,
    order,
  });
  const ranked = await expectOk(
    run,
    versionAnswerSchema,
    "PUT",
    `/api/admin/properties/${id}/rank`,
    {
      expected_version: version,
      ...run.fixture.ranks,
    },
  );
  const publish = await call(run, "POST", `/api/admin/properties/${id}/publish`, {
    expected_version: ranked.version,
  });
  if (isHumanOnly(publish)) {
    const published = await human("/admin/properties", `publish ${run.dossier.name}`, async () => {
      const detail = await read();
      return detail.property.editorial_state === "published" ? detail : undefined;
    });
    if (published === undefined) return fail("waiting-timeout: not published");
  } else if (publish.status < 200 || publish.status > 299) {
    const code = errorSchema.safeParse(publish.body);
    return fail(
      `publish answered ${String(publish.status)} ${code.success ? code.data.error.code : ""}`,
    );
  } else {
    publishAnswerSchema.parse(publish.body);
  }
  const final = await read();
  return final.property.editorial_state === "published"
    ? ok(`property ${id} published`)
    : fail(`editorial_state ${final.property.editorial_state}`);
}

async function jobStates(run: Run, types: string[]): Promise<Map<string, string>> {
  const rows = await select(
    run.db,
    z.object({ type: z.string(), status: z.string() }),
    "select type, status::text from jobs where created_at >= $1 and type = any($2) order by created_at",
    [run.start, types],
  );
  return new Map(rows.map((row) => [row.type, row.status]));
}

/** Row 6: the render jobs, the laptop's caption run (ruling H34), the cover on /media and the original gone. */
async function row6(run: Run, property: string, submission: string): Promise<Outcome> {
  let captionsRun = false;
  const states = await poll(JOB_WAIT_MS, async () => {
    const found = await jobStates(run, RENDER_JOBS);
    if (!captionsRun && found.get("write_captions") === "queued") {
      captionsRun = true;
      const env: Record<string, string | undefined> = { ...process.env, MOP_DEV_LOCK_HELD: "1" };
      delete env["CAPTIONS_CLI"];
      spawnSync("bun", ["run", "captions"], { cwd: APP, stdio: "inherit", env });
    }
    return RENDER_JOBS.every((type) => found.get(type) === "done") ? found : undefined;
  });
  if (states === undefined) {
    const found = await jobStates(run, RENDER_JOBS);
    const late = RENDER_JOBS.filter((type) => found.get(type) !== "done");
    return fail(
      late.map((type) => `${type} not done (${found.get(type) ?? "missing"})`).join(", "),
    );
  }
  const [cover] = await select(
    run.db,
    z.object({ media_key: z.string().nullable() }),
    `select f->>'media_key' as media_key from assets a, jsonb_array_elements(a.files) f
      where a.property_id = $1 and a.kind = 'cover' and f->>'role' = 'main' order by a.created_at desc limit 1`,
    [property],
  );
  if (cover?.media_key === undefined || cover.media_key === null) return fail("no cover file");
  const media = await fetch(new URL(`/media/${cover.media_key}`, run.base));
  const type = media.headers.get("content-type") ?? "";
  if (media.status !== 200 || type !== "image/jpeg")
    return fail(`/media cover answered ${String(media.status)} ${type}`);
  const [originals] = await select(
    run.db,
    z.object({ n: z.coerce.number() }),
    `select count(*) as n from storage.objects o join submission_media m on m.storage_path = o.name
      where o.bucket_id = 'submissions' and m.submission_id = $1`,
    [submission],
  );
  if ((originals?.n ?? 0) > 0)
    return fail(`${String(originals?.n)} originals still in submissions`);
  return ok("render jobs done, cover 200 image/jpeg, originals deleted");
}

/** Row 7: a person approves every asset on screen 10 (S23). */
async function row7(run: Run, property: string): Promise<Outcome> {
  const assetCount = z.object({ total: z.coerce.number(), approved: z.coerce.number() });
  // The property detail answer has no assets, so the poll reads them through DEV_DB_URL.
  const approved = await human(
    "/admin/assets",
    `approve every asset of ${run.dossier.name}`,
    async () => {
      const [row] = await select(
        run.db,
        assetCount,
        `select count(*) as total, count(*) filter (where status in ('approved', 'published')) as approved
         from assets where property_id = $1`,
        [property],
      );
      return row !== undefined && row.total > 0 && row.total === row.approved ? row : undefined;
    },
  );
  if (approved === undefined) return fail("waiting-timeout: assets not approved");
  const [events] = await select(
    run.db,
    z.object({ n: z.coerce.number() }),
    "select count(*) as n from events where type = 'asset.approved' and at >= $1",
    [run.start],
  );
  const posts = await poll(JOB_WAIT_MS, async () => {
    const found = await jobStates(run, POST_JOBS);
    return POST_JOBS.every((type) => found.has(type)) ? found : undefined;
  });
  if ((events?.n ?? 0) === 0) return fail("no asset.approved event");
  if (posts === undefined) return fail("post jobs were not planned");
  return ok(
    `${String(approved.total)} assets approved, ${String(events?.n)} events, post jobs planned`,
  );
}

/** Row 8: the post jobs end `done` under SOCIAL_DRY_RUN and leave every social post `scheduled` (B10 step 10). */
async function row8(run: Run, property: string): Promise<Outcome> {
  if (run.secrets.has("SOCIAL_LIVE")) return fail("SOCIAL_LIVE set");
  if (!run.secrets.has("SOCIAL_DRY_RUN")) return fail("SOCIAL_DRY_RUN unset");
  const done = await poll(JOB_WAIT_MS, async () => {
    const found = await jobStates(run, POST_JOBS);
    return POST_JOBS.every((type) => found.get(type) === "done") ? found : undefined;
  });
  if (done === undefined) return fail("post jobs not done");
  const posts = await select(
    run.db,
    z.object({ status: z.string() }),
    "select status::text from social_posts where property_id = $1",
    [property],
  );
  const posted = posts.filter((post) => post.status !== "scheduled");
  return posts.length > 0 && posted.length === 0
    ? ok(`${String(posts.length)} social posts still scheduled`)
    : fail(`${String(posts.length)} social posts, ${String(posted.length)} not scheduled`);
}

/** Row 9: the digest fast-forwarded (B11 step 10), the issue sent to the three-address audience, an unsubscribe. */
async function row9(run: Run): Promise<Outcome> {
  const { audience, approver } = run.fixture.newsletter;
  await run.db.query(
    `update schedule_settings set enabled = true, cron = '* * * * *', last_run_at = now() - interval '15 days',
       next_run_at = null where key = 'digest'`,
  );
  try {
    const draft = await poll(JOB_WAIT_MS, async () => {
      const [row] = await select(
        run.db,
        z.object({ id: z.string() }),
        "select id from newsletter_issues where status = 'draft' and updated_at >= $1 and blocks <> '[]'::jsonb",
        [run.start],
      );
      return row;
    });
    if (draft === undefined) return fail("the digest assembled no issue");
    // B11's test sender confirms the three addresses, approves as the approver and waits for the send.
    const sent = spawnSync(
      "bun",
      [
        "run",
        "scripts/newsletter-test-send.ts",
        "--to",
        audience.join(","),
        "--actor",
        approver,
        "--i-mean-it",
      ],
      { cwd: APP, encoding: "utf8", env: { ...process.env, MOP_DEV_LOCK_HELD: "1" } },
    );
    if (sent.status !== 0)
      return fail(`newsletter-test-send exited ${String(sent.status)}: ${sent.stdout.trim()}`);
  } finally {
    await run.db.query(
      `update schedule_settings set cron = $1, enabled = false, next_run_at = null where key = 'digest'`,
      [DIGEST_CRON],
    );
  }
  const delivered = await poll(JOB_WAIT_MS, async () => {
    const rows = await select(
      run.db,
      z.object({ to_email: z.string() }),
      "select distinct to_email from email_events where type = 'email.delivered' and at >= $1 and to_email = any($2)",
      [run.start, audience],
    );
    return rows.length === audience.length ? rows : undefined;
  });
  if (delivered === undefined) return fail("no delivered event for every test address");
  const [first] = audience;
  const unsubscribed = await human(
    "mailbox",
    `press unsubscribe in the issue sent to ${String(first)}`,
    async () => {
      const [row] = await select(
        run.db,
        z.object({ at: z.string() }),
        "select unsubscribed_at::text as at from subscribers where email = $1 and unsubscribed_at >= $2",
        [first, run.start],
      );
      return row;
    },
  );
  return unsubscribed === undefined
    ? fail("waiting-timeout: unsubscribe not recorded")
    : ok("issue sent, delivered to 3, unsubscribe honoured");
}

/** Row 10: an inquiry on the property, forwarded to B15's mock with a valid signature. */
async function row10(run: Run, property: string): Promise<Outcome> {
  const blocked: Outcome = { ok: false, note: "BLOCKED omnikom mock not deployed", blocked: true };
  if (
    run.secrets.get("OMNIKOM_WEBHOOK_URL") !==
    createHash("sha256").update(OMNIKOM_MOCK).digest("hex")
  )
    return blocked;
  const [slug] = await select(
    run.db,
    z.object({ slug: z.string() }),
    "select slug from properties where id = $1",
    [property],
  );
  if (slug === undefined) return fail("the property has no slug");
  const body = inquirySchema.parse({
    ...run.fixture.inquiry,
    subject: { kind: "property", slug: slug.slug, title: run.dossier.name },
    sourcePath: `/property/${slug.slug}?utm_source=rehearsal`,
  });
  const receipt = await expectOk(run, receiptSchema, "POST", "/api/public/inquiries", body, true);
  const forwarded = await poll(JOB_WAIT_MS, async () => {
    const [row] = await select(
      run.db,
      z.object({ state: z.string(), job: z.string().nullable(), http: z.string().nullable() }),
      `select i.state::text, j.status::text as job, j.result->>'last_http_status' as http from inquiries i
         left join events e on e.entity_id = i.id left join jobs j on j.event_id = e.id and j.type = 'webhook_omnikom'
        where i.id = $1 and i.received_at >= $2 order by j.created_at desc nulls last limit 1`,
      [receipt.id, run.start],
    );
    return row?.state === "forwarded" && row.job === "done" && row.http === "200" ? row : undefined;
  });
  return forwarded === undefined
    ? fail("the inquiry was not forwarded with a 200")
    : ok(`inquiry ${receipt.id} forwarded, mock answered 200`);
}

/** Row 11: the trail. Every actor step audited, no dead or failed job since the start. */
async function row11(run: Run): Promise<Outcome> {
  const actions = await select(
    run.db,
    z.object({ action: z.string() }),
    "select distinct action from audit_log where at >= $1",
    [run.start],
  );
  const seen = actions.map((row) => row.action);
  const missing = AGENT_ACTIONS.filter((action) => !seen.includes(action));
  const [failed] = await select(
    run.db,
    z.object({ n: z.coerce.number() }),
    "select count(*) as n from jobs where status in ('dead', 'failed') and created_at >= $1",
    [run.start],
  );
  if (missing.length > 0) return fail(`not audited: ${missing.join(", ")}`);
  return (failed?.n ?? 0) === 0
    ? ok(`${String(seen.length)} audited actions, 0 failed jobs`)
    : fail(`${String(failed?.n)} dead or failed jobs`);
}

/** The function secret names of the one project with their digests; the CLI needs the account token from `.env`. */
function functionSecrets(): Map<string, string> {
  const token = requireSecret("SUPABASE_ACCESS_TOKEN");
  const listed = spawnSync(
    "bunx",
    [
      "supabase",
      "secrets",
      "list",
      "--project-ref",
      requireSecret("DEV_SUPABASE_PROJECT_REF"),
      "--output-format",
      "json",
      "--agent",
      "no",
    ],
    { cwd: APP, encoding: "utf8", env: { ...process.env, SUPABASE_ACCESS_TOKEN: token } },
  );
  if (listed.status !== 0) throw new Error(`supabase secrets list exited ${String(listed.status)}`);
  const parsed = secretNamesSchema.parse(JSON.parse(listed.stdout));
  return new Map(parsed.secrets.map((secret) => [secret.name, secret.value]));
}

/** Rows 1 to 3 and 9 send real mail: EMAIL_LIVE on, EMAIL_DRY_RUN off (G14, E2E-04 (3)). */
function mailFault(secrets: Map<string, string>): string | undefined {
  if (secrets.has("EMAIL_DRY_RUN")) return "EMAIL_DRY_RUN set";
  return secrets.has("EMAIL_LIVE") ? undefined : "EMAIL_LIVE unset";
}

type RowStep = (run: Run) => Promise<Outcome>;

function need(value: string | undefined, what: string): string {
  if (value === undefined) throw new Error(`${what} is not known: an earlier row did not run`);
  return value;
}

function rows(run: Run): [string, RowStep][] {
  const mail = mailFault(run.secrets);
  const mailed = (step: RowStep): RowStep =>
    mail === undefined ? step : () => Promise.resolve(fail(mail));
  const submission = () => need(run.ids.submission, "the submission");
  const property = () => need(run.ids.property, "the property");
  return [
    ["Submit through the public form", mailed(row1)],
    ["Start review, decline the duplicate", mailed(row2)],
    ["Accept the fixture", mailed((r) => row3(r, submission()))],
    ["Invoice, paid, activated", (r) => row4(r, submission())],
    ["Property, dossier, order, ranks, publish", (r) => row5(r, submission())],
    ["Watch the jobs", (r) => row6(r, property(), submission())],
    ["Approve assets on screen 10", (r) => row7(r, property())],
    ["Post jobs under SOCIAL_DRY_RUN", (r) => row8(r, property())],
    ["Place Notes to the test audience", mailed(row9)],
    ["Inquiry with utm_source=rehearsal", (r) => row10(r, property())],
    ["The whole trail", row11],
  ];
}

async function rehearse(run: Run): Promise<number> {
  const table: string[] = ["| # | Step | Result | Elapsed |", "|---|---|---|---|"];
  let stopped = false;
  let blocked = false;
  let index = 0;
  for (const [name, step] of rows(run)) {
    index += 1;
    if (stopped) {
      table.push(`| ${String(index)} | ${name} | not run | |`);
      continue;
    }
    const began = Date.now();
    const outcome = await step(run).catch((error: unknown) =>
      fail(error instanceof Error ? error.message : String(error)),
    );
    const seconds = ((Date.now() - began) / 1000).toFixed(0);
    const result = outcome.ok ? `ok ${outcome.note}` : `red ${outcome.note}`;
    process.stdout.write(`row ${String(index)} ${result} (${seconds} s)\n`);
    table.push(`| ${String(index)} | ${name} | ${result} | ${seconds} s |`);
    if (!outcome.ok && outcome.blocked === true) blocked = true;
    else if (!outcome.ok) stopped = true;
  }
  process.stdout.write(`${table.join("\n")}\n`);
  if (blocked) process.stdout.write("BLOCKED omnikom mock not deployed\n");
  return stopped || blocked ? 1 : 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      env: { type: "string" },
      base: { type: "string", default: "http://localhost:8080" },
      property: { type: "string" },
    },
    strict: true,
  });
  if (values.env !== "dev" || values.property === undefined || !URL.canParse(values.base)) {
    console.error(USAGE);
    return 1;
  }
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const fixture = fixtureSchema.parse(JSON.parse(readFileSync(values.property, "utf8")));
  const b9 = b9FixtureSchema.parse(
    JSON.parse(readFileSync(new URL(fixture.propertyFixture, APP), "utf8")),
  );
  const start = new Date().toISOString();
  process.stdout.write(`${start}\n`);
  const release = await holdDevLock();
  const db = new pg.Client(pgClientConfig(dbUrl));
  try {
    await db.connect();
    return await rehearse({
      base: new URL(values.base),
      agentKey: requireSecret("REHEARSAL_AGENT_KEY"),
      db,
      start,
      fixture,
      photographs: [...b9.images.map((image) => image.path), ...fixture.extraPhotographs],
      dossier: b9.property,
      secrets: functionSecrets(),
      ids: {},
    });
  } finally {
    await db.end();
    await release();
  }
}

await runScript(() => main(process.argv.slice(2)));

import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

// One call per public API route against a running Worker, then the rows those calls wrote, read with the service
// key (B3). Needs the dev loader of B3's Inputs. It writes rows, so it refuses a production database first (H35 (5)).
// usage: node scripts/api-smoke.mjs <baseUrl> [--cleanup] [--cleanup-only] [--expect-limits]

const USAGE =
  "usage: node scripts/api-smoke.mjs <baseUrl> [--cleanup] [--cleanup-only] [--expect-limits]";
// Cloudflare's always-pass test token, accepted with the test secret every non-production Worker holds.
const TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const SOURCE = "/__smoke";
const LOCK = "hashtext('mop-dev-tests')";
/** @type {[table: string, sql: string][]} */
const CLEANUP = [
  [
    "rate_limits",
    `delete from public.rate_limits where key_hash in (
       select ip_hash from public.inquiries where source_path = '${SOURCE}'
       union select ip_hash from public.submissions where source_path = '${SOURCE}'
       union select ip_hash from public.subject_requests where note = '__smoke')`,
  ],
  ["inquiries", `delete from public.inquiries where source_path = '${SOURCE}'`],
  ["submissions", `delete from public.submissions where source_path = '${SOURCE}'`],
  // S55 links each submission to a contact row; the plan's list predates it.
  ["contacts", "delete from public.contacts where email like 'smoke+%@example.invalid'"],
  ["subscribers", "delete from public.subscribers where email like 'smoke+%@example.invalid'"],
  ["subject_requests", "delete from public.subject_requests where note = '__smoke'"],
  ["analytics_events", `delete from public.analytics_events where path = '${SOURCE}'`],
];

/**
 * @typedef {{ name: string, ok: boolean, detail: string }} Check
 * @typedef {{ status: number, body: unknown, requestId: string | null }} Answer
 */

/** @param {unknown} value @returns {Record<string, unknown>} */
const record = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

/** @param {string} name */
function required(name) {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(`${name} is not set: load the dev profile`);
  return value;
}

/**
 * @param {string} url
 * @param {{ method?: string, body?: unknown }} [request]
 * @returns {Promise<Answer>}
 */
async function call(url, { method = "GET", body } = {}) {
  /** @type {Record<string, string>} */
  const headers = { accept: "application/json" };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
    headers["x-turnstile-token"] = TURNSTILE_TOKEN;
  }
  const response = await fetch(url, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  /** @type {unknown} */
  const parsed = text === "" ? null : JSON.parse(text);
  return { status: response.status, body: parsed, requestId: response.headers.get("x-request-id") };
}

/**
 * @param {Check[]} checks
 * @param {string} name
 * @param {Answer} answer
 * @param {number} status
 * @param {(body: unknown) => boolean} shape
 * @param {boolean} expectLimits
 */
function expectAnswer(checks, name, answer, status, shape, expectLimits) {
  if (answer.status === 429 && expectLimits) {
    checks.push({ name, ok: true, detail: "429 (limits expected)" });
    return false;
  }
  const ok = answer.status === status && answer.requestId !== null && shape(answer.body);
  checks.push({
    name,
    ok,
    detail: `${String(answer.status)}${answer.requestId === null ? " without x-request-id" : ""}`,
  });
  return ok;
}

/** @param {unknown} body */
const isList = (body) => Array.isArray(body) && body.length > 0;
/** @param {unknown} body */
const isReceipt = (body) =>
  typeof record(body)["id"] === "string" && typeof record(body)["receivedAt"] === "string";
/** @param {unknown} body */
const slugOf = (body) => {
  const first = Array.isArray(body) ? record(body[0]) : {};
  return typeof first["slug"] === "string" ? first["slug"] : "";
};

/**
 * @param {string} api
 * @param {Check[]} checks
 * @param {boolean} expectLimits
 */
async function callRoutes(api, checks, expectLimits) {
  for (const kind of ["properties", "markets", "stories"]) {
    const list = await call(`${api}/${kind}`);
    expectAnswer(checks, `GET /${kind}`, list, 200, isList, expectLimits);
    const detail = await call(`${api}/${kind}/${encodeURIComponent(slugOf(list.body))}`);
    expectAnswer(
      checks,
      `GET /${kind}/:slug`,
      detail,
      200,
      (body) => record(body)["slug"] !== undefined,
      expectLimits,
    );
  }
  const email = `smoke+${String(Date.now())}@example.invalid`;
  const inquiry = await call(`${api}/inquiries`, {
    method: "POST",
    body: { intent: "general", name: "Smoke Test", email, message: "__smoke", sourcePath: SOURCE },
  });
  expectAnswer(checks, "POST /inquiries", inquiry, 201, isReceipt, expectLimits);
  const submission = await call(`${api}/submissions`, {
    method: "POST",
    body: {
      address: "1 Smoke Lane",
      city: "Malibu",
      state: "California",
      zip: "90265",
      currency: "USD",
      propertyType: "Residence",
      submitterKind: "owner",
      submitterName: "Smoke Test",
      submitterEmail: email,
      story: "__smoke",
      significance: "__smoke",
      package: "Not sure yet",
      rightsConfirmed: true,
      media: [{ name: "smoke.jpg", size: 1024, type: "image/jpeg" }],
      sourcePath: SOURCE,
    },
  });
  const sent = record(submission.body);
  const uploads = Array.isArray(sent["uploads"]) ? sent["uploads"].map(record) : [];
  const signed = expectAnswer(
    checks,
    "POST /submissions",
    submission,
    201,
    (body) =>
      isReceipt(body) &&
      typeof sent["upload_token"] === "string" &&
      uploads.length === 1 &&
      typeof uploads[0]?.["url"] === "string",
    expectLimits,
  );
  if (signed) {
    const more = await call(`${api}/submissions/${String(sent["id"])}/uploads`, {
      method: "POST",
      body: { media_ids: [uploads[0]?.["media_id"]], upload_token: sent["upload_token"] },
    });
    expectAnswer(
      checks,
      "POST /submissions/:id/uploads",
      more,
      200,
      (body) => Array.isArray(record(body)["uploads"]),
      expectLimits,
    );
  }
  return email;
}

/**
 * @param {string} email
 * @param {Check[]} checks
 */
async function readRows(email, checks) {
  const client = createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  /** @type {[table: string, column: string][]} */
  const written = [
    ["inquiries", "email"],
    ["submissions", "submitter_email"],
  ];
  for (const [table, column] of written) {
    const { count, error } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("source_path", SOURCE)
      .eq(column, email);
    checks.push({
      name: `row in ${table}`,
      ok: error === null && count === 1,
      detail: error === null ? `${String(count)} row` : error.message,
    });
  }
}

/** One locked transaction (G34); B2's hard-delete guard refuses a delete outside `mop.retention`. */
async function cleanup() {
  const client = new pg.Client({ connectionString: required("DEV_DB_URL") });
  await client.connect();
  try {
    await client.query(`select pg_advisory_lock(${LOCK})`);
    try {
      await client.query("begin");
      await client.query("select set_config('mop.retention', 'on', true)");
      for (const [table, sql] of CLEANUP) {
        const result = await client.query(sql);
        process.stdout.write(`cleanup ${table}: ${String(result.rowCount)}\n`);
      }
      await client.query("commit");
    } finally {
      await client.query(`select pg_advisory_unlock(${LOCK})`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  guardEnv();
  const args = process.argv.slice(2);
  const base = args.find((arg) => !arg.startsWith("--"));
  if (base === undefined) throw new Error(USAGE);
  await assertNotProduction();
  const checks = /** @type {Check[]} */ ([]);
  if (!args.includes("--cleanup-only")) {
    const email = await callRoutes(
      `${base.replace(/\/$/, "")}/api/public`,
      checks,
      args.includes("--expect-limits"),
    );
    await readRows(email, checks);
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}\n`);
    }
  }
  if (args.includes("--cleanup") || args.includes("--cleanup-only")) await cleanup();
  const failed = checks.filter((check) => !check.ok).length;
  process.stdout.write(
    `api-smoke: ${String(checks.length - failed)} ok, ${String(failed)} failed\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

await main();

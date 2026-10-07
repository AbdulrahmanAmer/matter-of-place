// `bun run scripts/invoice-smoke.ts` (B6): the invoice path on the one database, before L1's launch switch only
// (ruling H35 (5)). It checks readiness first with the same `invoiceReadiness` the issue path uses and, when
// something is missing, writes nothing, prints `invoice_not_ready: <fields>` and exits 1. Otherwise it commits one
// accepted fixture submission, issues its invoice through `issueInvoiceCore` and prints `invoice <number>`.
//   --print-text   also prints the text runs of the invoice, so the legal fields can be read without a PDF viewer
//   --out <file>   renders the PDF from the stored snapshot, here, and saves it (no network call)
//   --upload       waits for the runner's `invoice_pdf` job, downloads the object and prints `pdf documents/<key>`
//   --email <addr> the fixture submitter's address (default smoke@example.invalid, a reserved domain)
//   --cleanup      voids the payment at the end (rows are never deleted)
// From `app/`:
//   eval "$(node scripts/load-env.mjs --profile dev)"; env -u CLOUDFLARE_API_TOKEN bun run scripts/invoice-smoke.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import type { Db } from "../src/server/lib/db.ts";
import {
  invoiceSnapshotSchema,
  layoutInvoice,
  type InvoiceSnapshot,
} from "../src/server/payments/invoice-layout.ts";
import {
  renderInvoicePdf,
  storageInvoiceStore,
  INVOICE_BUCKET,
} from "../src/server/payments/invoice-pdf.ts";
import {
  actorArg,
  invoiceReadiness,
  readInvoiceInputs,
} from "../src/server/payments/invoice-settings.ts";
import { issueInvoiceCore } from "../src/server/payments/service.ts";
import { createSubmission } from "../tests/fixtures/factories.ts";
import { dbNow } from "../tests/fixtures/db.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";
import { guardEnv } from "./lib/guard-env.mjs";

// The runner ticks every minute: three minutes is three ticks and the retries of the first.
const POLLS = 36;
const POLL_MS = 5000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`invoice-smoke: ${name} is not set`);
  return value;
}

/** Commits one accepted request of an agent or owner and answers its id. The id differs on every run. */
async function createFixtureSubmission(email: string): Promise<string> {
  const client = new pg.Client({ connectionString: requiredEnv("DEV_DB_URL") });
  await client.connect();
  try {
    await client.query("begin");
    const base = await dbNow(client);
    const id = await createSubmission(client, {
      state: "Accepted",
      n: Math.floor(base.getTime() / 1000),
      base,
      submitter_email: email,
    });
    await client.query("commit");
    return id;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function readPayment(db: Db, paymentId: string) {
  const { data, error } = await db
    .from("payments")
    .select("invoice_number, invoice_snapshot, invoice_file_key")
    .eq("id", paymentId);
  if (error !== null) throw new Error(error.message);
  const row = data[0];
  if (row === undefined) throw new Error(`invoice-smoke: payment ${paymentId} is not there`);
  return row;
}

/** Polls until the runner's job has recorded the key, then proves the stored object is a PDF. */
async function waitForUpload(db: Db, paymentId: string): Promise<string | null> {
  for (let poll = 0; poll < POLLS; poll += 1) {
    const { invoice_file_key: key } = await readPayment(db, paymentId);
    if (key !== null) {
      const bytes = await storageInvoiceStore(db).get(key);
      if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") {
        throw new Error(`invoice-smoke: ${key} does not start with %PDF`);
      }
      return key;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  const job = await db
    .from("jobs")
    .select("status, error")
    .eq("idempotency_key", `invoice_pdf:${paymentId}`);
  const [row] = job.data ?? [];
  console.error(`invoice_pdf job: ${row?.status ?? "none"} ${row?.error ?? ""}`.trim());
  return null;
}

async function main(): Promise<number> {
  guardEnv();
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const {
    out,
    upload,
    cleanup,
    email,
    "print-text": printText,
  } = parseArgs({
    args: process.argv.slice(2),
    options: {
      out: { type: "string" },
      upload: { type: "boolean", default: false },
      cleanup: { type: "boolean", default: false },
      email: { type: "string", default: "smoke@example.invalid" },
      "print-text": { type: "boolean", default: false },
    },
  }).values;
  // The dev profile's own names, never SUPABASE_URL (P-331); the key is read here and never printed (E10).
  const db: Db = createClient(
    `https://${requiredEnv("DEV_SUPABASE_PROJECT_REF")}.supabase.co`,
    requiredEnv("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const release = await holdDevLock();
  let paymentId: string | null = null;
  try {
    const { site, invoice } = await readInvoiceInputs(db);
    const missing = invoiceReadiness(site, invoice);
    if (missing.length > 0) {
      console.log(`invoice_not_ready: ${missing.join(", ")}`);
      return 1;
    }
    const submissionId = await createFixtureSubmission(email);
    const audit = {
      p_actor: actorArg(null),
      p_actor_kind: "human",
      p_request_id: `invoice-smoke:${submissionId}`,
    } as const;
    const issued = await issueInvoiceCore(
      db,
      { submissionId, product: "The Feature", preferredMethod: "bank_transfer" },
      audit,
    );
    paymentId = issued.payment_id;
    const payment = await readPayment(db, paymentId);
    console.log(`invoice ${payment.invoice_number ?? ""}`);
    const snapshot: InvoiceSnapshot = invoiceSnapshotSchema.parse(payment.invoice_snapshot);
    if (printText) {
      for (const run of await layoutInvoice(snapshot)) console.log(run.text);
    }
    if (out !== undefined) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, await renderInvoicePdf(snapshot));
      console.log(`pdf ${out}`);
    }
    if (upload) {
      const key = await waitForUpload(db, paymentId);
      if (key === null) return 1;
      console.log(`pdf ${INVOICE_BUCKET}/${key}`);
    }
    return 0;
  } finally {
    if (cleanup && paymentId !== null) {
      const voided = await db.rpc("void_payment", {
        p_payment_id: paymentId,
        p_reason: "smoke cleanup",
        p_actor: actorArg(null),
        p_actor_kind: "human",
        p_request_id: `invoice-smoke:void:${paymentId}`,
      });
      if (voided.error !== null) {
        console.error(`invoice-smoke: cleanup failed: ${voided.error.message}`);
        process.exitCode = 1;
      }
    }
    await release();
  }
}

if (import.meta.main) {
  main().then(
    (code) => {
      if (code !== 0) process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}

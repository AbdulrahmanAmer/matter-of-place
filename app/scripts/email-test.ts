// Two modes (B5 step 3 and 4a).
//   bun run scripts/email-test.ts render <key>        draws the definition with its sample variables into out/email-<key>.html
//   bun run scripts/email-test.ts all|<key> <address> sends a test of one or every key through the deployed job runner
// `render` opens no database and needs no key. The send mode writes to the one cloud database, so it takes the writer
// lock, refuses once `settings.environment` is production (ruling H35 (5)), and never calls Resend itself: the runner
// does, with its own secrets. Secrets come from the git-ignored `.env` and are never printed.
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";
import type { Database } from "../src/db/index.ts";
import { emailTemplateKeys, sampleVariables, type EmailTemplateKey } from "../src/domain/email.ts";
import { renderTemplate } from "../src/server/email/render.ts";
import { definitionRow, definitions } from "../src/templates/email/index.ts";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { assertNotProduction } from "./lib/assert-not-production.mjs";

const POLL_MS = 5000;
const GIVE_UP_MS = 120_000;

const isKey = (value: string): value is EmailTemplateKey =>
  emailTemplateKeys.some((key) => key === value);

async function renderToFile(key: EmailTemplateKey): Promise<void> {
  const file = definitions.find((entry) => entry.definition.key === key);
  if (file === undefined) throw new Error(`no template file for ${key}`);
  const site = {
    siteUrl: "https://matterofplace.com",
    entity: null,
    address: null,
    contact: { email: null },
  };
  const { html } = await renderTemplate(definitionRow(file.definition), sampleVariables(key), site);
  mkdirSync("out", { recursive: true });
  writeFileSync(`out/email-${key}.html`, html);
  console.log(`wrote out/email-${key}.html`);
}

interface Secrets {
  projectRef: string;
  serviceKey: string;
  runnerSecret: string;
}

function loadSecrets(): Secrets {
  const dotenv = parseEnv(
    readFileSync(new URL("../../.env", import.meta.url), "utf8").replaceAll("\r", ""),
  );
  const need = (name: string): string => {
    const value = process.env[name] ?? dotenv[name];
    if (value === undefined || value === "") throw new Error(`email-test: ${name} is not set`);
    return value;
  };
  return {
    projectRef: need("DEV_SUPABASE_PROJECT_REF"),
    serviceKey: need("DEV_SUPABASE_SERVICE_ROLE_KEY"),
    runnerSecret: need("JOB_RUNNER_SECRET"),
  };
}

const skippedResult = z.object({ skipped: z.string() });

/** One test send: the job, one call of the runner, then a poll until the message or the job says what happened. */
async function sendOne(key: EmailTemplateKey, address: string, secrets: Secrets): Promise<string> {
  const base = `https://${secrets.projectRef}.supabase.co`;
  const db = createClient<Database>(base, secrets.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const minute = Math.floor(Date.now() / 60_000);
  const enqueued = await db.rpc("enqueue_job", {
    p_type: "send_email",
    p_idempotency_key: `send_email:cli:test:${key}:${String(minute)}`,
    p_payload: { params: { template: key }, data: { test: true, actor_email: address } },
  });
  if (enqueued.error !== null) throw new Error(`enqueue_job: ${enqueued.error.message}`);
  const jobId = enqueued.data;
  const runner = await fetch(`${base}/functions/v1/job-runner`, {
    method: "POST",
    headers: { authorization: `Bearer ${secrets.runnerSecret}` },
    signal: AbortSignal.timeout(GIVE_UP_MS),
  });
  if (!runner.ok) throw new Error(`${key}: the job runner answered ${String(runner.status)}`);
  const deadline = Date.now() + GIVE_UP_MS;
  while (Date.now() < deadline) {
    const messages = await db
      .from("email_messages")
      .select("status, resend_id, error")
      .eq("job_id", jobId);
    const message = messages.data?.[0];
    if (message?.status === "sent") return `sent ${key} ${message.resend_id ?? ""}`.trim();
    if (message?.status === "skipped") return `skipped ${key} ${message.error ?? ""}`.trim();
    const jobs = await db.from("jobs").select("status, error, result").eq("id", jobId);
    const job = jobs.data?.[0];
    if (job?.status === "dead") throw new Error(`${key}: job dead: ${job.error ?? "no error"}`);
    const skipped = skippedResult.safeParse(job?.result);
    if (job?.status === "done" && skipped.success) return `skipped ${key} ${skipped.data.skipped}`;
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${key}: no answer within ${String(GIVE_UP_MS / 1000)} seconds`);
}

async function sendMode(target: string, address: string): Promise<void> {
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  const keys = target === "all" ? [...emailTemplateKeys] : [target].filter(isKey);
  if (keys.length === 0) throw new Error(`email-test: unknown key ${target}`);
  const secrets = loadSecrets();
  const release = await holdDevLock();
  try {
    for (const key of keys) console.log(await sendOne(key, address, secrets));
  } finally {
    await release();
  }
}

async function main(): Promise<void> {
  const [mode, second] = process.argv.slice(2);
  if (mode === "render" && second !== undefined && isKey(second)) return renderToFile(second);
  if (mode !== undefined && mode !== "render" && second !== undefined) {
    return sendMode(mode, second);
  }
  throw new Error("usage: email-test.ts render <key> | all|<key> <address>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

// `bun run scripts/kpi-send.ts --week <Monday, YYYY-MM-DD> --to <address> --i-mean-it` (B11 step 13)
// Enqueues one `kpi_weekly` job with `data = { week_start, to }` on the one project (ruling H35), so the deployed job
// runner counts that week and sends it through B5's `sendOne` exactly as the Saturday job does; then waits for the
// job and prints how it ended and what its message row says. Needs the dev profile:
// `eval "$(node scripts/load-env.mjs --profile dev)"`. No value of a secret is printed.
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import type { Database } from "../src/db/index.ts";
import { sha256Hex } from "../src/server/lib/crypto.ts";
import { enqueueJob } from "../src/server/lib/jobs.ts";
import { devProject } from "./lib/storage-env.ts";

const POLL_MS = 5000;
const GIVE_UP_MS = 180_000;
const USAGE = "usage: kpi-send.ts --week <YYYY-MM-DD> --to <address> --i-mean-it";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      week: { type: "string" },
      to: { type: "string" },
      "i-mean-it": { type: "boolean", default: false },
    },
  });
  const { week, to } = values;
  if (week === undefined || to === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(week))
    throw new Error(USAGE);
  if (!values["i-mean-it"]) throw new Error(`refusing without --i-mean-it; ${USAGE}`);

  const { url, key } = devProject();
  const db = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const idempotencyKey = `kpi_weekly:manual:${week}:${(await sha256Hex(to.toLowerCase())).slice(0, 12)}`;
  const jobId = await enqueueJob(db, {
    type: "kpi_weekly",
    idempotencyKey,
    data: { week_start: week, to },
  });
  if (jobId === null) throw new Error("enqueue_job returned no job");
  console.log(`enqueued ${idempotencyKey}`);

  const deadline = Date.now() + GIVE_UP_MS;
  while (Date.now() < deadline) {
    const job = await db.from("jobs").select("status, error").eq("id", jobId).single();
    if (job.error !== null) throw new Error(`jobs: ${job.error.message}`);
    if (job.data.status === "done" || job.data.status === "dead") {
      const messages = await db
        .from("email_messages")
        .select("template_key, status, error")
        .eq("job_id", jobId);
      if (messages.error !== null) throw new Error(`email_messages: ${messages.error.message}`);
      console.log(`job ${job.data.status}${job.data.error === null ? "" : ` ${job.data.error}`}`);
      for (const row of messages.data) {
        console.log(
          `message ${row.template_key} ${row.status}${row.error === null ? "" : ` ${row.error}`}`,
        );
      }
      if (job.data.status === "dead") process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`job ${jobId} did not finish within ${String(GIVE_UP_MS / 1000)} seconds`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

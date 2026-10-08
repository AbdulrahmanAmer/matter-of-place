// B10 step 9: the manual trigger of a system job; no workflow and no clock calls it. `bun run
// scripts/enqueue-system-job.ts --type <system job type> [--key <idempotency key>] [--params <json file>] [--target
// dev]` prints `<type> disabled` (exit 0) while the type's `schedule_settings` row is off, else enqueues the job with
// B8's `enqueue_job` and prints `enqueued <key>` or `exists <key>`. The default key, `<type>:manual:<UTC date>T<HH:MM>`,
// never collides with the scheduler's `reconcile:<UTC date>T<HH:MM>` or the daily `reconcile_social:<UTC date>`.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { holdDevLock } from "../tests/fixtures/dev-lock.ts";
import { devDb } from "./lib/dev-db.ts";
import { guardEnv } from "./lib/guard-env.mjs";
import { assertDevTarget, runScript } from "./lib/social-script.ts";

const schedule = z.array(z.object({ enabled: z.boolean() }));
const paramsFile = z.record(z.string(), z.unknown());

/** The date and minute of `now` in UTC, `YYYY-MM-DDTHH:MM`. */
const minuteOf = (now: Date) => now.toISOString().slice(0, 16);

export async function enqueueSystemJobMain(
  argv: string[] = process.argv.slice(2),
  now: Date = new Date(),
): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      type: { type: "string" },
      key: { type: "string" },
      params: { type: "string" },
      target: { type: "string" },
    },
    strict: true,
  });
  if (values.type === undefined || values.type === "") {
    console.log("refused: --type <system job type> required");
    return 1;
  }
  assertDevTarget(values.target);
  guardEnv();
  const { type } = values;
  const db = devDb();
  const row = (await db.select("schedule_settings", `key=eq.${type}&select=enabled`, schedule))[0];
  if (row?.enabled === false) {
    console.log(`${type} disabled`);
    return 0;
  }
  const params =
    values.params === undefined
      ? type === "reconcile"
        ? { daily: true }
        : {}
      : paramsFile.parse(JSON.parse(readFileSync(values.params, "utf8")));
  const key = values.key ?? `${type}:manual:${minuteOf(now)}`;
  const release = await holdDevLock();
  try {
    const id = await db.rpc(
      "enqueue_job",
      {
        p_type: type,
        p_payload: { params, data: {} },
        p_idempotency_key: key,
        p_heavy: false,
      },
      z.string().nullable(),
    );
    console.log(`${id === null ? "exists" : "enqueued"} ${key}`);
    return 0;
  } finally {
    await release();
  }
}

if (import.meta.main) await runScript(() => enqueueSystemJobMain());

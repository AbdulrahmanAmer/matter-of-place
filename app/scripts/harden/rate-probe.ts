// `bun run scripts/harden/rate-probe.ts <base>/api/public/subscribers [n]` (H1-02), with the dev profile loaded, against a
// Worker that holds Turnstile's always-pass test secret (a local Worker or a `pr-<n>` preview, E10). The limits come
// from the route table itself. Phase 1 posts one address until refused: the email bucket answers 429 after its limit.
// Phase 2 posts fresh addresses until refused: the IP bucket answers 429 once it holds its limit in all, because a
// refused call writes no hit. Each 429 must carry `Retry-After` and `error.requestId`. `n` caps the posts of a phase.
// It commits rows to the one database, so it refuses production first (ruling H35 (5)), holds the writer lock (G34)
// and removes its rows by H1's cleanup rule. Prints `rate ok (...)`, or the failing check and exit 1.
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { assertNotProduction } from "../lib/assert-not-production.mjs";
import { openProbeDb, type ProbeDb } from "./probe-db.ts";

const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
// A local Worker keys the IP bucket on the `cf-connecting-ip` it is sent (a deployed one on the caller's address), and
// every lane posts from 127.0.0.1 to the one database: an address of the documentation range, new for each run, keeps
// another lane's hits out of this run's bucket.
const CLIENT_IP = `2001:db8::${Date.now().toString(16)}`;
const DOMAIN = "example.invalid";
const TIMEOUT_MS = 20_000;
const refusal = z.object({ error: z.object({ code: z.string(), requestId: z.string().min(8) }) });

interface Phase {
  accepted: number;
  refused: boolean;
}

const routeLimits = z.array(z.object({ scope: z.string(), store: z.string(), limit: z.number() }));

/**
 * The limits of the route's row in B3's table. The table's import graph reaches browser modules, which the scripts
 * program does not type (P-914), so Bun loads it in a child process and prints the row's limits.
 */
function limitsOf(path: string): z.infer<typeof routeLimits> {
  const code = [
    'import "./tests/fixtures/worker-env.ts";',
    'const { routes } = await import("./src/server/public/routes.ts");',
    `const row = routes.find((route) => route.path === ${JSON.stringify(path)} && route.method === "POST");`,
    "console.log(JSON.stringify(row?.limits ?? []));",
  ].join("\n");
  const printed = execFileSync("bun", ["--eval", code], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return routeLimits.parse(JSON.parse(printed.trim().split("\n").at(-1) ?? "[]"));
}

function dbLimit(limits: z.infer<typeof routeLimits>, path: string, scope: "ip" | "email"): number {
  const limit = limits.find((entry) => entry.store === "db" && entry.scope === scope)?.limit;
  if (limit === undefined) throw new Error(`rate-probe: ${path} has no database ${scope} limit`);
  return limit;
}

async function post(url: string, email: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-turnstile-token": TOKEN,
      "cf-connecting-ip": CLIENT_IP,
    },
    body: JSON.stringify({ email, source: "h1-probe", markets: [] }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/** Posts `emailAt(i)` until a 429, at most `cap` times; any status other than 201 or 429 throws. */
async function phase(url: string, cap: number, emailAt: (index: number) => string): Promise<Phase> {
  for (let index = 0; index < cap; index += 1) {
    const response = await post(url, emailAt(index));
    if (response.status === 201) {
      await response.body?.cancel();
      continue;
    }
    if (response.status !== 429) {
      throw new Error(
        `rate-probe: post ${String(index + 1)} answered ${String(response.status)}: ${await response.text()}`,
      );
    }
    const body = refusal.safeParse(await response.json());
    if (response.headers.get("retry-after") === null)
      throw new Error("rate-probe: a 429 without Retry-After");
    if (!body.success) throw new Error("rate-probe: a 429 without error.requestId");
    return { accepted: index, refused: true };
  }
  return { accepted: cap, refused: false };
}

async function cleanup(db: ProbeDb, start: string): Promise<void> {
  const ids = async (text: string, params: unknown[]) =>
    (await db.rows(text, params)).flatMap((row) =>
      row["id"] === null || row["id"] === undefined ? [] : [row["id"]],
    );
  const subscribers = await ids("select id::text as id from subscribers where email like $1", [
    `h1-probe+%@${DOMAIN}`,
  ]);
  const events = await ids(
    "select id::text as id from events where entity = 'subscriber' and entity_id::text = any($1::text[])",
    [subscribers],
  );
  const jobs = await ids("select id::text as id from jobs where event_id::text = any($1::text[])", [
    events,
  ]);
  await db.cleanup({
    subscribers,
    events,
    jobs,
    job_events: await ids(
      "select id::text as id from job_events where job_id::text = any($1::text[])",
      [jobs],
    ),
    rate_limits: await ids(
      "select id::text as id from rate_limits where bucket like 'subscribers:%' and at >= $1",
      [start],
    ),
  });
}

async function main(): Promise<number> {
  const [url, capText = "30"] = process.argv.slice(2);
  const cap = Number(capText);
  if (url === undefined || !URL.canParse(url) || !Number.isInteger(cap) || cap < 1) {
    console.error("usage: bun run scripts/harden/rate-probe.ts <base>/api/public/subscribers [n]");
    return 64;
  }
  const path = new URL(url).pathname;
  const limits = limitsOf(path);
  const emailLimit = dbLimit(limits, path, "email");
  const ipLimit = dbLimit(limits, path, "ip");
  const dbUrl = process.env["DEV_DB_URL"];
  await assertNotProduction({ dbUrl });
  const db = await openProbeDb(dbUrl ?? "");
  const start = await db.now();
  const run = Date.now().toString();
  let failure: string | null = null;
  try {
    const first = await phase(url, cap, () => `h1-probe+${run}@${DOMAIN}`);
    const second = await phase(url, cap, (index) => `h1-probe+${run}-${String(index)}@${DOMAIN}`);
    const want = [Math.min(emailLimit, ipLimit), ipLimit - Math.min(emailLimit, ipLimit)];
    const got = [first, second].map((result) => (result.refused ? result.accepted : -1));
    if (got[0] !== want[0] || got[1] !== want[1]) {
      failure = `rate-probe: expected ${String(want[0])} then ${String(want[1])} x 201 before each 429, got ${got.map((count) => (count < 0 ? "no 429" : String(count))).join(" then ")}`;
    } else {
      console.log(
        `rate ok (phase 1: ${String(want[0])} x 201 then 429; phase 2: ${String(want[1])} x 201 then 429)`,
      );
    }
  } finally {
    try {
      await cleanup(db, start);
    } finally {
      await db.close();
    }
  }
  if (failure !== null) {
    console.error(failure);
    return 1;
  }
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

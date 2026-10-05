// `node scripts/cpu-gate.mjs <scriptName>`: the CPU gate of a preview (T-11, ruling H27). It asks Cloudflare's GraphQL
// Analytics API for the P50 and P99 CPU time of the Worker over the last 15 minutes, polls every 30 seconds for up to
// 5 minutes until data arrives, prints `cpu p50 <ms> p99 <ms>` and exits 1 when P50 is above `cpuMs.p50` of
// `budget.json`. It exits 2 printing `BLOCKED CF_ANALYTICS_TOKEN` (or CLOUDFLARE_ACCOUNT_ID) when one is unset, never a
// silent pass. `queryWorkersInvocations` is the one GraphQL query text of the repository: B14's collector imports it
// with its own `fields`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const WINDOW_MS = 15 * 60_000;
const POLL_EVERY_MS = 30_000;
const POLL_FOR_MS = 5 * 60_000;
const DEFAULT_FIELDS = "quantiles { cpuTimeP50 cpuTimeP99 }";
const MICROSECONDS_PER_MS = 1000;

const answerSchema = z.object({
  data: z
    .object({
      viewer: z.object({
        accounts: z.array(z.object({ workersInvocationsAdaptive: z.array(z.unknown()) })),
      }),
    })
    .nullable(),
  errors: z.array(z.object({ message: z.string() })).nullish(),
});

const quantilesSchema = z.object({
  quantiles: z.object({ cpuTimeP50: z.number(), cpuTimeP99: z.number() }),
});

/**
 * One query of `workersInvocationsAdaptive` for one script and one time window.
 * @param {{
 *   accountId: string,
 *   token: string,
 *   scriptName: string,
 *   since: Date,
 *   until: Date,
 *   fields?: string,
 *   fetchFn?: (url: string, init: RequestInit) => Promise<Response>,
 * }} options
 * @returns {Promise<unknown[]>} the rows, none when no invocation fell in the window
 */
export async function queryWorkersInvocations({
  accountId,
  token,
  scriptName,
  since,
  until,
  fields = DEFAULT_FIELDS,
  fetchFn = fetch,
}) {
  const query = `query ($accountTag: string!, $scriptName: string!, $since: Time!, $until: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 10000, filter: { scriptName: $scriptName, datetime_geq: $since, datetime_leq: $until }) {
        ${fields}
      }
    }
  }
}`;
  const response = await fetchFn(ENDPOINT, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: {
        accountTag: accountId,
        scriptName,
        since: since.toISOString(),
        until: until.toISOString(),
      },
    }),
  });
  if (!response.ok) throw new Error(`GraphQL Analytics answered ${String(response.status)}`);
  const answer = answerSchema.parse(await response.json());
  if (answer.errors !== undefined && answer.errors !== null && answer.errors.length > 0) {
    throw new Error(answer.errors.map((error) => error.message).join("; "));
  }
  return answer.data?.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
}

/**
 * @param {string} scriptName
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   limit: number,
 *   fetchFn?: (url: string, init: RequestInit) => Promise<Response>,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   print?: (line: string) => void,
 * }} options `limit` is `cpuMs.p50` of `budget.json`
 * @returns {Promise<number>} the exit code
 */
export async function runCpuGate(
  scriptName,
  {
    env = process.env,
    limit,
    fetchFn = fetch,
    sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
    now = Date.now,
    print = (line) => process.stdout.write(`${line}\n`),
  },
) {
  const token = env["CF_ANALYTICS_TOKEN"];
  if (token === undefined || token === "") {
    print("BLOCKED CF_ANALYTICS_TOKEN");
    return 2;
  }
  const accountId = env["CLOUDFLARE_ACCOUNT_ID"];
  if (accountId === undefined || accountId === "") {
    print("BLOCKED CLOUDFLARE_ACCOUNT_ID");
    return 2;
  }
  const deadline = now() + POLL_FOR_MS;
  for (;;) {
    const rows = await queryWorkersInvocations({
      accountId,
      token,
      scriptName,
      since: new Date(now() - WINDOW_MS),
      until: new Date(now()),
      fetchFn,
    });
    const parsed = quantilesSchema.safeParse(rows[0]);
    if (parsed.success) {
      const p50 = parsed.data.quantiles.cpuTimeP50 / MICROSECONDS_PER_MS;
      const p99 = parsed.data.quantiles.cpuTimeP99 / MICROSECONDS_PER_MS;
      print(`cpu p50 ${p50.toFixed(1)} p99 ${p99.toFixed(1)}`);
      if (p50 > limit) {
        print(`cpu gate: p50 ${p50.toFixed(1)} ms is above the budget of ${String(limit)} ms`);
        return 1;
      }
      return 0;
    }
    if (now() + POLL_EVERY_MS > deadline) {
      print(`cpu gate: no invocation of ${scriptName} reached the analytics in 5 minutes`);
      return 1;
    }
    await sleep(POLL_EVERY_MS);
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scriptName = process.argv[2];
  if (scriptName === undefined || scriptName === "") {
    process.stdout.write("usage: node scripts/cpu-gate.mjs <scriptName>\n");
    process.exit(64);
  }
  const { cpuMs } = z
    .object({ cpuMs: z.object({ p50: z.number() }) })
    .parse(JSON.parse(readFileSync(new URL("../budget.json", import.meta.url), "utf8")));
  process.exitCode = await runCpuGate(scriptName, { limit: cpuMs.p50 });
}

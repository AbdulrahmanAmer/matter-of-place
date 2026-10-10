// `bun run scripts/harden/cpu-probe.ts <baseUrl> [n]` (H1-30) sends `n` (default 200) requests across the six pages of
// `budget.json` and reads what `wrangler tail --format json` reports for them: every invocation must end `ok` (an
// `exceededCpu` is error 1102 on the free plan) and the 95th percentile of `cpuTime` must stay under 8 ms (the free plan
// allows 10, G-011). `--fixture <file>` reads recorded tail output instead of a live tail and judges it the same way.
//
// The live half needs the Workers Tail Read permission, which the deploy token lacks (E1): run it from the owner's shell
// with the local `mop-admin` token and its `CLOUDFLARE_ACCOUNT_ID` set (P-840, `docs/runbooks/api.md`, "CPU on a
// preview"). Each page is requested once before the tail opens, so the measured window is the stored answer where the
// edge serves one; the `x-mop-cache` values of the measured requests are printed with the figures. Requests carry
// `?h1cpu=<run>`, which pages ignore and the tail event keeps, so another visitor's request is not counted. A tail drops
// events under a burst (P-842): requests are paced and a window that kept fewer than 90 percent of them is red.
import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { readFileSync } from "node:fs";
import { setTimeout as pause } from "node:timers/promises";
import { parseArgs } from "node:util";
import { z } from "zod";

const REQUESTS = 200;
const PACE_MS = 120;
const TIMEOUT_MS = 20_000;
const CONNECT_LIMIT_MS = 30_000;
const SETTLE_MS = 5000;
const P95_LIMIT_MS = 8;
const KEPT_AT_LEAST = 0.9;

const tailEvent = z.object({
  outcome: z.string(),
  cpuTime: z.number().optional(),
  event: z.object({ request: z.object({ url: z.string(), method: z.string() }) }).optional(),
});
type TailEvent = z.infer<typeof tailEvent>;

/**
 * The events of tail output: indented objects each closed by a line that is a single `}` (P-840), after any status text
 * wrangler prints first. A chunk that is not an event throws.
 */
function eventsOf(text: string): TailEvent[] {
  const start = text.search(/^\{/m);
  if (start === -1) return [];
  return text
    .slice(start)
    .split(/^\}[ \t]*$/m)
    .filter((chunk) => chunk.trim() !== "")
    .map((chunk) => tailEvent.parse(JSON.parse(`${chunk.trim()}\n}`)));
}

/** The nearest-rank percentile of a list of numbers. */
function percentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

interface Verdict {
  detail: string;
  problems: string[];
}

function judge(events: readonly TailEvent[], sent: number | undefined, served: string): Verdict {
  const problems: string[] = [];
  const outcomes = new Map<string, number>();
  for (const event of events) outcomes.set(event.outcome, (outcomes.get(event.outcome) ?? 0) + 1);
  for (const [outcome, count] of outcomes) {
    if (outcome !== "ok") {
      problems.push(
        `${String(count)} of ${String(events.length)} invocations ended ${outcome}${outcome === "exceededCpu" ? " (error 1102, the CPU limit of the free plan)" : ""}`,
      );
    }
  }
  if (events.length === 0) problems.push("the tail kept no invocation to judge");
  if (sent !== undefined && events.length < sent * KEPT_AT_LEAST) {
    problems.push(
      `the tail kept ${String(events.length)} of ${String(sent)} requests; run again at a slower pace (P-842)`,
    );
  }
  // An invocation cut off by the limit is a failure already; its cpuTime is where it was stopped, not a measure.
  const finished = events.filter((event) => event.outcome === "ok");
  const times = finished.flatMap((event) => (event.cpuTime === undefined ? [] : [event.cpuTime]));
  const p95 = percentile(times, 0.95);
  if (finished.length > 0 && times.length === 0) problems.push("the events carry no cpuTime");
  if (times.length > 0 && p95 >= P95_LIMIT_MS) {
    problems.push(`p95 cpuTime is ${String(p95)} ms, it must be under ${String(P95_LIMIT_MS)} ms`);
  }
  return {
    detail: `${String(events.length)} invocations, all ok, p95 ${String(p95)} ms, max ${String(Math.max(0, ...times))} ms, under ${String(P95_LIMIT_MS)} ms${served === "" ? "" : `; x-mop-cache ${served}`}`,
    problems,
  };
}

function stop(child: ChildProcessWithoutNullStreams): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGKILL");
  }
}

/** The Worker a base URL is served by: the first label of a `workers.dev` host, else the name in `wrangler.toml`. */
function workerOf(base: URL): string {
  if (base.hostname.endsWith(".workers.dev")) return base.hostname.split(".")[0] ?? "";
  const toml = readFileSync(new URL("../../wrangler.toml", import.meta.url), "utf8");
  return /^name\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? "";
}

async function get(url: string): Promise<string> {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  await response.arrayBuffer();
  return response.headers.get("x-mop-cache") ?? "none";
}

async function live(base: URL, requests: number): Promise<Verdict> {
  const pages = execFileSync("node", ["scripts/lhci-urls.mjs", base.origin], { encoding: "utf8" })
    .trim()
    .split("\n");
  for (const page of pages) await get(page);
  const run = Date.now().toString(36);
  const child = spawn("bunx", ["wrangler", "tail", workerOf(base), "--format", "json"], {
    windowsHide: true,
  });
  // The events come on stdout: a warning on stderr between two of them must not end up inside a chunk.
  let output = "";
  let tailed = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
    tailed += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  try {
    const deadline = Date.now() + CONNECT_LIMIT_MS;
    while (!output.includes("Connected")) {
      if (child.exitCode !== null || Date.now() > deadline) {
        throw new Error(`wrangler tail did not connect:\n${output.slice(-600)}`);
      }
      await pause(500);
    }
    const served = new Map<string, number>();
    for (let sent = 0; sent < requests; sent += 1) {
      const answer = await get(`${pages[sent % pages.length] ?? ""}?h1cpu=${run}`);
      served.set(answer, (served.get(answer) ?? 0) + 1);
      await pause(PACE_MS);
    }
    await pause(SETTLE_MS);
    const events = eventsOf(tailed).filter((event) =>
      event.event?.request.url.includes(`h1cpu=${run}`),
    );
    return judge(
      events,
      requests,
      [...served].map(([label, count]) => `${label} ${String(count)}`).join(", "),
    );
  } finally {
    stop(child);
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { fixture: { type: "string" } },
  });
  const [target, countText] = positionals;
  const requests = countText === undefined ? REQUESTS : Number(countText);
  const offline = values.fixture !== undefined;
  if (
    (!offline && (target === undefined || !URL.canParse(target))) ||
    !Number.isInteger(requests) ||
    requests < 1
  ) {
    console.error(
      "usage: bun run scripts/harden/cpu-probe.ts <baseUrl> [n]\n       bun run scripts/harden/cpu-probe.ts --fixture <file>",
    );
    return 64;
  }
  const verdict =
    values.fixture === undefined
      ? await live(new URL(target ?? ""), requests)
      : judge(eventsOf(readFileSync(values.fixture, "utf8")), undefined, "");
  for (const problem of verdict.problems) console.error(`cpu-probe: ${problem}`);
  if (verdict.problems.length === 0) console.log(`cpu ok (${verdict.detail})`);
  return verdict.problems.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

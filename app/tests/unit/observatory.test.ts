// scripts/observatory.mjs, B17 step 12. The scan answer has the shape the Observatory v2 API returned for
// example.com on 2026-10-07 (grade F, score 10); the host's own answer is a recorded set of headers.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse } from "yaml";
import { z } from "zod";
import { runObservatory } from "../../scripts/observatory.mjs";

const APP = resolve(import.meta.dirname, "../..");
const DEPLOY = resolve(APP, "../.github/workflows/deploy.yml");
const HOST = "pr-7.holy-meadow-4327.workers.dev";
const SCAN = "https://observatory-api.mdn.mozilla.net/api/v2/scan?host=" + HOST;

type Call = { method: string; url: string; signal: boolean };

function scanBody(grade: string | null, score = 105) {
  return {
    id: 126129694,
    details_url: `https://developer.mozilla.org/en-US/observatory/analyze?host=${HOST}`,
    error: grade === null ? "invalid-hostname-lookup" : null,
    grade,
    score,
  };
}

type Head = { headers: Record<string, string>; status?: number; refuse?: number };

/** `scan` answers the POST; `head` the HEAD of the host: status and headers, or a refusal that many times first. */
function server(scan: { status?: number; body: unknown }, head: Head) {
  const calls: Call[] = [];
  let refused = 0;
  const fetchImpl = (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, signal: init.signal instanceof AbortSignal });
    if (method === "POST") {
      return Promise.resolve(Response.json(scan.body, { status: scan.status ?? 200 }));
    }
    if (refused < (head.refuse ?? 0)) {
      refused += 1;
      return Promise.reject(new TypeError("fetch failed"));
    }
    return Promise.resolve(
      new Response(null, { status: head.status ?? 200, headers: head.headers }),
    );
  };
  return { calls, fetchImpl };
}

async function observe(scan: { status?: number; body: unknown }, head: Head) {
  const lines: string[] = [];
  const { calls, fetchImpl } = server(scan, head);
  const code = await runObservatory(HOST, { print: (line) => lines.push(line) }, fetchImpl);
  return { code, lines, calls };
}

const ENFORCING = { "content-security-policy": "default-src 'self'" };
const REPORT_ONLY = { "content-security-policy-report-only": "default-src 'self'" };

describe("runObservatory", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("prints the grade and exits 0 on a report-only policy whatever the grade", async () => {
    const { code, lines, calls } = await observe(
      { body: scanBody("F", 10) },
      { headers: REPORT_ONLY },
    );
    expect({ code, lines, calls }).toEqual({
      code: 0,
      lines: [
        `observatory: ${HOST} grade F score 10`,
        `details: https://developer.mozilla.org/en-US/observatory/analyze?host=${HOST}`,
        "policy: not enforcing, so the grade is reported and does not fail the run",
      ],
      calls: [
        { method: "POST", url: SCAN, signal: true },
        { method: "HEAD", url: `https://${HOST}/`, signal: true },
      ],
    });
  });

  it("exits 0 on a host with no policy header", async () => {
    const { code } = await observe({ body: scanBody("D", 40) }, { headers: {} });
    expect(code).toBe(0);
  });

  it("exits 1 on an enforcing policy with a grade below A", async () => {
    const grades = ["A-", "B+", "C", "F"];
    const codes = [];
    for (const grade of grades) {
      codes.push((await observe({ body: scanBody(grade) }, { headers: ENFORCING })).code);
    }
    expect(codes).toEqual([1, 1, 1, 1]);
  });

  it("names the failing grade when it exits 1", async () => {
    const { lines } = await observe({ body: scanBody("B", 75) }, { headers: ENFORCING });
    expect(lines.at(-1)).toBe("policy: enforcing, and B is below A");
  });

  it("exits 0 on an enforcing policy with A or A+", async () => {
    const codes = [];
    for (const grade of ["A", "A+"]) {
      codes.push((await observe({ body: scanBody(grade) }, { headers: ENFORCING })).code);
    }
    expect(codes).toEqual([0, 0]);
  });

  it("exits 2 when the scan answers without a grade", async () => {
    const { code, lines, calls } = await observe(
      { body: scanBody(null, 0) },
      { headers: ENFORCING },
    );
    expect({ code, lines, methods: calls.map((call) => call.method) }).toEqual({
      code: 2,
      lines: [`observatory: no grade for ${HOST}: status 200, error invalid-hostname-lookup`],
      methods: ["POST"],
    });
  });

  it("exits 2 when the scan answers an error status", async () => {
    const { code } = await observe(
      { status: 429, body: { error: "rate-limited" } },
      { headers: ENFORCING },
    );
    expect(code).toBe(2);
  });

  it("exits 2 when the scan answers an error status that still carries a grade", async () => {
    const { code, lines } = await observe(
      { status: 429, body: scanBody("A") },
      { headers: ENFORCING },
    );
    expect({ code, lines }).toEqual({
      code: 2,
      lines: [`observatory: no grade for ${HOST}: status 429, error null`],
    });
  });

  it("exits 2 when the host answers the request for its policy with an error status", async () => {
    const { code, lines } = await observe(
      { body: scanBody("F", 10) },
      { headers: {}, status: 503 },
    );
    expect({ code, last: lines.at(-1) }).toEqual({
      code: 2,
      last: `observatory: ${HOST} answered the request for its policy with status 503`,
    });
  });

  it("retries a refused connection and then reads the policy", async () => {
    vi.useFakeTimers();
    const run = observe({ body: scanBody("B") }, { headers: ENFORCING, refuse: 2 });
    await vi.advanceTimersByTimeAsync(5_000);
    const { code, calls } = await run;
    expect({ code, heads: calls.filter((call) => call.method === "HEAD").length }).toEqual({
      code: 1,
      heads: 3,
    });
  });

  it("exits 2 after three refused connections", async () => {
    vi.useFakeTimers();
    const run = observe({ body: scanBody("A") }, { headers: ENFORCING, refuse: 3 });
    await vi.advanceTimersByTimeAsync(5_000);
    const { code, lines } = await run;
    expect({ code, last: lines.at(-1) }).toEqual({
      code: 2,
      last: `observatory: HEAD https://${HOST}/: fetch failed`,
    });
  });

  it("names the request that failed and the code of the socket error under it", async () => {
    vi.useFakeTimers();
    const timedOut = new TypeError("fetch failed", {
      cause: Object.assign(new Error("connect timed out"), { code: "ETIMEDOUT" }),
    });
    const lines: string[] = [];
    const run = runObservatory(HOST, { print: (line) => lines.push(line) }, () =>
      Promise.reject(timedOut),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect({ code: await run, lines }).toEqual({
      code: 2,
      lines: [`observatory: POST ${SCAN}: fetch failed (ETIMEDOUT)`],
    });
  });
});

describe("the observatory command line", () => {
  it("refuses a missing host and a host that is not a bare name with exit 2", () => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["scripts/observatory.mjs", ...args], {
        cwd: APP,
        encoding: "utf8",
      });
    const answers = [run(), run("https://example.com/"), run("example.com", "extra"), run("a b")];
    expect(answers.map((answer) => [answer.status, answer.stdout.trim()])).toEqual(
      Array.from({ length: 4 }, () => [2, "usage: node scripts/observatory.mjs <host>"]),
    );
  });
});

const Step = z.object({
  name: z.string().optional(),
  id: z.string().optional(),
  "continue-on-error": z.boolean().optional(),
  "timeout-minutes": z.number().optional(),
  run: z.string().optional(),
  if: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const Deploy = z.object({ jobs: z.object({ preview: z.object({ steps: z.array(Step) }) }) });

describe.skipIf(!existsSync(DEPLOY))("the preview steps of deploy.yml (step 12)", () => {
  const steps = () => Deploy.parse(parse(readFileSync(DEPLOY, "utf8"))).jobs.preview.steps;
  const find = (name: string) => steps().find((step) => step.name === name);

  it("runs the browser install, the essentials spec and the observatory after the smoke and before B4's change test", () => {
    const at = (test: (step: z.infer<typeof Step>) => boolean) => steps().findIndex(test);
    const order = [
      at((step) => step.run === 'node scripts/smoke.mjs "$PREVIEW_URL"'),
      at((step) => step.run === "bun run test:e2e:install"),
      at((step) => step.name === "essentials"),
      at((step) => step.name === "observatory"),
      at((step) => step.name === "change test"),
    ];
    expect({
      found: order.every((index) => index >= 0),
      ordered: order.every((index, i) => i === 0 || index > (order[i - 1] ?? 0)),
    }).toEqual({ found: true, ordered: true });
  });

  it("points the essentials spec at the preview, live when it has a database, with CI left on, advisory under H67", () => {
    expect(find("essentials")).toEqual({
      name: "essentials",
      id: "essentials",
      "continue-on-error": true,
      run: "bun run test:e2e -- tests/e2e/essentials.spec.ts",
      env: {
        E2E_TARGET: "url",
        E2E_BASE_URL: "${{ env.PREVIEW_URL }}",
        E2E_MODE: "${{ env.HAS_DB == 'true' && 'live' || 'local' }}",
      },
    });
  });

  it("prints a red essentials step as a warning and in the job summary (H67), and only then", () => {
    const verdict = find("essentials verdict");
    expect({
      condition: verdict?.if,
      warns: verdict?.run?.includes("::warning title=essentials red on the preview::") ?? false,
      summary: verdict?.run?.includes("GITHUB_STEP_SUMMARY") ?? false,
    }).toEqual({
      condition: "${{ steps.essentials.outcome == 'failure' }}",
      warns: true,
      summary: true,
    });
  });

  it("bounds the Lighthouse step to 22 minutes and never makes it advisory (H71)", () => {
    const lighthouse = find("lighthouse");
    expect({
      id: lighthouse?.id,
      minutes: lighthouse?.["timeout-minutes"],
      advisory: lighthouse?.["continue-on-error"],
      bounded: lighthouse?.run?.includes("timeout 600 bun run lhci") ?? false,
    }).toEqual({ id: "lighthouse", minutes: 22, advisory: undefined, bounded: true });
  });

  it("runs Lighthouse at most twice, warns after the first miss and exits 1 after the second (H71)", () => {
    const run = find("lighthouse")?.run ?? "";
    expect({
      attempts: run.match(/for attempt in (.*); do/)?.[1],
      stopsAtSuccess: run.includes("exit 0"),
      warns: run.includes(
        "::warning title=lighthouse attempt $attempt did not finish::preview hang, retried (ruling H71)",
      ),
      refuses: run.trimEnd().endsWith("exit 1"),
    }).toEqual({ attempts: "1 2", stopsAtSuccess: true, warns: true, refuses: true });
  });

  it("scans the preview host and still prints the grade after a red essentials step", () => {
    const observatory = find("observatory");
    expect({ run: observatory?.run, condition: observatory?.if }).toEqual({
      run: "node scripts/observatory.mjs pr-${{ github.event.number }}.holy-meadow-4327.workers.dev",
      condition: "${{ !cancelled() }}",
    });
  });
});

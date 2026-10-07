// scripts/observatory.mjs, B17 step 12. The scan answer has the shape the Observatory v2 API returned for
// example.com on 2026-10-07 (grade F, score 10); the host's own answer is a recorded set of headers.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runObservatory } from "../../scripts/observatory.mjs";

const APP = resolve(import.meta.dirname, "../..");
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
    expect({ code, last: lines.at(-1) }).toEqual({ code: 2, last: "observatory: fetch failed" });
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

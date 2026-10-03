// scripts/smoke.mjs, gate G22 (B1b step 6). The answers are the headers `bun run cf:preview`
// gave on 2026-10-02 (MOP_ENV=local), served from a base URL whose host decides the robots rule.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runSmoke } from "../../scripts/smoke.mjs";

const APP = resolve(import.meta.dirname, "../..");
const PREVIEW = "https://pr-7.holy-meadow-4327.workers.dev";
const ASSET = "/assets/index-CjMsGoTQ.js";
const NOINDEX = "noindex, nofollow";

type Answer = {
  status: number;
  headers: Record<string, string | null>;
  body?: string;
  /** Unset: a fresh id per call. Null: no header. A string: that id on every call. */
  id?: string | null;
};
type Call = { method: string; path: string; redirect: string; signal: boolean };

const SECURITY = { "x-content-type-options": "nosniff", "x-frame-options": "DENY" };
const PAGE_PATHS = ["/properties", "/markets", "/california", "/stories", "/submit", "/contact"];

function recorded(robotsTag: string | null = NOINDEX): Map<string, Answer> {
  const page = (extra: Record<string, string> = {}): Answer => ({
    status: 200,
    headers: { ...SECURITY, "x-robots-tag": robotsTag, ...extra },
  });
  const answers = new Map<string, Answer>(PAGE_PATHS.map((path) => [`GET ${path}`, page()]));
  answers.set("GET /", {
    ...page({ "cache-control": "public, max-age=0, must-revalidate" }),
    body: `<!DOCTYPE html><html><head><link rel="modulepreload" href="${ASSET}"/></head></html>`,
  });
  answers.set("GET /sitemap.xml", page({ "content-type": "application/xml; charset=utf-8" }));
  answers.set(`HEAD ${ASSET}`, {
    status: 200,
    headers: { "cache-control": "public, max-age=31536000, immutable", ...SECURITY },
  });
  answers.set("HEAD /media/tiburon-waterline.mp4", {
    status: 200,
    headers: { "cache-control": "public, max-age=604800", ...SECURITY },
  });
  answers.set("POST /api/hooks/sentry-test", {
    status: 404,
    headers: { "cache-control": "no-store", ...SECURITY },
  });
  return answers;
}

function edit(answers: Map<string, Answer>, key: string, change: (answer: Answer) => void) {
  const answer = answers.get(key);
  if (answer === undefined) throw new Error(`no recorded answer for ${key}`);
  change(answer);
}

/** Serves the recorded answers; a key listed in `refuse` rejects that many times first. */
function server(answers: Map<string, Answer>, refuse: Record<string, number> = {}) {
  const calls: Call[] = [];
  let next = 0;
  const fetchImpl = (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const path = new URL(url).pathname;
    calls.push({
      method,
      path,
      redirect: String(init.redirect),
      signal: init.signal instanceof AbortSignal,
    });
    const key = `${method} ${path}`;
    const left = refuse[key] ?? 0;
    if (left > 0) {
      refuse[key] = left - 1;
      return Promise.reject(new TypeError("connect ECONNREFUSED"));
    }
    const answer = answers.get(key);
    if (answer === undefined) return Promise.reject(new Error(`unexpected request ${key}`));
    next += 1;
    const headers = new Headers();
    for (const [name, value] of Object.entries(answer.headers)) {
      if (value !== null) headers.set(name, value);
    }
    const id = answer.id === undefined ? `id-${String(next).padStart(8, "0")}` : answer.id;
    if (id !== null) headers.set("x-request-id", id);
    return Promise.resolve(new Response(answer.body ?? "", { status: answer.status, headers }));
  };
  return { calls, fetchImpl };
}

async function smoke(
  base: string,
  answers: Map<string, Answer>,
  options: { robots?: "noindex" | "indexable"; forceFail?: string } = {},
) {
  const lines: string[] = [];
  const { calls, fetchImpl } = server(answers);
  const code = await runSmoke(base, { ...options, print: (line) => lines.push(line) }, fetchImpl);
  return { code, lines, calls };
}

describe("runSmoke", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes a complete set of answers and prints one line per URL", async () => {
    const { code, lines, calls } = await smoke(PREVIEW, recorded());
    expect({
      code,
      lines,
      methods: calls.map((call) => `${call.method} ${call.path}`),
      manual: calls.every((call) => call.redirect === "manual" && call.signal),
    }).toEqual({
      code: 0,
      lines: [
        ...["/", ...PAGE_PATHS, "/sitemap.xml", "/", ASSET, "/media/tiburon-waterline.mp4"].map(
          (path) => `ok   ${PREVIEW}${path}`,
        ),
        `ok   ${PREVIEW}/api/hooks/sentry-test`,
        `smoke: OK ${PREVIEW}`,
      ],
      methods: [
        ...["/", ...PAGE_PATHS, "/sitemap.xml", "/"].map((path) => `GET ${path}`),
        `HEAD ${ASSET}`,
        "HEAD /media/tiburon-waterline.mp4",
        "POST /api/hooks/sentry-test",
      ],
      manual: true,
    });
  });

  it.each([
    {
      name: "no x-request-id on /properties",
      key: "GET /properties",
      change: (a: Answer) => (a.id = null),
      line: `FAIL ${PREVIEW}/properties: no x-request-id`,
    },
    {
      name: "a 500 on /california",
      key: "GET /california",
      change: (a: Answer) => (a.status = 500),
      line: `FAIL ${PREVIEW}/california: status 500`,
    },
    {
      name: "no nosniff on /contact",
      key: "GET /contact",
      change: (a: Answer) => (a.headers["x-content-type-options"] = null),
      line: `FAIL ${PREVIEW}/contact: no nosniff`,
    },
    {
      name: "x-frame-options SAMEORIGIN on /stories",
      key: "GET /stories",
      change: (a: Answer) => (a.headers["x-frame-options"] = "SAMEORIGIN"),
      line: `FAIL ${PREVIEW}/stories: x-frame-options not DENY`,
    },
    {
      name: "no x-robots-tag on /markets",
      key: "GET /markets",
      change: (a: Answer) => (a.headers["x-robots-tag"] = null),
      line: `FAIL ${PREVIEW}/markets: x-robots-tag missing, expected ${NOINDEX}`,
    },
    {
      name: "one request id on both requests of /",
      key: "GET /",
      change: (a: Answer) => (a.id = "same-id-0001"),
      line: `FAIL ${PREVIEW}/: same x-request-id twice`,
    },
    {
      name: "/ without must-revalidate",
      key: "GET /",
      change: (a: Answer) => (a.headers["cache-control"] = "public, max-age=0"),
      line: `FAIL ${PREVIEW}/: cache-control public, max-age=0, expected max-age=0 and must-revalidate`,
    },
    {
      name: "/ with no /assets/*.js in its HTML",
      key: "GET /",
      change: (a: Answer) => (a.body = "<!DOCTYPE html><html></html>"),
      line: `FAIL ${PREVIEW}/: no /assets/*.js in the HTML`,
    },
    {
      name: "an asset that is not immutable",
      key: `HEAD ${ASSET}`,
      change: (a: Answer) => (a.headers["cache-control"] = "public, max-age=31536000"),
      line: `FAIL ${PREVIEW}${ASSET}: cache-control public, max-age=31536000, expected immutable, max-age=31536000`,
    },
    {
      name: "an asset that answers 404",
      key: `HEAD ${ASSET}`,
      change: (a: Answer) => (a.status = 404),
      line: `FAIL ${PREVIEW}${ASSET}: status 404`,
    },
    {
      name: "an asset without nosniff",
      key: `HEAD ${ASSET}`,
      change: (a: Answer) => (a.headers["x-content-type-options"] = null),
      line: `FAIL ${PREVIEW}${ASSET}: no nosniff`,
    },
    {
      name: "the media file kept one hour",
      key: "HEAD /media/tiburon-waterline.mp4",
      change: (a: Answer) => (a.headers["cache-control"] = "public, max-age=3600"),
      line: `FAIL ${PREVIEW}/media/tiburon-waterline.mp4: cache-control public, max-age=3600, expected max-age=604800`,
    },
    {
      name: "the media file missing",
      key: "HEAD /media/tiburon-waterline.mp4",
      change: (a: Answer) => (a.status = 404),
      line: `FAIL ${PREVIEW}/media/tiburon-waterline.mp4: status 404`,
    },
    {
      name: "the hook merged no-store with private",
      key: "POST /api/hooks/sentry-test",
      change: (a: Answer) => (a.headers["cache-control"] = "no-store, private"),
      line: `FAIL ${PREVIEW}/api/hooks/sentry-test: cache-control no-store, private`,
    },
  ])("fails on $name and names the URL", async ({ key, change, line }) => {
    const answers = recorded();
    edit(answers, key, change);
    const { code, lines } = await smoke(PREVIEW, answers);
    expect({ code, failed: lines.filter((l) => l.startsWith("FAIL")) }).toEqual({
      code: 1,
      failed: [line],
    });
  });

  it("requires no x-robots-tag on matterofplace.com", async () => {
    const clean = await smoke("https://matterofplace.com", recorded(null));
    const tagged = await smoke("https://matterofplace.com", recorded());
    expect([clean.code, tagged.code, tagged.lines[1]]).toEqual([
      0,
      1,
      `FAIL https://matterofplace.com/properties: x-robots-tag ${NOINDEX}, expected none`,
    ]);
  });

  it("lets another host follow the flag, noindex by default", async () => {
    const local = "http://127.0.0.1:8788";
    const results = await Promise.all([
      smoke(local, recorded()),
      smoke(local, recorded(null), { robots: "indexable" }),
      smoke(local, recorded(), { robots: "indexable" }),
      smoke(local, recorded(null)),
    ]);
    expect(results.map((result) => result.code)).toEqual([0, 0, 1, 1]);
  });

  it("exits 2 before any request when the flag contradicts the host", async () => {
    const results = await Promise.all([
      smoke(PREVIEW, recorded(), { robots: "indexable" }),
      smoke("https://matterofplace.com", recorded(null), { robots: "noindex" }),
    ]);
    expect(results.map((result) => [result.code, result.calls.length, result.lines[1]])).toEqual([
      [2, 0, "--expect-indexable contradicts the host pr-7.holy-meadow-4327.workers.dev"],
      [2, 0, "--expect-noindex contradicts the host matterofplace.com"],
    ]);
  });

  it("returns 1 before any fetch when SMOKE_FORCE_FAIL is 1 (DO-09)", async () => {
    const forced = await smoke(PREVIEW, recorded(), { forceFail: "1" });
    const unset = await smoke(PREVIEW, recorded(), { forceFail: "" });
    expect([forced.code, forced.calls.length, forced.lines, unset.code]).toEqual([
      1,
      0,
      ["smoke forced to fail (SMOKE_FORCE_FAIL)"],
      0,
    ]);
  });

  it("retries a refused connection and reports the third refusal", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const { calls, fetchImpl } = server(recorded(), { "GET /contact": 2, "GET /submit": 3 });
    const done = runSmoke(PREVIEW, { print: (line) => lines.push(line) }, fetchImpl);
    await vi.runAllTimersAsync();
    expect({
      code: await done,
      contact: calls.filter((call) => call.path === "/contact").length,
      failed: lines.filter((line) => line.startsWith("FAIL")),
    }).toEqual({
      code: 1,
      contact: 3,
      failed: [`FAIL ${PREVIEW}/submit: no answer after 3 attempts: connect ECONNREFUSED`],
    });
  });
});

describe("the smoke command line", () => {
  it("refuses a missing base URL, an unknown flag and two flags with exit 2", () => {
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["scripts/smoke.mjs", ...args], { cwd: APP, encoding: "utf8" });
    const answers = [
      run(),
      run("http://127.0.0.1:8788", "--bogus"),
      run("http://127.0.0.1:8788", "--expect-noindex", "--expect-indexable"),
      run("not a url"),
    ];
    expect(answers.map((answer) => [answer.status, answer.stdout.trim()])).toEqual(
      Array.from({ length: 4 }, () => [
        2,
        "usage: node scripts/smoke.mjs <baseUrl> [--expect-noindex|--expect-indexable]",
      ]),
    );
  });
});

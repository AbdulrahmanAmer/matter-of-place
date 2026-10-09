// scripts/lhci-pages.mjs, ruling H76: the pure half (arguments, the lhci command, the classification of a run, the retry
// decision, the url line, the summary and the exit code). The run itself needs a served build and Chrome; its proof is
// a real run against `wrangler dev` (the slice log of H76).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DEFAULT_CONFIG,
  classify,
  failureTail,
  lhciArgs,
  notRun,
  parseArgs,
  readOutput,
  reason,
  retryAfter,
  slugOf,
  stopsRun,
  summary,
  verdict,
  warning,
} from "../../scripts/lhci-pages.mjs";

const URL = "http://127.0.0.1:8976/submit";

type Attempt = Parameters<typeof classify>[0];

const ran = (over: Partial<Attempt> = {}): Attempt => ({
  code: 0,
  signal: null,
  timedOut: false,
  output: "Running Lighthouse 3 time(s) on x\nRun #1...done.\nDone running autorun.\n",
  seconds: 95,
  ...over,
});

// The real tails of @lhci/cli 0.15.1, measured on this laptop (the H76 slice log).
const ASSERTION_OUTPUT = [
  "Checking assertions against 1 URL(s), 1 total run(s)",
  "",
  "1 result(s) for http://127.0.0.1:8976/ :",
  "",
  "  X  resource-summary.document.size failure for maxNumericValue assertion",
  "",
  "Assertion failed. Exiting with status code 1.",
  "assert command failed. Exiting with status code 1.",
].join("\n");
const NAVSTART_OUTPUT = [
  "Running Lighthouse 3 time(s) on http://127.0.0.1:8976/",
  "Run #1...failed!",
  "Error: Lighthouse failed with exit code 1",
  "Runtime error encountered: Something went wrong with recording the trace over your page load. Please run Lighthouse again. (NO_NAVSTART)",
].join("\n");

const assertionFailed = ran({ code: 1, output: ASSERTION_OUTPUT });
const navstart = ran({ code: 1, output: NAVSTART_OUTPUT });
const hung = ran({
  code: null,
  signal: "SIGINT",
  timedOut: true,
  seconds: 240,
  output: "Run #1...",
});

describe("parseArgs", () => {
  it("reads the base url and defaults to lighthouserc.json, 180 s a url and 1200 s in all", () => {
    expect([
      parseArgs(["http://127.0.0.1:8976/"]),
      parseArgs([
        "https://pr-1.x.dev",
        "--config",
        "a.json",
        "--bound-seconds",
        "60",
        "--total-seconds",
        "600",
        "--out-dir",
        "logs",
      ]),
    ]).toEqual([
      {
        base: "http://127.0.0.1:8976",
        config: "lighthouserc.json",
        boundSeconds: 180,
        totalSeconds: 1200,
        outDir: ".lighthouseci-pages",
      },
      {
        base: "https://pr-1.x.dev",
        config: "a.json",
        boundSeconds: 60,
        totalSeconds: 600,
        outDir: "logs",
      },
    ]);
  });

  it("refuses no url, an unknown flag, a bound under 30 s or a total under the bound", () => {
    const answers = [
      parseArgs([]),
      parseArgs(["127.0.0.1:8976"]),
      parseArgs(["http://x", "--runs", "1"]),
      parseArgs(["http://x", "--bound-seconds", "10"]),
      parseArgs(["http://x", "--bound-seconds", "300", "--total-seconds", "200"]),
    ];
    expect(
      answers.map((answer) => typeof answer === "string" && answer.startsWith("usage:")),
    ).toEqual([true, true, true, true, true]);
  });
});

describe("lhciArgs", () => {
  it("with the default config is the lhci script of package.json with one url, logging at info", () => {
    const scripts = z
      .object({ scripts: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readFileSync("package.json", "utf8"))).scripts;
    expect(["lhci", ...lhciArgs(DEFAULT_CONFIG, URL)].join(" ")).toBe(
      `${scripts["lhci"] ?? ""} --collect.url=${URL} --collect.settings.logLevel=info`,
    );
  });
});

describe("slugOf and failureTail, the per-page files and the lines a failure prints", () => {
  it("names a page's files by its path, the root as home", () => {
    expect([
      slugOf("http://127.0.0.1:8976/"),
      slugOf("https://pr-1.x.dev/property/west-village-townhouse"),
    ]).toEqual(["home", "property-west-village-townhouse"]);
  });

  it("prints the last 10 lines of Lighthouse's log for a hung run, of lhci's output otherwise", () => {
    const status = Array.from({ length: 14 }, (_, i) => `LH:status step ${String(i + 1)}`);
    const lighthouseLog = `${status.join("\r\n")}\r\n\r\n`;
    expect([
      failureTail(hung, lighthouseLog),
      failureTail(hung, ""),
      failureTail(navstart, lighthouseLog).at(-1),
    ]).toEqual([status.slice(-10), ["Run #1..."], NAVSTART_OUTPUT.split("\n").at(-1)]);
  });
});

describe("classify", () => {
  it("reads exit 0 as a pass, the assertion marker as an assertion failure and a broken run as runtime", () => {
    expect([
      classify(ran()),
      classify(assertionFailed),
      classify(navstart),
      classify(hung),
      classify(ran({ code: null, signal: "SIGTERM", output: "" })),
      classify(
        ran({ code: 1, output: "Run #2...failed!\nError: Lighthouse failed with exit code 1" }),
      ),
      classify(ran({ code: 1, output: "Error: PROTOCOL_TIMEOUT" })),
    ]).toEqual(["pass", "assertion", "runtime", "runtime", "runtime", "runtime", "runtime"]);
  });

  it("reads an exit 1 without either marker as other, neither pass nor a runtime error", () => {
    expect(classify(ran({ code: 1, output: "Healthcheck failed!\n" }))).toBe("other");
  });
});

describe("reason", () => {
  it("names the bound, the signal, the Lighthouse error code or the failed run", () => {
    expect([
      reason(hung),
      reason(ran({ code: null, signal: "SIGTERM" })),
      reason(navstart),
      reason(ran({ code: 1, output: "Run #2...failed!" })),
      reason(ran({ code: 7, output: "" })),
    ]).toEqual([
      "stopped at its bound after 240 s",
      "ended by SIGTERM",
      "NO_NAVSTART",
      "run #2 failed",
      "exit 7",
    ]);
  });
});

describe("retryAfter, the one retry of ruling H76", () => {
  it("retries a runtime failure once and never a pass, an assertion failure or other", () => {
    expect([
      retryAfter([navstart]),
      retryAfter([hung]),
      retryAfter([navstart, hung]),
      retryAfter([ran()]),
      retryAfter([assertionFailed]),
      retryAfter([ran({ code: 1, output: "" })]),
      retryAfter([]),
    ]).toEqual([true, true, false, false, false, false, false]);
  });
});

describe("verdict, one line per url", () => {
  it("passes a url on the first run or on the retry, and says so", () => {
    expect([verdict(URL, [ran()], 1200), verdict(URL, [hung, ran()], 1200)]).toEqual([
      { url: URL, passed: true, retried: false, line: `lighthouse ${URL}: pass` },
      {
        url: URL,
        passed: true,
        retried: true,
        line: `lighthouse ${URL}: pass (runtime, retried: stopped at its bound after 240 s)`,
      },
    ]);
  });

  it("fails an assertion failure without a retry, and a runtime failure after one", () => {
    expect(
      [
        verdict(URL, [assertionFailed], 1200),
        verdict(URL, [navstart, assertionFailed], 1200),
        verdict(URL, [navstart, hung], 1200),
      ].map((one) => [one.passed, one.line]),
    ).toEqual([
      [false, `lighthouse ${URL}: fail (assertion)`],
      [false, `lighthouse ${URL}: fail (assertion, after a runtime retry: NO_NAVSTART)`],
      [
        false,
        `lighthouse ${URL}: fail (runtime, retried: NO_NAVSTART; stopped at its bound after 240 s)`,
      ],
    ]);
  });

  it("fails a url the total had no room for, or no room to retry, and other failures unretried", () => {
    expect(
      [
        verdict(URL, [], 1200),
        verdict(URL, [navstart], 1200),
        verdict(URL, [ran({ code: 3, output: "" })], 1200),
      ].map((one) => one.line),
    ).toEqual([
      `lighthouse ${URL}: fail (not run: the total of 1200 s was spent)`,
      `lighthouse ${URL}: fail (runtime: NO_NAVSTART, not retried: the total of 1200 s was spent)`,
      `lighthouse ${URL}: fail (exit 3, not a runtime error, not retried)`,
    ]);
  });
});

describe("stopsRun and notRun, the end of the run at a page that failed twice", () => {
  it("stops after a page failed both attempts, never after a pass, a retried pass or an assertion", () => {
    expect(
      [
        verdict(URL, [navstart, hung], 1200),
        verdict(URL, [navstart, assertionFailed], 1200),
        verdict(URL, [ran()], 1200),
        verdict(URL, [hung, ran()], 1200),
        verdict(URL, [assertionFailed], 1200),
      ].map(stopsRun),
    ).toEqual([true, true, false, false, false]);
    expect(notRun(`${URL}x`, URL)).toEqual({
      url: `${URL}x`,
      passed: false,
      retried: false,
      line: `lighthouse ${URL}x: fail (not run: ${URL} failed both attempts)`,
    });
  });
});

describe("summary and the exit code", () => {
  it("exits 0 only when every url passed, and counts the retried urls", () => {
    const pass = verdict(URL, [ran()], 1200);
    const retried = verdict(URL, [hung, ran()], 1200);
    const failed = verdict(URL, [assertionFailed], 1200);
    expect([summary([pass, retried]), summary([pass, failed]), summary([])]).toEqual([
      { line: "lighthouse: 2 urls, 2 passed, 0 failed, 1 retried (ruling H76)", code: 0 },
      { line: "lighthouse: 2 urls, 1 passed, 1 failed, 0 retried (ruling H76)", code: 1 },
      { line: "lighthouse: 0 urls, 0 passed, 0 failed, 0 retried (ruling H76)", code: 1 },
    ]);
  });
});

describe("warning and readOutput", () => {
  it("writes the retry annotation with the url escaped in its title", () => {
    expect(warning(URL, "NO_NAVSTART")).toBe(
      "::warning title=lighthouse http%3A//127.0.0.1%3A8976/submit retried::NO_NAVSTART, retried once (ruling H76)",
    );
  });

  it("reads its own url lines and summary back, and nothing without a summary", () => {
    const lines = [verdict(URL, [ran()], 1200).line, verdict(`${URL}x`, [hung, ran()], 1200).line];
    const text = [
      "Run #1...done.",
      ...lines,
      "",
      ...lines,
      summary([]).line.replace("0 urls", "2 urls"),
    ].join("\r\n");
    expect([readOutput(text)?.urls, readOutput(text)?.lines, readOutput("Run #1...")]).toEqual([
      2,
      lines,
      undefined,
    ]);
  });
});

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeContext } from "../../../../workspace/audits/tools/common.mjs";
import {
  collect,
  describeSecurity,
  judgeScripts,
  parseSecurityHeaders,
  probeRateLimit,
  scriptUrls,
  secretsIn,
} from "../../../../workspace/audits/tools/security.mjs";

// B14 step 5: the security collector against recorded header sets (fixtures/security-*.json) and a stub `fetch`.
// No test reaches a network.
const headerSet = (name: string): Headers =>
  new Headers(
    z
      .record(z.string(), z.string())
      .parse(
        JSON.parse(
          readFileSync(
            new URL(
              `../../../../workspace/audits/tools/fixtures/security-${name}.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ),
  );

const statusOf = (rows: { check: string; status: string }[], check: string) =>
  rows.find((row) => row.check === check)?.status;

describe("parseSecurityHeaders", () => {
  it("is green for all four headers present", () => {
    const rows = parseSecurityHeaders(headerSet("all-present"));
    expect(rows.map((row) => row.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(rows.map((row) => row.check)).toEqual([
      "content-security-policy",
      "strict-transport-security",
      "x-frame-options",
      "referrer-policy",
    ]);
  });

  it("makes a missing HSTS a red row and leaves the others green", () => {
    const rows = parseSecurityHeaders(headerSet("missing-hsts"));
    expect(statusOf(rows, "strict-transport-security")).toBe("red");
    expect(rows.filter((row) => row.status === "red")).toHaveLength(1);
  });

  it("makes a CSP sent only as Report-Only a watch row (F10)", () => {
    const rows = parseSecurityHeaders(headerSet("csp-report-only"));
    expect(statusOf(rows, "content-security-policy")).toBe("watch");
    expect(rows.filter((row) => row.status === "red")).toEqual([]);
  });

  it("makes a missing CSP a red row", () => {
    expect(statusOf(parseSecurityHeaders(headerSet("no-csp")), "content-security-policy")).toBe(
      "red",
    );
  });

  it("makes a missing X-Frame-Options and a missing Referrer-Policy red rows", () => {
    const rows = parseSecurityHeaders(
      new Headers({ "content-security-policy": "default-src 'self'" }),
    );
    expect(statusOf(rows, "x-frame-options")).toBe("red");
    expect(statusOf(rows, "referrer-policy")).toBe("red");
  });
});

/** A stub `fetch` that answers 429 from request `limitAt` of the search route on, and records every request. */
function searchWorld(siteUrl: string, limitAt: number | null) {
  const requests: { url: string; method: string; body: string }[] = [];
  let searches = 0;
  const ctx = makeContext({
    env: {},
    siteUrl,
    fetchImpl: (url, init) => {
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      });
      searches += 1;
      return Promise.resolve(
        new Response("{}", { status: limitAt !== null && searches >= limitAt ? 429 : 200 }),
      );
    },
  });
  return { ctx, requests };
}

describe("probeRateLimit", () => {
  it("reports the 429 of the 61st request and sends the documented body", async () => {
    const { ctx, requests } = searchWorld("http://127.0.0.1:8858", 61);
    const result = await probeRateLimit(ctx, "http://127.0.0.1:8858");
    expect(result).toMatchObject({ check: "rate_limit_search", status: "ok" });
    expect(result.detail).toContain("request 61 of 61");
    expect(requests).toHaveLength(61);
    expect(requests[0]).toEqual({
      url: "http://127.0.0.1:8858/api/public/search",
      method: "POST",
      body: '{"text":"audit probe"}',
    });
  });

  it("gives a red row when a local host never answers 429", async () => {
    const { ctx, requests } = searchWorld("http://127.0.0.1:8858", null);
    expect((await probeRateLimit(ctx, "http://127.0.0.1:8858")).status).toBe("red");
    expect(requests).toHaveLength(61);
  });

  it("gives a watch row on a local host when 61 requests took a minute, since the window may have reset", async () => {
    const times = [0, 61_000].map((ms) => new Date(ms));
    const { ctx } = searchWorld("http://127.0.0.1:8858", null);
    const slow = { ...ctx, now: () => times.shift() ?? new Date(61_000) };
    const result = await probeRateLimit(slow, "http://127.0.0.1:8858");
    expect(result.status).toBe("watch");
    expect(result.detail).toContain("slower than the one-minute window");
  });

  it("gives a watch row when a workers.dev host never answers 429", async () => {
    const base = "https://matter-of-place-dev.holy-meadow-4327.workers.dev";
    const { ctx } = searchWorld(base, null);
    expect((await probeRateLimit(ctx, base)).status).toBe("watch");
  });

  it("gives a watch row, not a failure, when the host cannot be reached", async () => {
    const ctx = makeContext({
      env: {},
      siteUrl: "http://127.0.0.1:1",
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });
    const result = await probeRateLimit(ctx, "http://127.0.0.1:1");
    expect(result.status).toBe("watch");
    expect(result.detail).toContain("ECONNREFUSED");
  });
});

describe("the served JavaScript", () => {
  const page =
    '<html><script type="module" src="/assets/index-a1.js"></script><link rel="modulepreload" href="/assets/form-b2.js"><script src="https://www.googletagmanager.com/gtag/js"></script><link rel="stylesheet" href="/assets/app.css"></html>';

  it("reads same-origin scripts and module preloads only", () => {
    expect(scriptUrls(page, "https://example.test/contact")).toEqual([
      "https://example.test/assets/index-a1.js",
      "https://example.test/assets/form-b2.js",
    ]);
  });

  it("finds the three secret patterns and names the pattern, never the value", () => {
    const key = `mopk_dev_${"A".repeat(43)}`;
    expect(secretsIn(`var k="${key}"`)).toEqual(["mopk_"]);
    expect(secretsIn(`var k="sk_${"x".repeat(24)}"`)).toEqual(["sk_"]);
    expect(secretsIn("-----BEGIN PRIVATE KEY-----")).toEqual(["-----BEGIN"]);
    expect(secretsIn("const task_id = 1; const disk_usage = 2;")).toEqual([]);
  });

  it("is red for a secret in a script and names where, without the value", () => {
    const secret = `sk_${"y".repeat(24)}`;
    const rows = judgeScripts(
      [{ path: "/", hasForm: false, scripts: ["https://example.test/assets/index-a1.js"] }],
      new Map([["https://example.test/assets/index-a1.js", `x="${secret}"`]]),
    );
    expect(rows[0]).toMatchObject({ check: "secrets_in_js", status: "red" });
    expect(rows[0]?.detail).toBe("sk_ in /assets/index-a1.js");
    expect(JSON.stringify(rows)).not.toContain(secret);
  });

  it("is red for a form page whose scripts never name Turnstile, green when one does", () => {
    const url = "https://example.test/assets/form-b2.js";
    const pages = [{ path: "/contact", hasForm: true, scripts: [url] }];
    expect(judgeScripts(pages, new Map([[url, "console.log(1)"]]))[1]).toMatchObject({
      check: "forms_turnstile",
      status: "red",
    });
    expect(
      judgeScripts(
        pages,
        new Map([[url, 'load("https://challenges.cloudflare.com/turnstile")']]),
      )[1]?.status,
    ).toBe("ok");
  });
});

describe("collect", () => {
  it("is not measured without a site URL and when the site does not answer", async () => {
    expect(await collect(makeContext({ env: {}, siteUrl: "" }))).toEqual({
      security: { notMeasured: "SITE_URL unset" },
    });
    const down = makeContext({
      env: {},
      siteUrl: "http://127.0.0.1:1",
      fetchImpl: () => Promise.reject(new Error("connect ECONNREFUSED")),
    });
    expect(describeSecurity(await collect(down))[0]).toContain("Not measured: security");
  });

  it("lists the four headers, the secret row, the form row and the 429 for a served site", async () => {
    const headers = headerSet("csp-report-only");
    const html = '<form></form><script type="module" src="/assets/index-a1.js"></script>';
    const ctx = makeContext({
      env: {},
      siteUrl: "http://127.0.0.1:8858",
      fetchImpl: (url) => {
        const path = new URL(url).pathname;
        if (path === "/api/public/search")
          return Promise.resolve(new Response("{}", { status: 429 }));
        if (path === "/assets/index-a1.js") {
          return Promise.resolve(new Response('"https://challenges.cloudflare.com/turnstile"'));
        }
        return Promise.resolve(new Response(html, { status: 200, headers: new Headers(headers) }));
      },
    });
    const lines = describeSecurity(await collect(ctx));
    expect(lines).toEqual([
      "host 127.0.0.1",
      "watch  content-security-policy  Report-Only, not enforcing yet (F10)",
      "ok  strict-transport-security  Strict-Transport-Security: max-age=31536000; includeSubDomains",
      "ok  x-frame-options  X-Frame-Options: DENY",
      "ok  referrer-policy  Referrer-Policy: strict-origin-when-cross-origin",
      "ok  secrets_in_js  scripts read: 1, none holds a secret pattern",
      "ok  forms_turnstile  4 pages with a form load a script that names Turnstile",
      "ok  rate_limit_search  429 on request 1 of 61",
    ]);
  });

  it("exits 0 from the command line whatever it finds", () => {
    const cli = fileURLToPath(
      new URL("../../../../workspace/audits/tools/security.mjs", import.meta.url),
    );
    const result = spawnSync(process.execPath, [cli, "--url", "http://127.0.0.1:1"], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Not measured: security");
  });
});

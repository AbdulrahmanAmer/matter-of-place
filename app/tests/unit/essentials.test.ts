// B17: the essentials slice. Each title starts with the `-t` name the plan's steps use.
import "../fixtures/worker-env";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { createMemoryHistory } from "@tanstack/react-router";
import {
  attachRouterServerSsrUtils,
  renderRouterToString,
  RouterServer,
} from "@tanstack/react-router/ssr/server";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cspReportBatchSchema } from "../../src/domain/contracts";
import { defaultFlags, featureFlags } from "../../src/domain/flags";
import { getRouter } from "../../src/router";
import { CSP_INLINE_ALLOWLIST } from "../../src/server/lib/csp-allowlist";
import { mergeFlags } from "../../src/server/lib/flags";
import { cspFor, inlineHashes, securityHeaders } from "../../src/server/lib/headers";
import { handle, type PipelineContext, type PipelineDeps } from "../../src/server/lib/pipeline";
import { captureException } from "../../src/server/lib/sentry";
import { fakeDb } from "../fixtures/fake-db";
import { stateJson } from "../fixtures/snapshot";

vi.mock("../../src/server/lib/sentry", { spy: true });

const BASE = "https://matterofplace.com";
const REPORT_ONLY = "content-security-policy-report-only";
const ENFORCING = "content-security-policy";
const TURNSTILE = "https://challenges.cloudflare.com";

const get = (path: string, init?: RequestInit) => new Request(`${BASE}${path}`, init);
const sha256 = (text: string) => createHash("sha256").update(text).digest("base64");
const directive = (policy: string, name: string) =>
  policy.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";

const FIRST_TSR = "window.$_TSR={router:{matches:[]}};";
const SECOND_TSR = "$_TSR.e();";
const ALLOWED = CSP_INLINE_ALLOWLIST[0] ?? "";
const FIXTURE_PAGE = [
  "<!DOCTYPE html><html><head>",
  '<link rel="stylesheet" href="/assets/app.css" data-precedence="default"/>',
  '<link rel="stylesheet" href="https://elsewhere.test/other.css"/>',
  '<script type="application/ld+json">{"@type":"Organization"}</script>',
  '<script type="application/json">{"a":1}</script>',
  `<script class="$tsr" id="$tsr-stream-barrier">${FIRST_TSR}</script>`,
  `<script>${ALLOWED}</script>`,
  "<style>.a{color:red}</style>",
  '<script type="module" async="" src="/assets/entry.js"></script>',
  "</head><body><p>page</p>",
  `<script class="$tsr">${SECOND_TSR}</script>`,
  "</body></html>",
].join("");
const withUnmarked = (count: number) =>
  FIXTURE_PAGE.replace(
    "</body>",
    `${Array.from({ length: count }, (_, index) => `<script>unmarked(${String(index)});</script>`).join("")}</body>`,
  );

/** The text a browser's parser (parse5, the one jsdom uses) reads from each inline script or style: what a CSP hash covers. */
function parsedInline(page: string, tag: "script" | "style", marked = false): string[] {
  const found: string[] = [];
  const walk = (node: DefaultTreeAdapterMap["node"]): void => {
    if (
      "tagName" in node &&
      node.tagName === tag &&
      (!marked ||
        node.attrs.some(({ name, value }) => name === "class" && value.split(" ").includes("$tsr")))
    ) {
      found.push(node.childNodes.map((child) => ("value" in child ? child.value : "")).join(""));
    }
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(parse(page));
  return found;
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8", ...headers } });

function setup(
  options: {
    render?: (request: Request) => Response | Promise<Response>;
    cache?: PipelineDeps["cache"];
    flags?: Record<string, unknown>;
    env?: string;
  } = {},
) {
  const rendered: string[] = [];
  const ctx: PipelineContext = {
    env: { MOP_ENV: options.env ?? "production" },
    waitUntil: vi.fn<PipelineContext["waitUntil"]>(),
  };
  const deps: PipelineDeps = {
    render: (request) => {
      rendered.push(new URL(request.url).pathname);
      return Promise.resolve(options.render?.(request) ?? html(FIXTURE_PAGE));
    },
    redirect: () => Promise.resolve(null),
    cache: options.cache ?? ((_request, render) => render()),
    getFlags: () => Promise.resolve(options.flags ?? {}),
    report: () => Promise.resolve(),
    isApiRoute: () => false,
  };
  return { rendered, run: (request: Request) => handle(request, ctx, deps) };
}

beforeEach(() => {
  vi.mocked(captureException).mockImplementation(() => Promise.resolve());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(captureException).mockReset();
});

describe("flags", () => {
  it("flags: mergeFlags gives csp_enforce and maintenance under those names, false when missing or malformed", () => {
    expect(featureFlags).toEqual(expect.arrayContaining(["csp_enforce", "maintenance"]));
    expect(defaultFlags).toMatchObject({ csp_enforce: false, maintenance: false });
    expect(mergeFlags({ csp_enforce: true, maintenance: true }, false)).toMatchObject({
      csp_enforce: true,
      maintenance: true,
    });
    expect(mergeFlags({ new_channels: true }, false)).toMatchObject({
      csp_enforce: false,
      maintenance: false,
    });
    for (const row of [null, "on", { csp_enforce: "yes" }, { maintenance: 1 }]) {
      expect(mergeFlags(row, false)).toMatchObject({ csp_enforce: false, maintenance: false });
    }
  });
});

describe("headers", () => {
  it("headers: carries the security table on a page, including the new cross-origin and reporting rows", async () => {
    const response = await setup().run(get("/"));
    expect(Object.fromEntries(response.headers)).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
      "strict-transport-security": "max-age=31536000; includeSubDomains",
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-resource-policy": "same-site",
      "x-dns-prefetch-control": "off",
      "reporting-endpoints": 'csp="/api/public/csp-report"',
    });
    expect(response.headers.has(REPORT_ONLY)).toBe(true);
  });

  it("headers: names the enforcing header once csp_enforce is on, and the report-only one before", async () => {
    const enforcing = await setup({ flags: { csp_enforce: true } }).run(get("/"));
    expect(enforcing.headers.has(ENFORCING)).toBe(true);
    expect(enforcing.headers.has(REPORT_ONLY)).toBe(false);
    const reporting = await setup({ flags: { csp_enforce: false } }).run(get("/"));
    expect(reporting.headers.has(REPORT_ONLY)).toBe(true);
    expect(reporting.headers.has(ENFORCING)).toBe(false);
    expect(Object.keys(securityHeaders("production", { csp_enforce: true }))).toContain(
      "Content-Security-Policy",
    );
  });

  it("headers: puts every class $tsr inline script of the page into script-src by its hash, and never a nonce", async () => {
    const response = await setup().run(get("/"));
    const policy = response.headers.get(REPORT_ONLY) ?? "";
    for (const text of [FIRST_TSR, SECOND_TSR])
      expect(policy).toContain(`'sha256-${sha256(text)}'`);
    expect(directive(policy, "style-src")).toContain(`'sha256-${sha256(".a{color:red}")}'`);
    expect(policy).not.toContain("nonce-");
    expect(cspFor("production", {}, { scripts: ["abc"] }, { framing: "admin" })).not.toContain(
      "nonce-",
    );
  });

  it("headers: lets script-src name the gtag.js path only, never a googletagmanager wildcard", () => {
    const scripts = directive(cspFor("production", {}), "script-src");
    expect(scripts).toContain("https://www.googletagmanager.com/gtag/js");
    expect(scripts).not.toContain("*.googletagmanager.com");
    expect(scripts).toContain(TURNSTILE);
  });

  it("headers: gives img-src exactly self, data and the two GA4 hosts, whatever MEDIA_PUBLIC_BASE holds", () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "https://m.test/media");
    const policy = cspFor("production", {});
    expect(directive(policy, "img-src")).toBe(
      "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
    );
    expect(policy).not.toContain("m.test");
  });

  it("headers: sends one Link header with the two fonts, the page stylesheet and exactly one preconnect, to Turnstile", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", "https://m.test/media");
    const link = (await setup().run(get("/"))).headers.get("link") ?? "";
    expect(link.match(/rel=preconnect/g)).toHaveLength(1);
    expect(link).toContain(`<${TURNSTILE}>; rel=preconnect`);
    expect(link).toContain("</assets/app.css>; rel=preload; as=style");
    expect(link).not.toContain("elsewhere.test");
    expect(link).not.toContain("m.test");
    expect(link.match(/as=font/g)).toHaveLength(2);
  });

  it("headers: keeps the Cache-Control of each route class: the page lifetime, no-store where nothing may be kept", async () => {
    const cacheControl = async (request: Request, render?: () => Response) =>
      (await setup(render === undefined ? {} : { render }).run(request)).headers.get(
        "cache-control",
      ) ?? "";
    expect(await cacheControl(get("/"))).toBe("public, max-age=0, must-revalidate");
    expect(await cacheControl(get("/property/p1?preview=tok"))).toContain("no-store");
    expect(await cacheControl(get("/property/p1?draft_token=tok"))).toContain("no-store");
    expect(
      await cacheControl(get("/admin"), () =>
        html(FIXTURE_PAGE, { "cache-control": "private, no-store" }),
      ),
    ).toContain("no-store");
    expect(
      await cacheControl(get("/api/admin/x"), () =>
        Response.json({}, { headers: { "cache-control": "private" } }),
      ),
    ).toContain("no-store");
    expect(
      await cacheControl(new Request(`${BASE}/api/hooks/resend`, { method: "POST" }), () =>
        Response.json({}),
      ),
    ).toContain("no-store");
    expect(
      await cacheControl(get("/api/public/events"), () =>
        Response.json({}, { headers: { "set-cookie": "a=b" } }),
      ),
    ).toContain("no-store");
    expect(await cacheControl(get("/"), () => new Response("down", { status: 503 }))).toContain(
      "no-store",
    );
  });

  it("headers: gives static files their lifetime in public/_headers: /sw.js no-cache, /fonts and /media a week", () => {
    const rules = new Map<string, Map<string, string>>();
    let current = new Map<string, string>();
    for (const line of readFileSync("public/_headers", "utf8").split("\n")) {
      if (line.trim() === "") continue;
      if (!line.startsWith(" ")) {
        current = new Map();
        rules.set(line.trim(), current);
      } else {
        const colon = line.indexOf(":");
        current.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
      }
    }
    expect(rules.get("/sw.js")?.get("Cache-Control")).toBe("no-cache");
    expect(rules.get("/fonts/*")?.get("Cache-Control")).toBe("public, max-age=604800");
    expect(rules.get("/media/*")?.get("Cache-Control")).toBe("public, max-age=604800");
  });
});

describe("csp-inline-rules", () => {
  it("csp-inline-rules: hashes a class $tsr script, an allowlisted text and every style, and no data block", async () => {
    const found = await inlineHashes(FIXTURE_PAGE);
    expect([...found.scripts].sort()).toEqual(
      [sha256(FIRST_TSR), sha256(SECOND_TSR), sha256(ALLOWED)].sort(),
    );
    expect(found.styles).toEqual([sha256(".a{color:red}")]);
    expect(found.unexpected).toBe(0);
    expect(found.scripts).not.toContain(sha256('{"@type":"Organization"}'));
    expect(found.scripts).not.toContain(sha256('{"a":1}'));
  });

  it("csp-inline-rules: leaves an unmarked executable script out and reports it once per render however many there are", async () => {
    const found = await inlineHashes(withUnmarked(3));
    expect(found.unexpected).toBe(3);
    expect(found.scripts).not.toContain(sha256("unmarked(0);"));
    const response = await setup({ render: () => html(withUnmarked(3)) }).run(get("/"));
    expect(response.headers.get(REPORT_ONLY)).not.toContain(sha256("unmarked(0);"));
    const calls = vi.mocked(captureException).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual(new Error("csp_unexpected_inline_script"));
    expect(calls[0]?.[1]).toMatchObject({ route: "/" });
    expect(calls[0]?.[1].requestId).toEqual(expect.any(String));
  });

  it("csp-inline-rules: sends the page on with the default policy and reports the error with its path when hashing fails", async () => {
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(new Error("digest failed"));
    const response = await setup().run(get("/about"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(FIXTURE_PAGE);
    expect(response.headers.get(REPORT_ONLY)).not.toContain("sha256-");
    expect(response.headers.has("link")).toBe(false);
    const calls = vi.mocked(captureException).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual(new Error("digest failed"));
    expect(calls[0]?.[1]).toMatchObject({ route: "/about" });
  });

  it("csp-inline-rules: reports nothing for a page whose inline scripts are all admitted", async () => {
    await setup().run(get("/"));
    expect(captureException).not.toHaveBeenCalled();
  });

  const renderHome = async () => {
    const router = getRouter();
    router.update({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      context: router.options.context,
    });
    attachRouterServerSsrUtils({ router, manifest: undefined });
    await router.load();
    await router.serverSsr?.dehydrate();
    const rendered = await renderRouterToString({
      router,
      responseHeaders: new Headers(),
      children: createElement(RouterServer, { router }),
    });
    return rendered.text();
  };

  it("csp-inline-rules: still finds class $tsr on the bootstrap script of a real render of /, and every allowlist entry in it", async () => {
    const page = await renderHome();
    expect(page).toContain('<script class="$tsr"');
    for (const entry of CSP_INLINE_ALLOWLIST) expect(page).toContain(entry);
    expect((await inlineHashes(page)).unexpected).toBe(0);
  });

  it("csp-inline-rules: hashes the text a parser reads, not the bytes sent (NUL becomes U+FFFD, CRLF becomes LF)", async () => {
    const char = (code: number) => String.fromCharCode(code);
    const [NUL, CR, LF, REPLACEMENT] = [char(0), char(13), char(10), char(0xfffd)];
    const fixture = [
      "<!DOCTYPE html><html><head>",
      `<script class="$tsr">a="${NUL}_site${NUL}";${CR}${LF}b();${CR}c();</script>`,
      `<style>.a{content:"${NUL}"}${CR}${LF}.b{}</style>`,
      "</head><body></body></html>",
    ].join("");
    const [script = ""] = parsedInline(fixture, "script");
    const [style = ""] = parsedInline(fixture, "style");
    expect(script).toBe(`a="${REPLACEMENT}_site${REPLACEMENT}";${LF}b();${LF}c();`);
    const found = await inlineHashes(fixture);
    expect(found.scripts).toEqual([sha256(script)]);
    expect(found.styles).toEqual([sha256(style)]);
  });

  it("csp-inline-rules: admits every class $tsr script of a real render of / as a parser reads it", async () => {
    const page = await renderHome();
    const marked = parsedInline(page, "script", true);
    expect(marked.length).toBeGreaterThan(0);
    expect(page).toContain(String.fromCharCode(0));
    const found = await inlineHashes(page);
    for (const text of marked) expect(found.scripts).toContain(sha256(text));
    for (const text of parsedInline(page, "style")) expect(found.styles).toContain(sha256(text));
  });
});

describe("framing", () => {
  const policyOf = async (path: string) => {
    const response = await setup().run(get(path));
    return {
      policy: response.headers.get(REPORT_ONLY) ?? "",
      frame: response.headers.get("x-frame-options"),
    };
  };

  it("framing: lets a preview-token page be framed by its own origin and keeps every other page unframed", async () => {
    for (const path of ["/property/p1?preview=tok", "/property/p1?draft_token=tok"]) {
      const { policy, frame } = await policyOf(path);
      expect(policy).toContain("frame-ancestors 'self'");
      expect(frame).toBe("SAMEORIGIN");
    }
    const home = await policyOf("/");
    expect(home.policy).toContain("frame-ancestors 'none'");
    expect(home.frame).toBe("DENY");
  });

  it("framing: adds its own origin to frame-src on an /admin document only", async () => {
    const admin = await policyOf("/admin");
    expect(directive(admin.policy, "frame-src")).toContain("'self'");
    expect(admin.policy).toContain("frame-ancestors 'none'");
    expect(directive((await policyOf("/")).policy, "frame-src")).toBe(`frame-src ${TURNSTILE}`);
  });
});

describe("csp-stored", () => {
  function fakeEdge() {
    const store = new Map<string, Response>();
    vi.stubGlobal("caches", {
      default: {
        match: (key: string) => Promise.resolve(store.get(key)?.clone()),
        put: (key: string, response: Response) => {
          store.set(key, response.clone());
          return Promise.resolve();
        },
      },
    });
    return store;
  }

  it("csp-stored: reads the policy and the Link header back on a hit exactly as the miss built them, without rendering again", async () => {
    vi.resetModules();
    vi.stubEnv("CATALOG_VERSION_TTL_MS", "15000");
    const store = fakeEdge();
    const { cachedResponse } = await import("../../src/server/public/cache");
    const db = fakeDb({ rpc: { public_state: () => stateJson(7) } });
    const { run, rendered } = setup({
      cache: (request, render) => cachedResponse(request, "html", render, undefined, db),
    });
    const miss = await run(get("/"));
    const hit = await run(get("/"));
    expect([miss.headers.get("x-mop-cache"), hit.headers.get("x-mop-cache")]).toEqual([
      "miss",
      "hit",
    ]);
    expect(rendered).toEqual(["/"]);
    expect(store.size).toBeGreaterThan(0);
    const policy = miss.headers.get(REPORT_ONLY) ?? "";
    expect(policy).toContain(`'sha256-${sha256(FIRST_TSR)}'`);
    expect(hit.headers.get(REPORT_ONLY)).toBe(policy);
    expect(hit.headers.get("link")).toBe(miss.headers.get("link"));
    expect(hit.headers.get("link")).toContain("rel=preconnect");
  });
});

describe("csp-report", () => {
  const BODY = [
    {
      type: "csp-violation",
      url: `${BASE}/`,
      body: {
        documentURL: `${BASE}/about?token=secret#x`,
        effectiveDirective: "script-src-elem",
        blockedURL: "https://evil.test/a.js?k=1",
        disposition: "report",
      },
    },
  ];

  async function load() {
    vi.resetModules();
    const { handlePublic } = await import("../../src/server/public/pipeline");
    const db = fakeDb({ rpc: { record_analytics_events: () => 1 } });
    const send = (body: unknown, ip: string, type = "application/reports+json") =>
      handlePublic(
        new Request(`${BASE}/api/public/csp-report`, {
          method: "POST",
          headers: { "content-type": type, "cf-connecting-ip": ip },
          body: JSON.stringify(body),
        }),
        "req-12345678",
        db,
      );
    return { db, send, handlePublic };
  }

  const rows = (db: ReturnType<typeof fakeDb>) =>
    db.calls
      .filter((call) => call.kind === "rpc")
      .flatMap(
        (call) =>
          z.object({ p_rows: z.array(z.record(z.string(), z.unknown())) }).parse(call.args[0])
            .p_rows,
      );

  it("csp-report: stores a burst of 100 identical reports from one IP as one row in one rpc call, and answers 429 from the 61st", async () => {
    const { db, send } = await load();
    const statuses: number[] = [];
    for (let sent = 0; sent < 100; sent += 1) {
      statuses.push((await send(BODY, "198.51.100.9")).status);
    }
    expect(statuses.slice(0, 60).every((status) => status === 204)).toBe(true);
    expect(statuses.slice(60).every((status) => status === 429)).toBe(true);
    expect(db.calls.map((call) => `${call.kind}:${call.name}`)).toEqual([
      "rpc:record_analytics_events",
    ]);
    expect(rows(db)).toHaveLength(1);
    expect(rows(db)[0]).toMatchObject({
      event: "csp_report",
      path: "/about",
      data: {
        directive: "script-src-elem",
        blocked_uri: "https://evil.test/a.js",
        disposition: "report",
      },
    });
  });

  it("csp-report: answers 429 for the 61st request of a minute before the database stub is called", async () => {
    const { db, send } = await load();
    for (let sent = 0; sent < 60; sent += 1) {
      await send(
        [{ ...BODY[0], body: { ...BODY[0]?.body, blockedURL: `https://e.test/${String(sent)}` } }],
        "198.51.100.10",
      );
    }
    const callsBefore = db.calls.length;
    const refused = await send(BODY, "198.51.100.10");
    expect(refused.status).toBe(429);
    expect(db.calls).toHaveLength(callsBefore);
  });

  it("csp-report: parses a Reporting API array and a legacy single report, and refuses anything else", async () => {
    expect(cspReportBatchSchema.parse(BODY)).toEqual([
      {
        path: "/about",
        directive: "script-src-elem",
        blockedUri: "https://evil.test/a.js",
        disposition: "report",
      },
    ]);
    expect(
      cspReportBatchSchema.parse({
        "csp-report": {
          "document-uri": `${BASE}/about`,
          "effective-directive": "img-src",
          "blocked-uri": "inline",
          disposition: "enforce",
        },
      }),
    ).toEqual([
      { path: "/about", directive: "img-src", blockedUri: "inline", disposition: "enforce" },
    ]);
    expect(cspReportBatchSchema.safeParse([]).success).toBe(false);
    expect(cspReportBatchSchema.safeParse({ nonsense: true }).success).toBe(false);
    const { db, send } = await load();
    expect((await send(BODY, "198.51.100.11")).status).toBe(204);
    const legacy = {
      "csp-report": {
        "document-uri": `${BASE}/`,
        "effective-directive": "img-src",
        "blocked-uri": "eval",
      },
    };
    expect((await send(legacy, "198.51.100.12", "application/csp-report")).status).toBe(204);
    expect(rows(db)).toHaveLength(2);
  });

  it("csp-report: keeps a row's data short by cutting each string", () => {
    const long = "x".repeat(5000);
    const parsed = cspReportBatchSchema.parse([
      {
        type: "csp-violation",
        body: {
          documentURL: `${BASE}/${long}`,
          effectiveDirective: long,
          blockedURL: long,
          disposition: long,
        },
      },
    ]);
    expect(JSON.stringify(parsed).length).toBeLessThan(1024);
  });

  it("csp-report: still answers 204 and tells Sentry once when the database refuses the write", async () => {
    vi.resetModules();
    const { handlePublic } = await import("../../src/server/public/pipeline");
    const { captureException: captured } = await import("../../src/server/lib/sentry");
    vi.mocked(captured).mockImplementation(() => Promise.resolve());
    const db = fakeDb({ rpc: { record_analytics_events: () => new Error("down") } });
    const response = await handlePublic(
      new Request(`${BASE}/api/public/csp-report`, {
        method: "POST",
        headers: { "content-type": "application/csp-report", "cf-connecting-ip": "198.51.100.13" },
        body: JSON.stringify({
          "csp-report": {
            "document-uri": `${BASE}/`,
            "effective-directive": "img-src",
            "blocked-uri": "eval",
          },
        }),
      }),
      "req-12345678",
      db,
    );
    expect(response.status).toBe(204);
    expect(captured).toHaveBeenCalledTimes(1);
  });

  it("csp-report: gives a reports body to /api/public/events a 400, so only this route takes the report types", async () => {
    const { db, handlePublic } = await load();
    const response = await handlePublic(
      new Request(`${BASE}/api/public/events`, {
        method: "POST",
        headers: {
          "content-type": "application/reports+json",
          "cf-connecting-ip": "198.51.100.14",
        },
        body: "[]",
      }),
      "req-12345678",
      db,
    );
    expect(response.status).toBe(400);
    expect(db.calls).toHaveLength(0);
  });
});

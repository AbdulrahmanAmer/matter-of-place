// scripts/check-seo.ts (B13 step 9): the pure checks, then the crawl driven through a stub fetch that serves a small site.
import "../fixtures/worker-env";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_UNTIL,
  allowedUntil,
  checkHead,
  checkProductionSitemap,
  checkRobots,
  checkRobotsHeader,
  runChecks,
  type CheckResult,
} from "../../scripts/check-seo.ts";

const PREVIEW_HOST = "pr-1.holy-meadow-4327.workers.dev";
const ORIGIN = "https://matterofplace.com";
const DESCRIPTION =
  "A calm, specific description of this page for a reader who wants to understand it before opening it.";
const URL_OF_PAGE = "http://127.0.0.1:8788/exposure";

type Fields = {
  titles?: string[];
  description?: string | null;
  canonical?: string | null;
  image?: string | null;
  extra?: string;
};

function page(path: string, fields: Fields = {}): string {
  const titles = fields.titles ?? ["Exposure | Matter of Place"];
  const description = fields.description === undefined ? DESCRIPTION : fields.description;
  const canonical = fields.canonical === undefined ? `${ORIGIN}${path}` : fields.canonical;
  const image = fields.image === undefined ? `${ORIGIN}/og/default.jpg` : fields.image;
  return [
    "<!DOCTYPE html><html><head>",
    ...titles.map((title) => `<title>${title}</title>`),
    description === null ? "" : `<meta name="description" content="${description}"/>`,
    '<meta property="og:title" content="Exposure"/>',
    '<meta property="og:description" content="Text"/>',
    `<meta property="og:url" content="${ORIGIN}${path}"/>`,
    '<meta property="og:type" content="website"/>',
    image === null ? "" : `<meta property="og:image" content="${image}"/>`,
    '<meta name="twitter:card" content="summary_large_image"/>',
    canonical === null ? "" : `<link rel="canonical" href="${canonical}"/>`,
    fields.extra ?? "",
    "</head><body></body></html>",
  ].join("");
}

describe("allowedUntil (ruling H64)", () => {
  it("allows the legal pages' 404 and the two og:image gaps, each naming the slice that removes it", () => {
    expect(
      [
        ["status", "/privacy answered 404"],
        ["status", "/terms answered 404"],
        ["status", "/accessibility answered 404"],
        ["status", "/cookies answered 404"],
        ["head", "/place-notes: og:image is missing"],
      ].map(([name, problem]) => allowedUntil(name ?? "", problem ?? "")?.slice(0, 3)),
    ).toEqual(["B16", "B16", "B16", "B17", "B17"]);
  });

  it("allows nothing else: a 404 on another page, a 500 on a legal page, or any other check", () => {
    expect(
      [
        ["status", "/about answered 404"],
        ["status", "/privacy answered 500"],
        ["head", "/privacy: description is missing"],
        ["no-third-party", "/: initial HTML holds fonts.googleapis"],
      ].map(([name, problem]) => allowedUntil(name ?? "", problem ?? "")),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("names a slice on every allowed line, so the list empties as slices land", () => {
    expect(ALLOWED_UNTIL.every(({ until }) => /^B\d+/.test(until))).toBe(true);
  });
});

describe("checkHead", () => {
  it("passes a complete head", () => {
    expect(checkHead(page("/exposure"), URL_OF_PAGE)).toEqual([]);
  });

  it("fails two titles", () => {
    const html = page("/exposure", { titles: ["A | Matter of Place", "B | Matter of Place"] });
    expect(checkHead(html, URL_OF_PAGE)).toContain("2 <title> elements, expected 1");
  });

  it("fails a title that holds the brand twice", () => {
    const html = page("/exposure", { titles: ["Matter of Place | Matter of Place"] });
    expect(checkHead(html, URL_OF_PAGE).join("\n")).toContain("exactly once");
  });

  it("fails a description over 155 characters and one under 70, and passes both limits", () => {
    const problems = (length: number) =>
      checkHead(page("/exposure", { description: "x".repeat(length) }), URL_OF_PAGE);
    expect(problems(156).join("\n")).toContain("156 characters");
    expect(problems(69).join("\n")).toContain("69 characters");
    expect(problems(155)).toEqual([]);
    expect(problems(70)).toEqual([]);
  });

  it("fails a missing description", () => {
    expect(checkHead(page("/exposure", { description: null }), URL_OF_PAGE)).toContain(
      "0 meta descriptions, expected 1",
    );
  });

  it("fails a canonical with a query string", () => {
    const html = page("/exposure", { canonical: `${ORIGIN}/exposure?utm_source=x` });
    expect(checkHead(html, URL_OF_PAGE).join("\n")).toContain(
      `canonical is ${ORIGIN}/exposure?utm_source=x, expected ${ORIGIN}/exposure`,
    );
  });

  it("expects the apex home canonical and ignores a trailing slash on the crawled URL", () => {
    expect(checkHead(page("/"), "http://127.0.0.1:8788/")).toEqual([]);
    expect(checkHead(page("/exposure"), `${URL_OF_PAGE}/`)).toEqual([]);
  });

  it("fails a relative og:image and a missing one", () => {
    expect(
      checkHead(page("/exposure", { image: "/media/v/a.webp" }), URL_OF_PAGE).join("\n"),
    ).toContain("og:image");
    expect(checkHead(page("/exposure", { image: null }), URL_OF_PAGE).join("\n")).toContain(
      "og:image",
    );
  });

  it("reads an entity in a description as its character", () => {
    const text = `${"x".repeat(75)} &amp; ${"y".repeat(75)}`;
    expect(checkHead(page("/exposure", { description: text }), URL_OF_PAGE)).toEqual([]);
  });

  it("names a structured data block that does not parse", () => {
    const html = page("/exposure", {
      extra: '<script type="application/ld+json">{not json</script>',
    });
    expect(checkHead(html, URL_OF_PAGE).join("\n")).toContain(
      "structured data: block 1 is not valid JSON",
    );
  });
});

describe("checkRobots", () => {
  const OPEN =
    "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n\nSitemap: https://matterofplace.com/sitemap.xml\n";
  const CLOSED = "User-agent: *\nDisallow: /\n";

  it("expects the allow block and the sitemap line on the production host", () => {
    expect(checkRobots(OPEN, "matterofplace.com")).toEqual([]);
    expect(checkRobots(OPEN, "127.0.0.1:8788")).toEqual([]);
    expect(checkRobots(CLOSED, "matterofplace.com").join("\n")).toContain('lacks "Allow: /"');
  });

  it("fails a production body that closes the site", () => {
    expect(checkRobots(`${OPEN}Disallow: /\n`, "matterofplace.com")).toContain(
      'robots.txt closes the site with "Disallow: /"',
    );
  });

  it("expects Disallow: / and nothing open on a workers.dev host", () => {
    expect(checkRobots(CLOSED, PREVIEW_HOST)).toEqual([]);
    expect(checkRobots(OPEN, PREVIEW_HOST).join("\n")).toContain("not indexed");
    expect(checkRobots("User-agent: *\n", PREVIEW_HOST)).toContain(
      'robots.txt lacks "Disallow: /"',
    );
  });
});

describe("checkRobotsHeader", () => {
  it("expects no header on the production host and noindex, nofollow elsewhere", () => {
    expect(checkRobotsHeader(null, "matterofplace.com")).toEqual([]);
    expect(checkRobotsHeader("noindex, nofollow", "matterofplace.com")).toEqual([
      'x-robots-tag is "noindex, nofollow", expected absent',
    ]);
    expect(checkRobotsHeader("noindex, nofollow", PREVIEW_HOST)).toEqual([]);
    expect(checkRobotsHeader(null, PREVIEW_HOST)).toEqual([
      "x-robots-tag is absent, expected noindex, nofollow",
    ]);
  });
});

describe("checkProductionSitemap", () => {
  const xml = `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/property/a-house</loc></url></urlset>`;

  it("fails a property address while nothing is published", () => {
    expect(checkProductionSitemap(xml, 0)).toEqual([
      `${ORIGIN}/property/a-house is in the sitemap while the published list is empty`,
    ]);
  });

  it("passes the same sitemap with one published property, and a sitemap with no property", () => {
    expect(checkProductionSitemap(xml, 1)).toEqual([]);
    expect(checkProductionSitemap(`<urlset><url><loc>${ORIGIN}/</loc></url></urlset>`, 0)).toEqual(
      [],
    );
  });
});

describe("runChecks", () => {
  const OPEN_ROBOTS =
    "User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api\n\nSitemap: https://matterofplace.com/sitemap.xml\n";
  const sitemap = (...paths: string[]) =>
    `<urlset>${paths.map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`).join("")}</urlset>`;

  type Answer = { status?: number; body?: string; headers?: Record<string, string> };
  type Seen = { path: string; host: string | undefined };

  function bodyOf(path: string): string {
    if (path === "/sitemap.xml") return sitemap("/", "/exposure");
    if (path === "/robots.txt") return OPEN_ROBOTS;
    if (path === "/llms.txt") return "# Matter of Place\n";
    return page(path, { description: `${DESCRIPTION} Path ${path}.` });
  }

  /** A site whose pages answer a head that is right for their own path; `answers` replaces single paths. */
  function stub(
    answers: Record<string, Answer>,
    seen: Seen[] = [],
    headers: Record<string, string> = {},
  ) {
    return (url: string, init?: RequestInit): Promise<Response> => {
      const path = new URL(url).pathname;
      seen.push({ path, host: new Headers(init?.headers).get("host") ?? undefined });
      const answer = answers[path];
      const text = path === "/llms.txt" || path === "/robots.txt";
      return Promise.resolve(
        new Response(answer?.body ?? bodyOf(path), {
          status: answer?.status ?? 200,
          headers: {
            "content-type": text ? "text/plain; charset=utf-8" : "text/html; charset=utf-8",
            ...headers,
            ...answer?.headers,
          },
        }),
      );
    };
  }

  const failed = (results: CheckResult[]) =>
    results.filter(({ problems }) => problems.length > 0).map(({ name }) => name);
  const run = (answers: Record<string, Answer>, options = {}) =>
    runChecks("http://127.0.0.1:8788", { production: false, ...options }, stub(answers));

  it("passes a site whose pages, robots and llms answer as the production host", async () => {
    const results = await run({});
    expect(failed(results)).toEqual([]);
    expect(results.map(({ name }) => name)).toEqual([
      "sitemap",
      "status",
      "head",
      "unique-descriptions",
      "noindex-unlisted",
      "no-third-party",
      "x-robots-tag",
      "robots",
      "llms",
    ]);
  });

  it("fails a page that redirects instead of answering 200", async () => {
    const results = await run({ "/exposure": { status: 301, headers: { location: "/x" } } });
    expect(failed(results)).toEqual(["status"]);
    expect(results.find(({ name }) => name === "status")?.problems).toEqual([
      "/exposure answered 301",
    ]);
  });

  it("fails a sitemap url with a query string", async () => {
    const results = await run({ "/sitemap.xml": { body: sitemap("/", "/exposure?utm_source=x") } });
    expect(failed(results)).toContain("sitemap");
  });

  it("fails a noindex page that the sitemap lists", async () => {
    const noindex = page("/exposure", {
      extra: '<meta name="robots" content="noindex, nofollow"/>',
    });
    expect(failed(await run({ "/exposure": { body: noindex } }))).toEqual(["noindex-unlisted"]);
  });

  it("fails two pages that share one description", async () => {
    const same = page("/exposure");
    const results = await run({ "/": { body: page("/") }, "/exposure": { body: same } });
    expect(failed(results)).toEqual(["unique-descriptions"]);
  });

  it("fails initial HTML that holds fonts.googleapis, googletagmanager or google-analytics", async () => {
    for (const needle of ["fonts.googleapis", "googletagmanager", "google-analytics"]) {
      const html = page("/exposure", {
        extra: `<link rel="preconnect" href="https://${needle}.com"/>`,
      });
      const results = await run({ "/exposure": { body: html } });
      expect(results.find(({ name }) => name === "no-third-party")?.problems).toEqual([
        `/exposure: initial HTML holds ${needle}`,
      ]);
    }
  });

  it("sends the Host header and passes a workers.dev host that answers closed", async () => {
    const seen: Seen[] = [];
    const closed = {
      "/robots.txt": { body: "User-agent: *\nDisallow: /\n", headers: { "x-mop-cache": "bypass" } },
    };
    const results = await runChecks(
      "http://127.0.0.1:8788",
      { production: false, host: PREVIEW_HOST },
      stub(closed, seen, { "x-robots-tag": "noindex, nofollow" }),
    );
    expect(seen.every(({ host }) => host === PREVIEW_HOST)).toBe(true);
    expect(failed(results)).toEqual([]);
  });

  it("fails a workers.dev host that answers like production", async () => {
    const results = await run({}, { host: PREVIEW_HOST });
    expect(failed(results)).toEqual(expect.arrayContaining(["x-robots-tag", "robots"]));
  });

  it("checks the 410 of --gone-slug", async () => {
    const options = { goneSlug: "a-taken-house" };
    expect(failed(await run({ "/property/a-taken-house": { status: 410 } }, options))).toEqual([]);
    const results = await run({ "/property/a-taken-house": { status: 200 } }, options);
    expect(results.find(({ name }) => name === "gone")?.problems).toEqual([
      "/property/a-taken-house answered 200",
    ]);
  });

  it("with --production fails a property in the sitemap while the published list is empty", async () => {
    const answers = {
      "/sitemap.xml": { body: sitemap("/", "/exposure", "/property/a-house") },
      "/api/public/properties": { body: "[]" },
    };
    const results = await run(answers, { production: true });
    expect(results.find(({ name }) => name === "production")?.problems).toHaveLength(1);
    const published = { ...answers, "/api/public/properties": { body: '[{"slug":"a-house"}]' } };
    const again = await run(published, { production: true });
    expect(again.find(({ name }) => name === "production")?.problems).toEqual([]);
  });

  it("throws when the sitemap does not answer", async () => {
    await expect(run({ "/sitemap.xml": { status: 500 } })).rejects.toThrow(
      "/sitemap.xml answered 500",
    );
  });
});

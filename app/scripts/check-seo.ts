import { parseArgs } from "node:util";
import { z } from "zod";
import { isIndexableHost } from "../src/server/seo/robots.ts";
import { staticSitemapPaths } from "../src/server/seo/sitemap.ts";
import { validateHtml } from "./validate-jsonld.ts";

// Crawls a base URL from its sitemap plus the static paths and prints one `ok <check>` or `fail <check>: <problem>`
// line per check (B13 step 9). Exit 1 when any check fails.
// usage: bun run scripts/check-seo.ts <baseUrl> [--host <name>] [--gone-slug <slug>] [--production]

const ORIGIN = "https://matterofplace.com";
const BRAND = "Matter of Place";
const TIMEOUT_MS = 15_000;
const DESCRIPTION_MIN = 70;
const DESCRIPTION_MAX = 155;
const FORBIDDEN_IN_HTML = ["googletagmanager", "google-analytics", "fonts.googleapis"];
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type Options = {
  host?: string | undefined;
  goneSlug?: string | undefined;
  production: boolean;
};

export type CheckResult = { name: string; problems: string[] };

function decode(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (whole, dec, hex, name) => {
    if (typeof dec === "string") return String.fromCodePoint(Number(dec));
    if (typeof hex === "string") return String.fromCodePoint(parseInt(hex, 16));
    return typeof name === "string" ? (ENTITIES[name] ?? whole) : whole;
  });
}

function attributes(tag: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of tag.matchAll(/([a-zA-Z][\w:-]*)="([^"]*)"/g)) {
    if (name !== undefined && value !== undefined) found[name] = decode(value);
  }
  return found;
}

function headOf(html: string): string {
  const end = html.indexOf("</head>");
  return end === -1 ? html : html.slice(0, end);
}

function metaContents(head: string, key: "name" | "property", value: string): string[] {
  return [...head.matchAll(/<meta\b[^>]*>/g)]
    .map(([tag]) => attributes(tag))
    .filter((found) => found[key] === value)
    .map((found) => found["content"] ?? "");
}

function canonicalPath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** The problems in the head of one page; an empty list is a pass. */
export function checkHead(html: string, url: string): string[] {
  const head = headOf(html);
  const problems: string[] = [];

  const titles = [...head.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/g)].map(([, text]) =>
    decode(text ?? ""),
  );
  if (titles.length !== 1) problems.push(`${String(titles.length)} <title> elements, expected 1`);
  else if (titles[0]?.split(BRAND).length !== 2)
    problems.push(`title "${titles[0] ?? ""}" does not hold "${BRAND}" exactly once`);

  const descriptions = metaContents(head, "name", "description");
  if (descriptions.length !== 1)
    problems.push(`${String(descriptions.length)} meta descriptions, expected 1`);
  else {
    const length = descriptions[0]?.length ?? 0;
    if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX)
      problems.push(
        `description is ${String(length)} characters, expected ${String(DESCRIPTION_MIN)} to ${String(DESCRIPTION_MAX)}`,
      );
  }

  const canonicals = [...head.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => attributes(tag))
    .filter((found) => found["rel"] === "canonical");
  const expected = `${ORIGIN}${canonicalPath(new URL(url).pathname)}`;
  if (canonicals.length !== 1)
    problems.push(`${String(canonicals.length)} canonical links, expected 1`);
  else if (canonicals[0]?.["href"] !== expected)
    problems.push(`canonical is ${canonicals[0]?.["href"] ?? ""}, expected ${expected}`);

  for (const [key, name] of [
    ["property", "og:title"],
    ["property", "og:description"],
    ["property", "og:url"],
    ["property", "og:type"],
    ["name", "twitter:card"],
  ] as const) {
    if (metaContents(head, key, name).every((content) => content === ""))
      problems.push(`${name} is missing`);
  }
  const images = metaContents(head, "property", "og:image");
  if (!images.some((content) => content.startsWith("https://")))
    problems.push(`og:image is missing or not an absolute https address (${images.join(", ")})`);

  if (html.includes("application/ld+json")) {
    try {
      validateHtml(html);
    } catch (error) {
      problems.push(`structured data: ${error instanceof Error ? error.message : "invalid"}`);
    }
  }
  return problems;
}

/** The problems in a `robots.txt` body for the host the Worker answered as; an empty list is a pass. */
export function checkRobots(body: string, host: string): string[] {
  const lines = body.split(/\r?\n/);
  const has = (line: string): boolean => lines.includes(line);
  const problems: string[] = [];
  if (isIndexableHost(host, "production")) {
    for (const line of [
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api",
      `Sitemap: ${ORIGIN}/sitemap.xml`,
    ])
      if (!has(line)) problems.push(`robots.txt lacks "${line}"`);
    if (has("Disallow: /")) problems.push('robots.txt closes the site with "Disallow: /"');
  } else {
    if (!has("Disallow: /")) problems.push('robots.txt lacks "Disallow: /"');
    if (lines.some((line) => line.startsWith("Allow:") || line.startsWith("Sitemap:")))
      problems.push("robots.txt opens a path or lists a sitemap on a host that is not indexed");
  }
  return problems;
}

/** The `X-Robots-Tag` a response must carry for the host: none when indexable, `noindex, nofollow` otherwise. */
export function checkRobotsHeader(value: string | null, host: string): string[] {
  const wanted = isIndexableHost(host, "production") ? null : "noindex, nofollow";
  return value === wanted
    ? []
    : [
        `x-robots-tag is ${value === null ? "absent" : `"${value}"`}, expected ${wanted ?? "absent"}`,
      ];
}

/** A `/property/` address in the sitemap while nothing is published (S30: production shows no illustrative row). */
export function checkProductionSitemap(sitemapXml: string, publishedCount: number): string[] {
  if (publishedCount > 0) return [];
  return locations(sitemapXml)
    .filter((loc) => new URL(loc).pathname.startsWith("/property/"))
    .map((loc) => `${loc} is in the sitemap while the published list is empty`);
}

function locations(sitemapXml: string): string[] {
  return [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => decode(loc ?? ""));
}

const publishedList = z.array(z.unknown());

/** Runs every check against `base` and returns one result per check. Throws only when the sitemap cannot be read. */
export async function runChecks(
  base: string,
  options: Options,
  fetcher: Fetcher,
): Promise<CheckResult[]> {
  const root = base.replace(/\/+$/, "");
  const host = options.host ?? new URL(root).host;
  const init: RequestInit = {
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    ...(options.host === undefined ? {} : { headers: { host: options.host } }),
  };
  const get = (path: string): Promise<Response> => fetcher(`${root}${path}`, init);

  const sitemapResponse = await get("/sitemap.xml");
  if (sitemapResponse.status !== 200)
    throw new Error(`/sitemap.xml answered ${String(sitemapResponse.status)}`);
  const sitemapXml = await sitemapResponse.text();
  const listed = locations(sitemapXml).map((loc) => new URL(loc));
  const listedPaths = new Set(listed.map((url) => url.pathname));
  const crawled = [...new Set([...staticSitemapPaths, ...listedPaths])];

  const pages = await Promise.all(
    crawled.map(async (path) => {
      const response = await get(path);
      return {
        path,
        status: response.status,
        robotsHeader: response.headers.get("x-robots-tag"),
        html: response.status === 200 ? await response.text() : "",
      };
    }),
  );
  const results: CheckResult[] = [];
  const add = (name: string, problems: string[]): void => {
    results.push({ name, problems });
  };

  add(
    "sitemap",
    listed
      .filter((url) => url.search !== "")
      .map((url) => `${url.href} has a query string`)
      .concat(listed.length === 0 ? ["no url listed"] : []),
  );
  add(
    "status",
    pages
      .filter((page) => page.status !== 200)
      .map((page) => `${page.path} answered ${String(page.status)}`),
  );
  const answered = pages.filter((page) => page.status === 200);
  add(
    "head",
    answered.flatMap((page) =>
      checkHead(page.html, `${root}${page.path}`).map((problem) => `${page.path}: ${problem}`),
    ),
  );
  const byDescription = new Map<string, string[]>();
  for (const page of answered) {
    const [description] = metaContents(headOf(page.html), "name", "description");
    if (description !== undefined)
      byDescription.set(description, [...(byDescription.get(description) ?? []), page.path]);
  }
  add(
    "unique-descriptions",
    [...byDescription.values()]
      .filter((paths) => paths.length > 1)
      .map((paths) => `${paths.join(", ")} share one description`),
  );
  add(
    "noindex-unlisted",
    answered
      .filter(
        (page) =>
          listedPaths.has(page.path) &&
          metaContents(headOf(page.html), "name", "robots").some((content) =>
            content.includes("noindex"),
          ),
      )
      .map((page) => `${page.path} is noindex and listed in the sitemap`),
  );
  add(
    "no-third-party",
    answered.flatMap((page) =>
      FORBIDDEN_IN_HTML.filter((needle) => page.html.includes(needle)).map(
        (needle) => `${page.path}: initial HTML holds ${needle}`,
      ),
    ),
  );
  add(
    "x-robots-tag",
    answered.flatMap((page) =>
      checkRobotsHeader(page.robotsHeader, host).map((problem) => `${page.path}: ${problem}`),
    ),
  );

  const robots = await get("/robots.txt");
  const robotsProblems = checkRobots(await robots.text(), host);
  if (!isIndexableHost(host, "production") && robots.headers.get("x-mop-cache") !== "bypass")
    robotsProblems.push("robots.txt answer is not x-mop-cache: bypass");
  add("robots", robotsProblems);

  const llms = await get("/llms.txt");
  add(
    "llms",
    llms.headers.get("content-type")?.startsWith("text/plain") === true
      ? []
      : [`/llms.txt answered ${llms.headers.get("content-type") ?? "no content type"}`],
  );

  if (options.goneSlug !== undefined) {
    const gone = await get(`/property/${options.goneSlug}`);
    add(
      "gone",
      gone.status === 410 ? [] : [`/property/${options.goneSlug} answered ${String(gone.status)}`],
    );
  }
  if (options.production) {
    const list = await get("/api/public/properties");
    if (list.status !== 200)
      throw new Error(`/api/public/properties answered ${String(list.status)}`);
    add(
      "production",
      checkProductionSitemap(sitemapXml, publishedList.parse(await list.json()).length),
    );
  }
  return results;
}

async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      host: { type: "string" },
      "gone-slug": { type: "string" },
      production: { type: "boolean", default: false },
    },
  });
  const [base] = positionals;
  if (base === undefined)
    throw new Error(
      "usage: bun run scripts/check-seo.ts <baseUrl> [--host <name>] [--gone-slug <slug>] [--production]",
    );
  const results = await runChecks(
    base,
    { host: values.host, goneSlug: values["gone-slug"], production: values.production },
    fetch,
  );
  for (const { name, problems } of results) {
    if (problems.length === 0) console.log(`ok ${name}`);
    else for (const problem of problems) console.log(`fail ${name}: ${problem}`);
  }
  if (results.some(({ problems }) => problems.length > 0)) process.exit(1);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`fail ${error instanceof Error ? error.message : "failed"}`);
    process.exit(1);
  });
}

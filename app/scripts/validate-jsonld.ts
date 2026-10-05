import { z } from "zod";

// Fetches pages and checks every application/ld+json block (B13 step 3): the schema.org context, then the fields each
// @type needs, with Zod. One bare base URL checks one page of each type the sweep expects (home, faq, property, story,
// archive) and prints `skip <type>` for a type the sitemap does not list.
// usage: bun run scripts/validate-jsonld.ts <url>... | <baseUrl>

const TIMEOUT_MS = 15_000;
const SCRIPT = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

const text = z.string().min(1);
const address = z.string().url().startsWith("https://");
const items = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1);

const itemList = z
  .object({
    numberOfItems: z.number().int().min(0),
    itemListElement: z.array(
      z.object({ position: z.number().int().min(1), name: text, url: address }).passthrough(),
    ),
  })
  .passthrough();

/** The fields each type needs to be read as that type; a type not listed here is accepted as it is. */
const schemas: Record<string, z.ZodTypeAny> = {
  Organization: z.object({ name: text, url: address }).passthrough(),
  WebSite: z.object({ name: text, url: address }).passthrough(),
  RealEstateListing: z
    .object({ name: text, url: address, about: z.object({}).passthrough() })
    .passthrough(),
  BreadcrumbList: z
    .object({
      itemListElement: items(
        z.object({ position: z.number().int().min(1), name: text, item: address }).passthrough(),
      ),
    })
    .passthrough(),
  Article: z
    .object({
      headline: text,
      datePublished: text,
      author: z.object({ name: text }).passthrough(),
      publisher: z.object({ name: text }).passthrough(),
    })
    .passthrough(),
  CollectionPage: z.object({ name: text, url: address, mainEntity: itemList }).passthrough(),
  ItemList: itemList,
  FAQPage: z
    .object({
      mainEntity: items(
        z.object({ name: text, acceptedAnswer: z.object({ text }).passthrough() }).passthrough(),
      ),
    })
    .passthrough(),
  VideoObject: z.object({ name: text, contentUrl: address }).passthrough(),
};

const block = z
  .object({
    "@context": z.literal("https://schema.org"),
    "@graph": z.array(z.unknown()).optional(),
  })
  .passthrough();
const node = z.object({ "@type": text }).passthrough();

function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  return issue === undefined ? "invalid" : `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}

/**
 * The type of every node in the page's structured data, in page order. Throws, naming the block, the type and the
 * field, on a page without a block, a block that is not JSON, a wrong context or a node missing a required field.
 */
export function validateHtml(html: string): string[] {
  const sources = [...html.matchAll(SCRIPT)].map((match) => match[1] ?? "");
  if (sources.length === 0) throw new Error("no application/ld+json block");
  return sources.flatMap((source, index) => {
    const label = `block ${String(index + 1)}`;
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(
        `${label} is not valid JSON (${error instanceof Error ? error.message : "parse error"})`,
        {
          cause: error,
        },
      );
    }
    const checked = block.safeParse(parsed);
    if (!checked.success) throw new Error(`${label} @context: ${describe(checked.error)}`);
    return (checked.data["@graph"] ?? [checked.data]).map((member) => {
      const typed = node.safeParse(member);
      if (!typed.success) throw new Error(`${label} @type: ${describe(typed.error)}`);
      const type = typed.data["@type"];
      const result = schemas[type]?.safeParse(member);
      if (result?.success === false) throw new Error(`${label} ${type}.${describe(result.error)}`);
      return type;
    });
  });
}

const pageTypes = [
  { type: "home", pick: (): string => "/" },
  { type: "faq", pick: (): string => "/faq" },
  {
    type: "property",
    pick: (paths: string[]) => paths.find((path) => path.startsWith("/property/")),
  },
  { type: "story", pick: (paths: string[]) => paths.find((path) => path.startsWith("/stories/")) },
  {
    type: "archive",
    pick: (paths: string[]) => paths.find((path) => path.startsWith("/archive/")),
  },
];

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
  return response.text();
}

/** The pages to check for one bare base URL: one per page type, `undefined` for a type with no page. */
async function pagesOf(base: string): Promise<{ type: string; url: string | undefined }[]> {
  const sitemap = await fetchText(`${base}/sitemap.xml`);
  const paths = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => new URL(match[1] ?? "", base).pathname,
  );
  return pageTypes.map(({ type, pick }) => {
    const path = pick(paths);
    return { type, url: path === undefined ? undefined : `${base}${path}` };
  });
}

async function main(args: string[]): Promise<void> {
  const [first] = args;
  if (first === undefined)
    throw new Error("usage: bun run scripts/validate-jsonld.ts <url>... | <baseUrl>");
  const bare = args.length === 1 && new URL(first).pathname === "/";
  const pages = bare
    ? await pagesOf(first.replace(/\/$/, ""))
    : args.map((url) => ({ type: url, url }));
  for (const { type, url } of pages) {
    if (url === undefined) {
      console.log(`skip ${type}`);
      continue;
    }
    try {
      console.log(`ok ${url} ${[...new Set(validateHtml(await fetchText(url)))].join(", ")}`);
    } catch (error) {
      throw new Error(`${url}: ${error instanceof Error ? error.message : "failed"}`, {
        cause: error,
      });
    }
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(`fail ${error instanceof Error ? error.message : "failed"}`);
    process.exit(1);
  });
}

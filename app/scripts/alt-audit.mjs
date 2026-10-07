// `node scripts/alt-audit.mjs <baseUrl>`: fetches every static page route of the sweep plus the first property, reads
// every `<img>` and exits 1, one line per image, on a missing `alt`, an `alt` equal to the file name, or a non-empty
// `alt` on an image marked `role="presentation"` or `aria-hidden="true"`. Exits 0 otherwise.
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * @param {string} tag one `<img ...>` tag
 * @returns {Map<string, string>} its attributes by lower-case name; a bare attribute holds ""
 */
function attributesOf(tag) {
  /** @type {Map<string, string>} */
  const attributes = new Map();
  for (const match of tag.matchAll(/([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    const [, name, double, single, bare] = match;
    if (name !== undefined && name.toLowerCase() !== "img") {
      attributes.set(name.toLowerCase(), double ?? single ?? bare ?? "");
    }
  }
  return attributes;
}

/**
 * @param {string} html one page
 * @returns {string[]} one line per image that breaks a rule, naming its `src`
 */
export function auditAlt(html) {
  const problems = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = attributesOf(tag);
    const src = attributes.get("src") ?? "(no src)";
    const alt = attributes.get("alt");
    const decorative =
      attributes.get("role") === "presentation" || attributes.get("aria-hidden") === "true";
    const file = decodeURIComponent(src.split(/[?#]/)[0]?.split("/").pop() ?? "");
    if (alt === undefined) problems.push(`${src}: no alt attribute`);
    else if (decorative && alt !== "") problems.push(`${src}: decorative image with alt "${alt}"`);
    else if (alt !== "" && alt.toLowerCase() === file.toLowerCase()) {
      problems.push(`${src}: alt is the file name`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const base = process.argv[2]?.replace(/\/+$/, "");
  if (base === undefined || base === "") {
    console.error("usage: node scripts/alt-audit.mjs <baseUrl>");
    process.exit(64);
  }
  try {
    const { staticRoutes } = await import("../tests/e2e/fixtures/routes.ts");
    const properties = z
      .array(z.object({ slug: z.string() }))
      .min(1)
      .parse(await (await fetch(`${base}/api/public/properties`)).json());
    const paths = [
      ...staticRoutes.map((route) => route.path),
      `/property/${properties[0]?.slug ?? ""}`,
    ];
    let images = 0;
    let failures = 0;
    for (const path of paths) {
      const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`${path} answered ${String(response.status)}`);
      const html = await response.text();
      images += html.match(/<img\b/gi)?.length ?? 0;
      for (const problem of auditAlt(html)) {
        failures += 1;
        console.log(`${path} ${problem}`);
      }
    }
    console.log(
      `alt-audit: ${String(paths.length)} pages, ${String(images)} images, ${String(failures)} in breach`,
    );
    process.exitCode = failures === 0 ? 0 : 1;
  } catch (error) {
    console.error(`alt-audit: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

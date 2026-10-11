// `node scripts/lhci-urls.mjs <baseUrl>`: prints the six absolute URLs Lighthouse measures, one per line (GQ-01). The
// templates are the `paths` of `budget.json`; `property:first` and `market:first` become the first item of
// `GET /api/public/properties` and `/markets` of the target, so it works on a preview and on a locally served build.
// Exits 1 naming the endpoint when the markets list is not 200 or is empty; an empty property list measures /properties.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const base = process.argv[2]?.replace(/\/+$/, "");
if (base === undefined || base === "") {
  console.error("usage: node scripts/lhci-urls.mjs <baseUrl>");
  process.exit(64);
}

const { paths } = z
  .object({ paths: z.array(z.string()) })
  .parse(
    JSON.parse(readFileSync(fileURLToPath(new URL("../budget.json", import.meta.url)), "utf8")),
  );

const list = z.array(z.object({ slug: z.string() })).min(1);

/**
 * @param {string} root
 * @param {string} endpoint
 * @returns {Promise<string>} the slug of the first item
 */
async function firstSlug(root, endpoint) {
  const response = await fetch(`${root}${endpoint}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${endpoint} answered ${String(response.status)}`);
  const parsed = list.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${endpoint} lists nothing`);
  return parsed.data[0]?.slug ?? "";
}

try {
  const urls = [];
  for (const template of paths) {
    if (template === "property:first") {
      // Coming-soon (L1, 2026-10-11): production lists no property until the first is published, so the empty
      // collection page stands in for the property template; a non-empty list measures its first property again.
      const slug = await firstSlug(base, "/api/public/properties").catch(() => "");
      urls.push(slug === "" ? `${base}/properties` : `${base}/property/${slug}`);
    } else if (template === "market:first") {
      urls.push(`${base}/${await firstSlug(base, "/api/public/markets")}`);
    } else {
      urls.push(`${base}${template}`);
    }
  }
  console.log(urls.join("\n"));
} catch (error) {
  console.error(`lhci-urls: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

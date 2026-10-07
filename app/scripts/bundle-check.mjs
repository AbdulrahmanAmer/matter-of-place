import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { z } from "zod";

// FE-03 (2), run on the live artifact before the build job uploads it: the first-load script of each public
// route stays under the budget, no chunk a public route can reach is the entry of a bundled catalog or admin
// module, and no property title of the bundled seed is in the output.
// usage: node scripts/bundle-check.mjs [.output]

/**
 * The same number as `budget.json` of B4, which `perf-budget.test.ts` compares. 160 KiB since ruling H66
 * (2026-10-07): the public entry's floor is 143,354 gzip bytes of framework on main, the admin route shells of B7's
 * 27 screens are bounded near 6 KB by `admin-route-shells.test.ts`, and 153,600 left 654 bytes.
 */
export const SCRIPT_BUDGET_BYTES = 163_840;

const USAGE = "usage: node scripts/bundle-check.mjs [.output]";
const ROUTE_CHUNK = /^src\/routes\/(.+)\.tsx\?tsr-split=component$/;
// Pricing and FAQ copy is the one use of `src/data` a route may keep (AGENTS.md).
const FORBIDDEN = [
  /^src\/admin\//,
  /^src\/domain\/admin-/,
  /^src\/data\/(?!exposure\.ts$|faq\.ts$)/,
];
const TITLE = /^\s+title: ("(?:[^"\\]|\\.)*"),$/gm;
const TEXT_FILE = /\.(?:js|mjs|html|css)$/;

const manifestSchema = z.record(
  z.string(),
  z.object({
    file: z.string(),
    src: z.string().optional(),
    isEntry: z.boolean().optional(),
    imports: z.array(z.string()).optional(),
    dynamicImports: z.array(z.string()).optional(),
  }),
);

/**
 * @typedef {z.infer<typeof manifestSchema>} Manifest
 * @typedef {{ route: string, bytes: number }} RouteSize
 */

/**
 * The manifest keys a chunk loads with it, itself included, through static imports only (or through every
 * import when `dynamic` is set).
 * @param {Manifest} manifest
 * @param {string} key
 * @param {boolean} dynamic
 * @param {Set<string>} seen
 */
function reach(manifest, key, dynamic, seen) {
  if (seen.has(key)) return seen;
  const chunk = manifest[key];
  if (chunk === undefined) throw new Error(`the manifest names ${key} but has no entry for it`);
  seen.add(key);
  for (const next of [...(chunk.imports ?? []), ...(dynamic ? (chunk.dynamicImports ?? []) : [])]) {
    reach(manifest, next, dynamic, seen);
  }
  return seen;
}

/**
 * Sizes every public route and lists the forbidden modules a public route can reach. A route loads the entry,
 * its own chunk and the chunk of every route it nests in (`_site.stories` holds `_site.stories.$slug`).
 * @param {Manifest} manifest
 * @param {(file: string) => number} gzipSize gzip bytes of a built file, by its manifest `file`
 * @returns {{ routes: RouteSize[], problems: string[] }}
 */
export function checkManifest(manifest, gzipSize) {
  const entries = Object.keys(manifest);
  const entry = entries.find((key) => manifest[key]?.isEntry === true);
  if (entry === undefined) return { routes: [], problems: ["the manifest has no entry chunk"] };
  /** @type {Map<string, string>} route id to manifest key */
  const chunks = new Map();
  for (const key of entries) {
    const id = ROUTE_CHUNK.exec(manifest[key]?.src ?? key)?.[1];
    if (id !== undefined && !id.startsWith("admin") && !id.startsWith("api/")) chunks.set(id, key);
  }
  /** @type {RouteSize[]} */
  const routes = [];
  /** @type {Set<string>} */
  const everything = new Set();
  for (const [id, key] of chunks) {
    const loaded = reach(manifest, entry, false, new Set());
    for (const [other, otherKey] of chunks) {
      if (other === id || id.startsWith(`${other}.`)) reach(manifest, otherKey, false, loaded);
    }
    let bytes = 0;
    for (const loadedKey of loaded) bytes += gzipSize(manifest[loadedKey]?.file ?? loadedKey);
    routes.push({ route: id, bytes });
    for (const reachable of reach(manifest, key, true, new Set())) everything.add(reachable);
  }
  for (const reachable of reach(manifest, entry, false, new Set())) everything.add(reachable);
  const problems = routes
    .filter((size) => size.bytes > SCRIPT_BUDGET_BYTES)
    .map(
      (size) =>
        `${size.route} loads ${String(size.bytes)} gzip bytes, over the budget of ${String(SCRIPT_BUDGET_BYTES)}`,
    );
  for (const key of everything) {
    const source = manifest[key]?.src ?? key;
    if (FORBIDDEN.some((pattern) => pattern.test(source)))
      problems.push(`a chunk a public route can reach holds ${source}`);
  }
  return { routes, problems };
}

/**
 * The titles of the bundled seed properties, read from the source text of `src/data/properties.ts`.
 * @param {string} source
 * @returns {string[]}
 */
export function seedTitles(source) {
  return [...source.matchAll(TITLE)].map((match) => z.string().parse(JSON.parse(match[1] ?? "")));
}

/**
 * @param {string} dir
 * @returns {string[]} the text files under `dir`, by path
 */
function textFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return textFiles(path);
    return TEXT_FILE.test(item.name) ? [path] : [];
  });
}

/**
 * Checks a built output folder; returns the exit code and prints one line per route.
 * @param {string} output the folder holding `public/` (the Nitro `.output`)
 * @param {string} propertiesSource the text of `src/data/properties.ts`
 * @param {(line: string) => void} print
 * @returns {number}
 */
export function runBundleCheck(output, propertiesSource, print) {
  const publicDir = join(output, "public");
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(publicDir, ".vite", "manifest.json"), "utf8")),
  );
  const { routes, problems } = checkManifest(
    manifest,
    (file) => gzipSync(readFileSync(join(publicDir, file))).length,
  );
  const titles = seedTitles(propertiesSource);
  if (titles.length === 0) problems.push("no property title found in src/data/properties.ts");
  for (const path of textFiles(output)) {
    const text = readFileSync(path, "utf8");
    const found = titles.find((title) => text.includes(title));
    if (found !== undefined)
      problems.push(`${path} holds the seed title "${found}" of src/data/properties.ts`);
  }
  for (const size of routes) print(`ok   ${size.route} ${String(size.bytes)} gzip bytes`);
  for (const problem of problems) print(`FAIL ${problem}`);
  print(
    problems.length === 0
      ? `bundle-check: OK ${String(routes.length)} routes under ${String(SCRIPT_BUDGET_BYTES)} gzip bytes`
      : `bundle-check: FAILED ${String(problems.length)}`,
  );
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [output = ".output", ...rest] = process.argv.slice(2);
  if (rest.length > 0 || output.startsWith("--")) {
    process.stdout.write(`${USAGE}\n`);
    process.exit(2);
  }
  process.exitCode = runBundleCheck(
    output,
    readFileSync(resolve("src/data/properties.ts"), "utf8"),
    (line) => process.stdout.write(`${line}\n`),
  );
}

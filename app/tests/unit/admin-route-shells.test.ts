import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Ruling H66 (amended 2026-10-07 06:20): the public entry loads every route file of the tree, admin ones included,
// so an admin route file is a shell. It may import statically only the router, the shared head helper and a
// stylesheet address; everything else is loaded inside the route (`await import()` in beforeLoad or loader) or lives
// in `src/admin/**`, which no public chunk may reach (`scripts/bundle-check.mjs`). A page or error component
// is imported with `lazyRouteComponent(() => import(...))`, and a `.lazy.tsx` sibling is not added: it costs 59 to 67
// more gzip bytes per route (B7 g2, People routes). Measured on main: four admin route files cost the entry 2,527 bytes.
const APP = join(import.meta.dirname, "..", "..");
const ROUTES = join(APP, "src", "routes");
const ALLOWED = [/^@tanstack\/react-router$/, /^(?:\.\.\/)+lib\/seo$/, /\.css\?url$/];
const STATIC_IMPORT = /^import\s[^;]*?from\s+"([^"]+)";?$/gm;

/** @returns every non-lazy admin route file, as a path from the app folder */
function adminRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return item.name === "admin" ? adminRouteFiles(path) : [];
    const rel = relative(APP, path).replaceAll("\\", "/");
    const isAdmin = rel === "src/routes/admin.tsx" || rel.startsWith("src/routes/admin/");
    return isAdmin && rel.endsWith(".tsx") && !rel.endsWith(".lazy.tsx") ? [rel] : [];
  });
}

describe("admin route files are shells (H66)", () => {
  const files = adminRouteFiles(ROUTES);

  it.each(files)("%s imports only the router, the head helper and a stylesheet address", (rel) => {
    const text = readFileSync(join(APP, rel), "utf8");
    const foreign = [...text.matchAll(STATIC_IMPORT)]
      .map((match) => match[1] ?? "")
      .filter((specifier) => !ALLOWED.some((pattern) => pattern.test(specifier)));
    expect(foreign, `${rel} imports ${foreign.join(", ")} statically`).toEqual([]);
  });
});

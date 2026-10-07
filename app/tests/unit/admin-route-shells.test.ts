import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Ruling H66: the public entry loads every route file of the tree, admin ones included, so an admin route file is
// a shell. It may import statically only the router, the shared head helper and a stylesheet address; everything
// else is loaded inside the route (`await import()` in beforeLoad or loader) or lives in the `.lazy.tsx` sibling
// and in `src/admin/**`, which no public chunk may reach (`scripts/bundle-check.mjs`). Measured on main at
// 2026-10-07: four admin route files cost the public entry 2,527 gzip bytes.
const APP = join(import.meta.dirname, "..", "..");
const ROUTES = join(APP, "src", "routes");
const ALLOWED = [/^@tanstack\/react-router$/, /^(?:\.\.\/)+lib\/seo$/, /\.css\?url$/];
// Built before the ruling; B7 step 6 turns each into a shell and removes it here (merge-chores.md, B7).
const LEGACY = new Set([
  "src/routes/admin.tsx",
  "src/routes/admin/auth.confirm.tsx",
  "src/routes/admin/requests.index.tsx",
  "src/routes/admin/sign-in.tsx",
]);
const STATIC_IMPORT = /^import\s[^;]*?from\s+"([^"]+)";?$/gm;
const COMPONENT = /^\s*component:/m;

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
  const files = adminRouteFiles(ROUTES).filter((rel) => !LEGACY.has(rel));

  it("lists the legacy files that still exist, so a converted one leaves the list", () => {
    const gone = [...LEGACY].filter((rel) => !adminRouteFiles(ROUTES).includes(rel));
    expect(gone).toEqual([]);
  });

  it.each(files)("%s imports only the router, the head helper and a stylesheet address", (rel) => {
    const text = readFileSync(join(APP, rel), "utf8");
    const foreign = [...text.matchAll(STATIC_IMPORT)]
      .map((match) => match[1] ?? "")
      .filter((specifier) => !ALLOWED.some((pattern) => pattern.test(specifier)));
    expect(foreign, `${rel} imports ${foreign.join(", ")} statically`).toEqual([]);
  });

  it.each(files)("%s defines no component (the .lazy.tsx sibling does)", (rel) => {
    const text = readFileSync(join(APP, rel), "utf8");
    expect(COMPONENT.test(text), `${rel} defines a component`).toBe(false);
  });
});

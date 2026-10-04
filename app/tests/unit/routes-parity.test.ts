import "../fixtures/worker-env";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { routes } from "../../src/server/public/routes";

// The route table is the one source for the handlers (architecture 4.1): a file with no row would answer 404 from
// `handlePublic`, and a row with no file would never be reached.
const DIR = fileURLToPath(new URL("../../src/routes/api/public", import.meta.url));
const PREFIX = "/api/public/";
const CONFIRM = "/api/public/subscribers/confirm";

/** `properties.$slug.ts` is `/api/public/properties/:slug`, as the router names its file routes. */
const pathOf = (file: string): string =>
  PREFIX +
  file
    .replace(/\.ts$/, "")
    .split(".")
    .map((part) => (part.startsWith("$") ? `:${part.slice(1)}` : part))
    .join("/");

const files = readdirSync(DIR).filter((name) => name.endsWith(".ts"));
const tablePaths = [...new Set(routes.map((route) => route.path))].filter((path) =>
  path.startsWith(PREFIX),
);

describe("the public route table and its files", () => {
  it("has a row for every file under src/routes/api/public", () => {
    expect(files.map(pathOf).filter((path) => !tablePaths.includes(path))).toEqual([]);
  });

  it("has a file for every row", () => {
    expect(tablePaths.filter((path) => !files.map(pathOf).includes(path))).toEqual([]);
  });

  it("declares ANY in each file, so every method reaches handlePublic, and only calls handlePublic", () => {
    for (const file of files) {
      const source = readFileSync(join(DIR, file), "utf8");
      expect(source).toContain("handlers: { ANY: ({ request, context }) =>");
      expect(source).toContain("handlePublic(request, context.requestId)");
      expect(source).not.toContain("supabase");
    }
  });

  it("never stores the confirm link, which answers each visitor its own redirect", () => {
    const confirm = routes.find((route) => route.path === CONFIRM);
    expect(confirm?.method).toBe("GET");
    expect(confirm?.cache).toBeUndefined();
  });

  it("lists each method of a path once", () => {
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("stores every read under the catalog tag for a year (PERF-05)", () => {
    const reads = routes.filter((route) => route.method === "GET" && route.path !== CONFIRM);
    expect(reads.length).toBeGreaterThan(0);
    for (const route of reads) {
      expect(route.cache?.tags[0]).toBe("catalog");
      expect(route.cache?.sMaxAge).toBe(31_536_000);
    }
  });
});

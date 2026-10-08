import { readdirSync, readFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

// Invariant 9 (B7): admin code reaches data only through `adminFetch`, and never imports server, database or
// seed code. The scanners below run over the real tree and over a sample that breaks each rule.
const SRC = join(process.cwd(), "src");
const ADMIN = join(SRC, "admin");
const FETCH_HOME = "admin/ui/admin-fetch.ts";
const FORBIDDEN = ["server", "db", "data"];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return filesUnder(path);
    return /\.tsx?$/.test(item.name) ? [path] : [];
  });
}

const IMPORT = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;

/** The folder under `src` that each import of `source` (a file at `from`, relative to `src`) reaches. */
function importedFolders(source: string, from: string): string[] {
  return [...source.matchAll(IMPORT)].flatMap((match) => {
    const specifier = match[1] ?? "";
    const target = specifier.startsWith("@/")
      ? specifier.slice(2)
      : specifier.startsWith(".")
        ? posix.join(posix.dirname(from), specifier)
        : null;
    return target === null ? [] : [target.split("/")[0] ?? ""];
  });
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** True when `source` calls the global `fetch` (a name that merely ends in fetch, like `adminFetch(`, is not it). */
function callsFetch(source: string): boolean {
  return /(?<![\w$])fetch\s*\(/.test(withoutComments(source));
}

const adminFiles = filesUnder(ADMIN).map((path) => ({
  path: relative(SRC, path).split(sep).join("/"),
  source: readFileSync(path, "utf8"),
}));

describe("admin code boundaries", () => {
  it("scans the admin tree", () => {
    expect(adminFiles.length).toBeGreaterThan(20);
    expect(adminFiles.map((file) => file.path)).toContain(FETCH_HOME);
  });

  it("no admin file imports src/server, src/db or src/data", () => {
    const offenders = adminFiles.flatMap(({ path, source }) =>
      importedFolders(source, path)
        .filter((folder) => FORBIDDEN.includes(folder))
        .map((folder) => `${path} imports src/${folder}`),
    );
    expect(offenders).toEqual([]);
  });

  it("a fetch call outside admin-fetch.ts fails the boundary", () => {
    const offenders = adminFiles
      .filter(({ path, source }) => path !== FETCH_HOME && callsFetch(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("admin-fetch.ts is where the fetch calls are", () => {
    const home = adminFiles.find((file) => file.path === FETCH_HOME);
    expect(callsFetch(home?.source ?? "")).toBe(true);
  });

  it("the scanners flag a server import and a bare fetch, and pass adminFetch", () => {
    const sample = [
      'import { getDb } from "../../server/lib/db";',
      'import type { Row } from "@/db/types";',
      'const rows = await import("../../data/properties");',
      'import { adminFetch } from "../ui/admin-fetch";',
    ].join("\n");
    expect(importedFolders(sample, "admin/jobs/jobs-api.ts")).toEqual([
      "server",
      "db",
      "data",
      "admin",
    ]);
    expect(callsFetch('const r = await fetch("/api/admin/x");')).toBe(true);
    expect(callsFetch('const r = await window.fetch("/api/admin/x");')).toBe(true);
    expect(callsFetch('const r = await adminFetch("/api/admin/x", schema);')).toBe(false);
    expect(callsFetch('// fetch("/api") is not allowed here\nconst x = 1;')).toBe(false);
  });
});

describe("the admin layout", () => {
  // The route file links the stylesheet; its lazy component (`AdminLayout`) draws the page.
  const layout = ["routes/admin.tsx", "admin/ui/AdminLayout.tsx"]
    .map((file) => readFileSync(join(SRC, file), "utf8"))
    .join("\n");

  it("links the admin stylesheet and no public one", () => {
    expect(layout).toContain("styles/admin/index.css?url");
    expect(layout).not.toMatch(/styles\.css|styles\/(?!admin\/)/);
  });

  it("mounts none of the public chrome or its effects", () => {
    expect(layout).not.toMatch(
      /SiteChrome|Header|Footer|ConsentNotice|Ga4Loader|captureAttribution/,
    );
  });
});

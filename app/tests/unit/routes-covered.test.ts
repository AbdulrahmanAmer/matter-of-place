import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  classifyRouteFile,
  dynamicPatterns,
  routeFileCoverage,
  routeFiles,
  seoFileRoutes,
  sitemapRoute,
  staticRoutes,
} from "../e2e/fixtures/routes";

const ROUTES_DIR = fileURLToPath(new URL("../../src/routes/", import.meta.url));
const text = (file: string) => readFileSync(`${ROUTES_DIR}${file}`, "utf8");

// A route file that only redirects has no component; a page that redirects some addresses (`$market.$region.tsx`) has one.
const isRedirectOnly = (file: string) => {
  const source = text(file);
  return source.includes("throw redirect(") && !/\bcomponent\s*:/.test(source);
};

describe("route files", () => {
  it("are all classified, so a new page route gets a Playwright route", () => {
    expect(routeFiles.filter((file) => classifyRouteFile(file) === undefined)).toEqual([]);
  });

  it("are all still on disk when the map names them", () => {
    expect(Object.keys(routeFileCoverage).filter((file) => !routeFiles.includes(file))).toEqual([]);
  });

  it("map a redirect-only file to redirect and any other file to something else", () => {
    const mapped = Object.keys(routeFileCoverage).filter((file) => routeFiles.includes(file));
    expect(
      mapped.filter((file) => isRedirectOnly(file) !== (routeFileCoverage[file] === "redirect")),
    ).toEqual([]);
  });

  it("serve a pattern the sweep lists", () => {
    const swept = new Set<string>([
      ...staticRoutes.map((route) => route.pattern),
      ...Object.values(dynamicPatterns),
      sitemapRoute,
    ]);
    const patterns = Object.values(routeFileCoverage).filter((entry) => entry.startsWith("/"));
    expect(patterns.filter((pattern) => !swept.has(pattern))).toEqual([]);
  });

  it("path rules: api is server, admin is admin, anything else needs an entry", () => {
    expect(classifyRouteFile("api/zz.ts")).toBe("server");
    expect(classifyRouteFile("admin/zz.tsx")).toBe("admin");
    expect(classifyRouteFile("admin.tsx")).toBe("admin");
    expect(classifyRouteFile("zz.tsx")).toBeUndefined();
  });

  it("seoFileRoutes equals the robots and llms route files present", () => {
    const present = readdirSync(ROUTES_DIR)
      .filter((file) => ["robots[.]txt.ts", "llms[.]txt.ts", "llms-full[.]txt.ts"].includes(file))
      .map((file) => `/${file.replace("[.]", ".").replace(/\.ts$/, "")}`)
      .sort();
    expect([...seoFileRoutes].sort()).toEqual(present);
  });
});

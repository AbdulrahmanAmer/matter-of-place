import { readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { describe, expect, it } from "vitest";

interface Source {
  file: string;
  text: string;
}

interface Import {
  file: string;
  line: number;
  specifier: string;
  resolved: string;
}

const SKIPPED = new Set(["src/routeTree.gen.ts", "src/db/types.ts"]);
const TEXT = /\.(ts|tsx|css|md)$/;

const sources: Source[] = readdirSync("src", { recursive: true, encoding: "utf8" })
  .map((path) => `src/${path.replaceAll("\\", "/")}`)
  .filter((file) => TEXT.test(file) && !SKIPPED.has(file))
  .map((file) => ({ file, text: readFileSync(file, "utf8") }));

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function resolveSpecifier(file: string, specifier: string): string {
  const path = specifier.startsWith("@/")
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith(".")
      ? posix.join(posix.dirname(file), specifier)
      : specifier;
  return path.replace(/\.(tsx?|jsx?)$/, "");
}

const FROM_CLAUSE =
  /\b(?:import|export)\s+(type\s+)?([\w*${},\s]+?)\s+from\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function valueImports({ file, text }: Source): Import[] {
  if (!/\.tsx?$/.test(file)) return [];
  return [...text.matchAll(FROM_CLAUSE)].flatMap((match) => {
    const [, typeOnly, clause, fromSpecifier, bareSpecifier, dynamicSpecifier] = match;
    const specifier = fromSpecifier ?? bareSpecifier ?? dynamicSpecifier;
    if (specifier === undefined || typeOnly !== undefined) return [];
    const names = clause?.match(/^\{([^}]*)\}$/)?.[1];
    const allTypes =
      names !== undefined &&
      names
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name !== "")
        .every((name) => name.startsWith("type "));
    return allTypes
      ? []
      : [
          {
            file,
            line: lineOf(text, match.index),
            specifier,
            resolved: resolveSpecifier(file, specifier),
          },
        ];
  });
}

const imports = sources.flatMap(valueImports);

function under(path: string, ...prefixes: string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

const isServerSide = (file: string) => under(file, "src/server", "src/domain");
const isBrowser = (file: string) =>
  under(file, "src/components", "src/admin", "src/hooks", "src/services") ||
  (file.startsWith("src/routes/") && file.endsWith(".tsx")) ||
  (under(file, "src/lib") && !file.endsWith(".functions.ts"));

const report = (found: Import[]) =>
  found.map((i) => `${i.file}:${String(i.line)} imports ${i.specifier}`);

function matches(pattern: RegExp, allowed: (file: string) => boolean = () => false) {
  return sources
    .filter(({ file }) => !allowed(file))
    .flatMap(({ file, text }) =>
      text
        .split("\n")
        .flatMap((line, index) => (pattern.test(line) ? [`${file}:${String(index + 1)}`] : [])),
    );
}

describe("layers (R06, G-005)", () => {
  it("keeps server and domain code away from the browser layers", () => {
    const banned = ["src/data", "src/components", "src/admin", "src/routes", "src/services"];
    const found = imports.filter((i) => isServerSide(i.file) && under(i.resolved, ...banned));
    expect(report(found)).toEqual([]);
  });

  it("keeps browser code away from src/server and src/db", () => {
    const found = imports.filter(
      (i) => isBrowser(i.file) && under(i.resolved, "src/server", "src/db"),
    );
    expect(report(found)).toEqual([]);
  });

  it("lets only the local adapter read the illustrative data, and routes read exposure and faq only", () => {
    const illustrative = ["src/data/properties", "src/data/stories", "src/data/markets"];
    const found = imports.filter(
      (i) =>
        (!under(i.file, "src/services/local") && under(i.resolved, ...illustrative)) ||
        (under(i.file, "src/routes") &&
          under(i.resolved, "src/data") &&
          !under(i.resolved, "src/data/exposure", "src/data/faq")),
    );
    expect(report(found)).toEqual([]);
  });
});

describe("route and admin imports (R11, R41)", () => {
  it("keeps API route files away from actor, authz, csrf, the database and supabase-js", () => {
    const banned = [
      "src/server/lib/actor",
      "src/server/lib/authz",
      "src/server/lib/csrf",
      "src/db",
    ];
    const found = imports.filter(
      (i) =>
        under(i.file, "src/routes/api") &&
        (under(i.resolved, ...banned) || i.specifier === "@supabase/supabase-js"),
    );
    expect(report(found)).toEqual([]);
  });

  it("keeps admin components away from *-api modules", () => {
    const found = imports.filter(
      (i) => under(i.file, "src/admin") && i.file.endsWith(".tsx") && i.resolved.endsWith("-api"),
    );
    expect(report(found)).toEqual([]);
  });
});

describe("call sites (R26, R38, API-01)", () => {
  it("calls the job lifecycle RPCs only from src/server/jobs/claim.ts (R26)", () => {
    const pattern = /rpc\(\s*["'`](claim_job|finish_job|fail_job|requeue_job)["'`]/;
    expect(matches(pattern, (file) => file === "src/server/jobs/claim.ts")).toEqual([]);
  });

  it("selects subscribers only in the consent-aware modules (R38)", () => {
    const allowed = (file: string) =>
      under(file, "src/server/subscribers") ||
      file === "src/server/newsletter/audience.ts" ||
      file === "src/server/jobs/system/market-open-notice.ts";
    expect(matches(/from\(\s*["'`]subscribers["'`]\s*\)/, allowed)).toEqual([]);
  });

  it("never calls exchangeCodeForSession (API-01)", () => {
    expect(matches(/exchangeCodeForSession/)).toEqual([]);
  });
});

describe("styling and copy (R42, R46)", () => {
  const hexFiles = new Set(["src/styles/tokens.css", "src/templates/theme.gen.ts"]);

  it("holds no hex colour outside tokens.css, theme.gen.ts and the theme-color line (R42)", () => {
    const found = sources
      .filter(({ file }) => /\.(tsx?|css)$/.test(file) && !hexFiles.has(file))
      .flatMap(({ file, text }) => {
        const pattern = file.endsWith(".css")
          ? /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/
          : /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6})(?![0-9a-zA-Z])/;
        return text
          .split("\n")
          .flatMap((line, index) =>
            pattern.test(line) &&
            !(file === "src/routes/__root.tsx" && line.includes("theme-color"))
              ? [`${file}:${String(index + 1)}`]
              : [],
          );
      });
    expect(found).toEqual([]);
  });

  it("holds no em dash anywhere under src (R46)", () => {
    expect(matches(/—/)).toEqual([]);
  });
});

// W8 item 12b: the date of each static document page, made from git history at build and committed beside the code.
import "../fixtures/worker-env";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  lastCommitDay,
  pageSources,
  renderPageDates,
  resolvePageDates,
  type Git,
} from "../../scripts/gen-page-dates";
import { pageDates } from "../../src/server/seo/page-dates.gen";
import { staticSitemapPaths } from "../../src/server/seo/sitemap";

const appFile = (path: string): string => fileURLToPath(new URL(`../../${path}`, import.meta.url));
const stamp = (day: string): string => String(Date.parse(`${day}T12:00:00Z`) / 1000);

/** A git that answers with the stamp of a day for each pathspec or `-L` range that names a key, and nothing else. */
const gitAt =
  (days: Record<string, string>): Git =>
  (args) => {
    const key = Object.keys(days).find((name) => args.some((arg) => arg.includes(name)));
    return key === undefined ? "" : `${stamp(days[key] ?? "")}\n\n`;
  };

describe("lastCommitDay", () => {
  it("is the UTC day of the newest commit that touched the file", () => {
    expect(
      lastCommitDay(gitAt({ "_site.about.tsx": "2026-10-11" }), "src/routes/_site.about.tsx"),
    ).toBe("2026-10-11");
  });

  it("is undefined where git has no commit for the file", () => {
    expect(lastCommitDay(gitAt({}), "src/routes/_site.about.tsx")).toBeUndefined();
  });

  it("reads one section of the string table through a literal-brace range, newest stamp first", () => {
    const seen: string[][] = [];
    const git: Git = (args) => {
      seen.push(args);
      return `${stamp("2026-10-08")}\n\n${stamp("2026-09-30")}\n`;
    };
    expect(lastCommitDay(git, { file: "src/lib/strings.ts", section: "privacy" })).toBe(
      "2026-10-08",
    );
    expect(seen[0]).toContain("/^  privacy: [{]/,/^  [}],/:src/lib/strings.ts");
  });
});

describe("resolvePageDates", () => {
  const NOW = new Date("2026-10-19T09:00:00Z");

  it("dates a page by the newest of its files", () => {
    const dates = resolvePageDates(
      gitAt({ "_site.cookies.tsx": "2026-10-01", "cookies.ts": "2026-10-12" }),
      NOW,
      { "/cookies": ["src/routes/_site.cookies.tsx", "src/config/cookies.ts"] },
    );
    expect(dates).toEqual({ "/cookies": "2026-10-12" });
  });

  it("leaves a page out when none of its files has a commit", () => {
    const dates = resolvePageDates(gitAt({}), NOW, { "/about": ["src/routes/_site.about.tsx"] });
    expect(Object.keys(dates)).toEqual([]);
  });

  it("never dates a page later than now", () => {
    const dates = resolvePageDates(gitAt({ about: "2027-01-01" }), NOW, {
      "/about": ["src/routes/_site.about.tsx"],
    });
    expect(dates).toEqual({ "/about": "2026-10-19" });
  });
});

describe("page-dates.gen.ts", () => {
  it("is what the generator writes from the dates it holds", () => {
    expect(readFileSync(appFile("src/server/seo/page-dates.gen.ts"), "utf8")).toBe(
      renderPageDates(pageDates),
    );
  });

  it("holds exactly the document pages of the sitemap and no catalog page", () => {
    expect(Object.keys(pageDates).sort()).toEqual(Object.keys(pageSources).sort());
    for (const path of Object.keys(pageDates)) expect(staticSitemapPaths).toContain(path);
    for (const catalog of ["/", "/properties", "/markets", "/stories"]) {
      expect(pageDates).not.toHaveProperty(catalog);
    }
  });

  it("holds a real day for each page, none in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const [path, day] of Object.entries(pageDates)) {
      expect([path, /^\d{4}-\d{2}-\d{2}$/.test(day)]).toEqual([path, true]);
      expect([path, day <= today]).toEqual([path, true]);
    }
  });

  it("names only files and folders that exist", () => {
    const missing = Object.values(pageSources)
      .flat()
      .map((source) => (typeof source === "string" ? source : source.file))
      .filter((file) => !existsSync(appFile(file)));
    expect(missing).toEqual([]);
  });

  it("names a section that the string table has", () => {
    const strings = readFileSync(appFile("src/lib/strings.ts"), "utf8");
    const sections = Object.values(pageSources)
      .flat()
      .flatMap((source) => (typeof source === "string" ? [] : source.section));
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) expect(strings).toMatch(new RegExp(`^  ${section}: \\{$`, "m"));
  });
});

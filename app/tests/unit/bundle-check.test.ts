// scripts/bundle-check.mjs (FE-03 (2), B3 step 12): a recorded manifest and built files, never a real build.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkManifest,
  runBundleCheck,
  SCRIPT_BUDGET_BYTES,
  seedTitles,
} from "../../scripts/bundle-check.mjs";

const APP = resolve(import.meta.dirname, "../..");
const ENTRY = "node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx";
const route = (id: string) => `src/routes/${id}.tsx?tsr-split=component`;

type Chunk = {
  file: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
};

/** The shape Vite writes: the entry loads `_shared` and lazily the route chunks. */
function recorded(extra: Record<string, Chunk> = {}): Record<string, Chunk> {
  return {
    [ENTRY]: {
      file: "assets/index.js",
      isEntry: true,
      imports: ["_shared.js"],
      dynamicImports: [route("_site"), route("_site.stories"), route("_site.stories.$slug")],
    },
    "_shared.js": { file: "assets/shared.js" },
    [route("_site")]: { file: "assets/site.js", src: route("_site") },
    [route("_site.stories")]: { file: "assets/stories.js", src: route("_site.stories") },
    [route("_site.stories.$slug")]: { file: "assets/story.js", src: route("_site.stories.$slug") },
    ...extra,
  };
}

const sizes = (bytes: Record<string, number>) => (file: string) => {
  const size = bytes[file];
  if (size === undefined) throw new Error(`no size recorded for ${file}`);
  return size;
};
const SMALL = { "assets/index.js": 1000, "assets/shared.js": 500, "assets/site.js": 100 };

describe("checkManifest", () => {
  it("passes an entry of 140 KB and fails one of 170 KB, naming the route", () => {
    const small = { ...SMALL, "assets/stories.js": 10, "assets/story.js": 10 };
    const heavy = (entry: number) =>
      checkManifest(recorded(), sizes({ ...small, "assets/index.js": entry }));
    expect([heavy(140_000).problems, heavy(170_000).problems]).toEqual([
      [],
      [
        `_site loads 170600 gzip bytes, over the budget of ${String(SCRIPT_BUDGET_BYTES)}`,
        `_site.stories loads 170610 gzip bytes, over the budget of ${String(SCRIPT_BUDGET_BYTES)}`,
        `_site.stories.$slug loads 170620 gzip bytes, over the budget of ${String(SCRIPT_BUDGET_BYTES)}`,
      ],
    ]);
  });

  it("sums the entry, the route's chunk and the chunk of each route it nests in", () => {
    const { routes } = checkManifest(
      recorded(),
      sizes({ ...SMALL, "assets/stories.js": 20, "assets/story.js": 3 }),
    );
    expect(routes).toEqual([
      { route: "_site", bytes: 1600 },
      { route: "_site.stories", bytes: 1620 },
      { route: "_site.stories.$slug", bytes: 1623 },
    ]);
  });

  it.each([
    "src/data/properties.ts",
    "src/data/markets.ts",
    "src/admin/screen.tsx",
    "src/domain/admin-roles.ts",
  ])("fails a chunk that lists %s, reached statically or lazily", (source) => {
    const bytes = { ...SMALL, "assets/stories.js": 1, "assets/story.js": 1, "assets/bad.js": 1 };
    for (const via of ["imports", "dynamicImports"] as const) {
      const manifest = recorded({ "_bad.js": { file: "assets/bad.js", src: source } });
      const story = manifest[route("_site.stories.$slug")];
      if (story === undefined) throw new Error("the recorded manifest lost a route");
      story[via] = ["_bad.js"];
      expect(checkManifest(manifest, sizes(bytes)).problems).toEqual([
        `a chunk a public route can reach holds ${source}`,
      ]);
    }
  });

  it("leaves the pricing and FAQ copy of src/data alone, and a chunk no public route reaches", () => {
    const manifest = recorded({
      "_exposure.js": { file: "assets/exposure.js", src: "src/data/exposure.ts" },
      "_faq.js": { file: "assets/faq.js", src: "src/data/faq.ts" },
      [route("admin.users")]: {
        file: "assets/admin.js",
        src: route("admin.users"),
        imports: ["_admin-screen.js"],
      },
      "_admin-screen.js": { file: "assets/admin-screen.js", src: "src/admin/screen.tsx" },
    });
    const entry = manifest[ENTRY];
    const story = manifest[route("_site.stories.$slug")];
    if (entry === undefined || story === undefined)
      throw new Error("the recorded manifest lost a chunk");
    // The entry lists every route, an admin one too, as a lazy import.
    entry.dynamicImports = [...(entry.dynamicImports ?? []), route("admin.users")];
    story.imports = ["_exposure.js", "_faq.js"];
    const all = { ...SMALL, "assets/stories.js": 1, "assets/story.js": 1 };
    const result = checkManifest(
      manifest,
      sizes({ ...all, "assets/exposure.js": 1, "assets/faq.js": 1, "assets/admin.js": 1 }),
    );
    expect([result.problems, result.routes.map((size) => size.route)]).toEqual([
      [],
      ["_site", "_site.stories", "_site.stories.$slug"],
    ]);
  });

  it("does not follow the entry's own lazy loads from a public route chunk that imports the entry (H66b)", () => {
    const manifest = recorded({
      [route("admin.requests.index")]: {
        file: "assets/admin-requests.js",
        src: route("admin.requests.index"),
        dynamicImports: ["_admin-fetch.js"],
      },
      "_admin-fetch.js": { file: "assets/admin-fetch.js", src: "src/admin/ui/admin-fetch.ts" },
    });
    const entry = manifest[ENTRY];
    const story = manifest[route("_site.stories.$slug")];
    if (entry === undefined || story === undefined)
      throw new Error("the recorded manifest lost a chunk");
    // Rolldown's route chunks import the entry chunk statically; the entry lazily loads every route file,
    // and an admin route file loads its helpers lazily inside beforeLoad (H66).
    entry.dynamicImports = [...(entry.dynamicImports ?? []), route("admin.requests.index")];
    story.imports = [ENTRY];
    const all = { ...SMALL, "assets/stories.js": 1, "assets/story.js": 1 };
    const clean = checkManifest(
      manifest,
      sizes({ ...all, "assets/admin-requests.js": 1, "assets/admin-fetch.js": 1 }),
    );
    // The same helper reached lazily from the public route itself is still a problem.
    story.dynamicImports = ["_admin-fetch.js"];
    const dirty = checkManifest(
      manifest,
      sizes({ ...all, "assets/admin-requests.js": 1, "assets/admin-fetch.js": 1 }),
    );
    expect([clean.problems, dirty.problems]).toEqual([
      [],
      ["a chunk a public route can reach holds src/admin/ui/admin-fetch.ts"],
    ]);
  });
});

describe("seedTitles", () => {
  it("reads every title of the bundled properties, with its escapes", () => {
    const source = `  {\n    id: "a",\n    title: "A house.",\n  },\n  {\n    title: "Water\\"s edge.",\n  },\n`;
    expect(seedTitles(source)).toEqual(["A house.", 'Water"s edge.']);
  });

  it("finds sixteen titles in src/data/properties.ts", () => {
    expect(seedTitles(readFileSync(join(APP, "src/data/properties.ts"), "utf8"))).toHaveLength(16);
  });
});

describe("the built output", () => {
  const folders: string[] = [];
  afterEach(() => {
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });

  /** A built `.output`: `public/.vite/manifest.json`, the files it names and a server bundle. */
  function built(entryBytes: number, serverText = "export {};"): string {
    const output = mkdtempSync(join(tmpdir(), "bundle-check-"));
    folders.push(output);
    mkdirSync(join(output, "public", ".vite"), { recursive: true });
    mkdirSync(join(output, "public", "assets"));
    mkdirSync(join(output, "server"));
    const files = {
      "assets/index.js": randomBytes(entryBytes),
      "assets/shared.js": Buffer.from("export const shared = 1;"),
      "assets/site.js": Buffer.from("export const site = 1;"),
      "assets/stories.js": Buffer.from("export const stories = 1;"),
      "assets/story.js": Buffer.from("export const story = 1;"),
    };
    for (const [file, content] of Object.entries(files))
      writeFileSync(join(output, "public", file), content);
    writeFileSync(join(output, "public", ".vite", "manifest.json"), JSON.stringify(recorded()));
    writeFileSync(join(output, "server", "ssr.mjs"), serverText);
    return output;
  }

  const properties = readFileSync(join(APP, "src/data/properties.ts"), "utf8");
  const title = seedTitles(properties)[0] ?? "";
  const run = (output: string) => {
    const lines: string[] = [];
    return { code: runBundleCheck(output, properties, (line) => lines.push(line)), lines };
  };

  it("exits 0 and prints one line per route for a live output", () => {
    const { code, lines } = run(built(140_000));
    expect({
      code,
      count: lines.filter((line) => line.startsWith("ok")).length,
      last: lines.at(-1),
    }).toEqual({
      code: 0,
      count: 3,
      last: `bundle-check: OK 3 routes under ${String(SCRIPT_BUDGET_BYTES)} gzip bytes`,
    });
  });

  it("exits 1 on an entry of 170 KB", () => {
    const { code, lines } = run(built(170_000));
    expect([code, lines.filter((line) => line.startsWith("FAIL")).length]).toEqual([1, 3]);
  });

  it("exits 1 when a property title of the seed is in any output file", () => {
    const output = built(1_000, `export const t = ${JSON.stringify(title)};`);
    const { code, lines } = run(output);
    expect([code, lines.filter((line) => line.startsWith("FAIL"))]).toEqual([
      1,
      [
        `FAIL ${join(output, "server", "ssr.mjs")} holds the seed title "${title}" of src/data/properties.ts`,
      ],
    ]);
  });

  it("is a command: exit 0 on a clean output, 1 on a seeded one, 2 on a stray flag", () => {
    const cli = (...args: string[]) =>
      spawnSync(process.execPath, ["scripts/bundle-check.mjs", ...args], {
        cwd: APP,
        encoding: "utf8",
      });
    const clean = cli(built(1_000));
    const seeded = cli(built(1_000, title));
    const flag = cli("--bogus");
    expect([clean.status, seeded.status, flag.status, flag.stdout.trim()]).toEqual([
      0,
      1,
      2,
      "usage: node scripts/bundle-check.mjs [.output]",
    ]);
  });
});

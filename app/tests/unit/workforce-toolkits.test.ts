// Role toolkits (operator, 2026-10-16; ruling H115): each colleague runs with exactly its toolkit's tools, as Claude
// Code permission rules; a run about outside text reads its own folder only, a run no person started reads only; a
// colleague's one command is the render wrapper, which starts bun from the app folder with a clean environment; the
// render scripts take a local spec whose photographs sit beside it.
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { colleagueLaunch, deskFor } from "../../scripts/workforce/daemon.ts";
import {
  anyCase,
  renderRoots,
  rulePath,
  toolkitRules,
  type ToolkitPaths,
} from "../../scripts/workforce/toolkit-args.ts";
import { renderPlan } from "../../scripts/workforce/render-run.mjs";
import { outsideToolkit, readOnly, toolkitFor, toolkitWords } from "../../src/domain/toolkits.ts";
import { confineRender } from "../../scripts/lib/confine.mjs";
import { localSpec } from "../../scripts/lib/shoot.mjs";

const made: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), name));
  made.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const paths: ToolkitPaths = {
  own: "C:/home/.mop-workforce/desks/social/work",
  studio: "C:/home/.mop-workforce/studio",
  knowledge: "C:/home/.mop-workforce/matter/knowledge",
  driveSocial: "G:/My Drive/Matter of Place/Social Media",
  app: "E:/mop-build/live/app",
};
const value = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1];
const settingsOf = (file: string) =>
  z
    .object({ permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }) })
    .parse(JSON.parse(readFileSync(file, "utf8"))).permissions;

/** A runner home with a Drive folder named in its config, as on the laptop. */
const homeWithDrive = () => {
  const home = temp("h115-home-");
  const drive = join(home, "drive", "Social Media");
  mkdirSync(drive, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ driveSocial: drive }));
  return { home, drive };
};

describe("H115: role toolkits", () => {
  it("names an absolute path the way a permission rule needs it", () => {
    expect([
      rulePath("G:/My Drive/Matter of Place/Social Media"),
      rulePath("E:\\mop-build\\live\\app\\"),
      rulePath("/home/runner/x"),
    ]).toEqual([
      "//g/My Drive/Matter of Place/Social Media",
      "//e/mop-build/live/app",
      "//home/runner/x",
    ]);
  });

  it("gives Social the render wrapper, its reads and its writes, and nothing that configures a run in any case", () => {
    const rules = toolkitRules(toolkitFor("social"), paths, false);
    expect(rules.tools).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
    // never bun or node on their own: one wrapper by its absolute path, one rule per renderer
    expect(rules.allow.filter((rule) => rule.startsWith("Bash("))).toEqual([
      "Bash(node E:/mop-build/live/app/scripts/workforce/render-run.mjs carousel:*)",
      "Bash(node E:/mop-build/live/app/scripts/workforce/render-run.mjs post:*)",
      "Bash(node E:/mop-build/live/app/scripts/workforce/render-run.mjs story:*)",
    ]);
    expect(rules.allow).toEqual(
      expect.arrayContaining([
        "Read(./**)",
        "Edit(./**)",
        "Edit(//g/My Drive/Matter of Place/Social Media/**)",
        "Read(//c/home/.mop-workforce/studio/**)",
      ]),
    );
    expect(anyCase("**/.env*")).toBe("**/.[eE][nN][vV]*");
    expect(rules.deny).toEqual(
      expect.arrayContaining([
        `Edit(./${anyCase("**/.claude/**")})`,
        `Edit(./${anyCase("**/bunfig.toml")})`,
        `Edit(//c/home/.mop-workforce/studio/${anyCase("**/.env*")})`,
        `Edit(//g/My Drive/Matter of Place/Social Media/${anyCase("**/package.json")})`,
        `Edit(//g/My Drive/Matter of Place/Social Media/${anyCase("**/tsconfig*.json")})`,
        `Edit(./${anyCase("**/.npmrc")})`,
        `Edit(./${anyCase("**/CLAUDE.md")})`,
        `Read(./${anyCase("**/.env*")})`,
      ]),
    );
    // every write place carries the whole list
    expect(rules.deny.filter((rule) => rule.includes(anyCase("bunfig.toml")))).toHaveLength(6);
    expect(rules.addDirs).toEqual([paths.studio, paths.knowledge, paths.driveSocial]);
  });

  it("holds every colleague's rules: tools, allow, deny and extra folders, and the base toolkit for anyone else", () => {
    const own = ".";
    const studio = "//c/home/.mop-workforce/studio";
    const knowledge = "//c/home/.mop-workforce/matter/knowledge";
    const drive = "//g/My Drive/Matter of Place/Social Media";
    // written out here, not imported: what no run may ever write
    const config = [
      "**/.claude/**",
      "**/CLAUDE.md",
      "**/CLAUDE.local.md",
      "**/.mcp.json",
      "**/bunfig.toml",
      "**/.bunfig.toml",
      "**/.env*",
      "**/package.json",
      "**/tsconfig*.json",
      "**/.npmrc",
    ];
    const wrapper = "Bash(node E:/mop-build/live/app/scripts/workforce/render-run.mjs";
    const row = (
      reads: string[],
      writes: string[],
      addDirs: (string | null)[],
      bash: string[] = [],
    ) => ({
      tools: ["Read", "Glob", "Grep", "Write", "Edit", ...(bash.length > 0 ? ["Bash"] : [])],
      allow: [
        ...reads.map((root) => `Read(${root}/**)`),
        ...writes.map((root) => `Edit(${root}/**)`),
        ...bash.map((name) => `${wrapper} ${name}:*)`),
      ],
      deny: [
        ...reads.flatMap((root) => [
          `Read(${root}/${anyCase("**/.env*")})`,
          `Read(${root}/${anyCase("**/*credentials*")})`,
        ]),
        ...writes.flatMap((root) => config.map((name) => `Edit(${root}/${anyCase(name)})`)),
      ],
      addDirs,
    });
    const reader = row([own, studio, knowledge], [own], [paths.studio, paths.knowledge]);
    const table: Record<string, ReturnType<typeof row>> = {
      editor: reader,
      newsletter: reader,
      campaigns: reader,
      chief: reader,
      // the Concierge and the Analyst never read the studio
      concierge: row([own, knowledge], [own], [paths.knowledge]),
      analyst: row([own, knowledge], [own], [paths.knowledge]),
      social: row(
        [own, studio, knowledge],
        [own, studio, drive],
        [paths.studio, paths.knowledge, paths.driveSocial],
        ["carousel", "post", "story"],
      ),
      "someone-new": row([own], [own], []),
    };
    for (const [slug, expected] of Object.entries(table)) {
      expect({ slug, ...toolkitRules(toolkitFor(slug), paths, false) }).toEqual({
        slug,
        ...expected,
      });
    }
  });

  it("gives the Editor no shell, a run about outside text its folder only, and research only where it is", () => {
    const editor = toolkitRules(toolkitFor("editor"), paths, false);
    expect(editor.tools).toEqual(["Read", "Glob", "Grep", "Write", "Edit"]);
    expect(editor.allow.some((rule) => rule.startsWith("Bash("))).toBe(false);
    const outside = toolkitRules(outsideToolkit, paths, false);
    expect([outside.tools, outside.allow, outside.addDirs]).toEqual([
      ["Read", "Glob", "Grep"],
      ["Read(./**)"],
      [],
    ]);
    expect(toolkitRules(toolkitFor("analyst"), paths, true).tools).toEqual([
      "Read",
      "Glob",
      "Grep",
      "Write",
      "Edit",
      "WebSearch",
    ]);
    // a colleague hired later gets the base toolkit, never another's, whatever its handle
    for (const slug of ["someone-new", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(toolkitFor(slug)).toEqual({ read: ["own_folder"], write: ["own_folder"], render: [] });
    }
    // the read-only form keeps the reads and drops every write and render
    expect(readOnly(toolkitFor("social"))).toEqual({
      read: ["own_folder", "studio", "knowledge"],
      write: [],
      render: [],
    });
  });

  it("gives render roots only to a toolkit that renders, even one that writes the studio and the Drive", () => {
    expect(
      renderRoots({ read: [], write: ["own_folder", "studio", "drive_social"], render: [] }, paths),
    ).toEqual([]);
    expect(renderRoots(toolkitFor("social"), paths)).toEqual([paths.studio, paths.driveSocial]);
  });

  it("launches a run a person started with the whole toolkit, its settings file named by the run id", () => {
    const { home, drive } = homeWithDrive();
    const social = colleagueLaunch(home, "social", "sonnet", false, {
      id: "run-1",
      outside: false,
      inside: true,
    });
    const work = join(home, "desks", "social", "work");
    expect(social.cwd).toBe(work);
    expect(social.settingsFile).toBe(join(home, "settings", "run-1.json"));
    expect(value(social.args, "--settings")).toBe(social.settingsFile);
    expect([
      value(social.args, "--setting-sources"),
      value(social.args, "--permission-mode"),
      value(social.args, "--tools"),
    ]).toEqual(["", "dontAsk", "Read,Glob,Grep,Write,Edit,Bash"]);
    expect(social.args).not.toContain("--restricted");
    expect(
      settingsOf(social.settingsFile).allow.filter((rule) => rule.startsWith("Bash(")),
    ).toHaveLength(3);
    expect(social.line).toContain("render-run.mjs carousel --spec <spec.json> --out <folder>");
    // the wrapper confines a render to the work folder and the write places the runner names
    expect(social.env).toEqual({
      MOP_RENDER_WORK: work,
      MOP_RENDER_OUT_ROOTS: [join(home, "studio"), drive].join(delimiter),
      // a render runs in the foreground of the run, not past the CLI's two-minute default
      BASH_DEFAULT_TIMEOUT_MS: "600000",
    });
  });

  it("launches a run no person started with the toolkit's reads only, and one about outside text with its folder only", () => {
    const { home } = homeWithDrive();
    const event = colleagueLaunch(home, "social", "sonnet", false, {
      id: "run-2",
      outside: false,
      inside: false,
    });
    expect(value(event.args, "--tools")).toBe("Read,Glob,Grep");
    expect(settingsOf(event.settingsFile).allow.some((rule) => /^(Bash|Edit)\(/.test(rule))).toBe(
      false,
    );
    expect(event.env).toEqual({});
    expect(event.line).toContain("you write nothing");
    // a draft another run left in the work folder, and what an earlier attempt of the outside run left in its own
    const work = deskFor(home, "concierge");
    writeFileSync(join(work, "draft.md"), "a reply with a buyer's details");
    const own = join(home, "desks", "concierge", "outside", "run-3");
    mkdirSync(own, { recursive: true });
    writeFileSync(join(own, "left.md"), "x");
    const outside = colleagueLaunch(home, "concierge", "sonnet", true, {
      id: "run-3",
      outside: true,
      inside: true,
      line: "@concierge 2400-azure-pl",
    });
    // its own folder, made empty for this run and removed after it; never the work folder
    expect(outside.cwd).toBe(own);
    expect(readdirSync(own)).toEqual([]);
    expect(outside.cleanup).toEqual([outside.settingsFile, own]);
    expect(value(outside.args, "--tools")).toBe("Read,Glob,Grep");
    expect(outside.args).not.toContain("--add-dir");
    expect(settingsOf(outside.settingsFile).allow).toEqual(["Read(./**)"]);
    expect(outside.env).toEqual({});
    expect(event.cleanup).toEqual([event.settingsFile]);
  });

  it("refuses a toolkit that writes the Drive when the runner's config names no Drive folder", () => {
    const home = temp("h115-nodrive-");
    expect(() =>
      colleagueLaunch(home, "social", "sonnet", false, { id: "r", outside: false, inside: true }),
    ).toThrow("sets no driveSocial");
    // a run that writes nothing there still starts
    expect(
      colleagueLaunch(home, "social", "sonnet", false, { id: "r", outside: false, inside: false })
        .cwd,
    ).toBe(join(home, "desks", "social", "work"));
  });

  it("sweeps what configures bun, node or a run out of every place the run may write, in any case", () => {
    const { home, drive } = homeWithDrive();
    const studio = join(home, "studio");
    const work = deskFor(home, "social");
    const planted = [
      join(work, "bunfig.toml"),
      join(work, "nested", "BunFig.TOML"),
      join(work, ".ENV.local"),
      join(work, "Package.json"),
      join(work, "tsconfig.build.json"),
      join(work, ".npmrc"),
      join(studio, "piece", ".env"),
      join(studio, ".bunfig.toml"),
    ];
    for (const file of planted) {
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, "x");
    }
    mkdirSync(join(drive, "Carousels"));
    writeFileSync(join(drive, "Carousels", "slide-1.jpg"), "x");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    colleagueLaunch(home, "social", "sonnet", false, { id: "r", outside: false, inside: true });
    expect(planted.filter((file) => existsSync(file))).toEqual([]);
    expect(existsSync(join(drive, "Carousels", "slide-1.jpg"))).toBe(true);
    // each removal is said in the runner's log, by its path
    const said = log.mock.calls.map((call) => String(call[0])).join("\n");
    log.mockRestore();
    for (const file of [join(studio, "piece", ".env"), join(work, ".npmrc")])
      expect(said).toContain(`removed ${file} before a run`);
  });

  it("refuses a run while the operator's Drive folder holds run config, names each file and deletes none", () => {
    const { home, drive } = homeWithDrive();
    const planted = [
      join(drive, "Carousels", "BunFig.toml"),
      join(drive, ".Claude", "settings.json"),
    ];
    for (const file of planted) {
      mkdirSync(resolve(file, ".."), { recursive: true });
      writeFileSync(file, "x");
    }
    const launch = () =>
      colleagueLaunch(home, "social", "sonnet", false, { id: "r", outside: false, inside: true });
    expect(launch).toThrow(join(drive, "Carousels", "BunFig.toml"));
    expect(launch).toThrow(join(drive, ".Claude"));
    expect(planted.filter((file) => existsSync(file))).toEqual(planted);
    // no settings file is left behind by a refused run
    expect(existsSync(join(home, "settings", "r.json"))).toBe(false);
    // a run that writes nothing there still starts
    expect(
      colleagueLaunch(home, "social", "sonnet", false, { id: "r", outside: false, inside: false })
        .cwd,
    ).toBe(join(home, "desks", "social", "work"));
  });

  it("places the photographs of the pieces a person's line names beside where a spec goes, and nothing else", () => {
    const { home, drive } = homeWithDrive();
    const studio = join(home, "studio");
    const piece = join(studio, "4a3c2563-c07a-481d-839b-ad0523827f69");
    const elsewhere = temp("h115-place-else-");
    mkdirSync(join(piece, "photos"), { recursive: true });
    copyFileSync("src/assets/los-altos.jpg", join(piece, "photos", "a.jpg"));
    writeFileSync(join(piece, "brief.md"), "not a photograph");
    writeFileSync(join(piece, "big.jpg"), "");
    truncateSync(join(piece, "big.jpg"), 25 * 1024 * 1024 + 1);
    writeFileSync(join(elsewhere, "secret.jpg"), "x");
    symlinkSync(elsewhere, join(piece, "door"), "junction");
    mkdirSync(join(studio, "other-piece"));
    writeFileSync(join(studio, "other-piece", "c.jpg"), "x");
    mkdirSync(join(drive, "Carousels", "2400 Azure Pl, Fairfield (TEST)"), { recursive: true });
    writeFileSync(join(drive, "Carousels", "2400 Azure Pl, Fairfield (TEST)", "slide-1.jpg"), "x");
    const work = join(home, "desks", "social", "work");
    const line =
      "@social pick and render 4a3c2563-c07a-481d-839b-ad0523827f69, the drafts in 2400 azure pl, fairfield (test)";

    // a run no person started places nothing
    colleagueLaunch(home, "social", "sonnet", false, {
      id: "e",
      outside: false,
      inside: false,
      line,
    });
    expect(existsSync(join(work, "4a3c2563-c07a-481d-839b-ad0523827f69"))).toBe(false);

    // a link a run left where a copy goes is removed, not followed
    mkdirSync(work, { recursive: true });
    symlinkSync(elsewhere, join(work, "4a3c2563-c07a-481d-839b-ad0523827f69"), "junction");
    const launch = colleagueLaunch(home, "social", "sonnet", false, {
      id: "p",
      outside: false,
      inside: true,
      line,
    });
    const placed = join(work, "4a3c2563-c07a-481d-839b-ad0523827f69");
    expect(readdirSync(placed, { recursive: true }).map(String).sort()).toEqual([
      "photos",
      join("photos", "a.jpg"),
    ]);
    expect(readdirSync(elsewhere)).toEqual(["secret.jpg"]);
    expect(
      existsSync(join(work, "2400 Azure Pl, Fairfield (TEST)", "Carousels", "slide-1.jpg")),
    ).toBe(true);
    expect(existsSync(join(work, "other-piece"))).toBe(false);
    expect(launch.line).toContain(
      "The runner placed 1 photograph of 4a3c2563-c07a-481d-839b-ad0523827f69 in `./4a3c2563-c07a-481d-839b-ad0523827f69/` (1 left out",
    );
    // a hard link a run left where a copy goes is replaced by a new file, never written through into its other name
    rmSync(join(placed, "photos", "a.jpg"));
    linkSync(join(elsewhere, "secret.jpg"), join(placed, "photos", "a.jpg"));
    colleagueLaunch(home, "social", "sonnet", false, {
      id: "q",
      outside: false,
      inside: true,
      line,
    });
    expect(readFileSync(join(elsewhere, "secret.jpg"), "utf8")).toBe("x");
    expect(readFileSync(join(placed, "photos", "a.jpg"))).toEqual(
      readFileSync(join(piece, "photos", "a.jpg")),
    );
    // a toolkit that does not render is placed nothing, even on a person's line
    colleagueLaunch(home, "editor", "sonnet", false, {
      id: "x",
      outside: false,
      inside: true,
      line,
    });
    expect(existsSync(join(home, "desks", "editor", "work", "other-piece"))).toBe(false);
    expect(readdirSync(join(home, "desks", "editor", "work"))).toEqual([]);
  });

  it("says in words what each colleague may do, for the Office", () => {
    expect(toolkitWords(toolkitFor("social"), ["read_business", "chat"])).toEqual([
      "Reads its own folder (the material it was woken for, and its drafts); the studio (every piece of work, its brief and drafts); the team's knowledge notes.",
      "Writes its own folder (the material it was woken for, and its drafts); the studio (every piece of work, its brief and drafts); Google Drive, Social Media (Carousels, Posts, Reels).",
      "Renders a carousel, a single post and a story, from a local spec.",
      "Writes and renders only on work a person started; otherwise it only reads.",
      "Other commands only as simple reads and writes inside its places (such as ls, cat, grep); no keys, nothing sent outside the company without a person's approval.",
    ]);
    expect(toolkitWords(toolkitFor("analyst"), ["research"])).toContain("Searches the web.");
    // a colleague with no shell runs no command at all
    expect(toolkitWords(toolkitFor("editor"), []).at(-1)).toBe(
      "No command, no keys, nothing sent outside the company without a person's approval.",
    );
  });

  it("confines a render: the spec inside the work folder, the output inside it or a folder the runner named", () => {
    const work = temp("h115-work-");
    const drive = temp("h115-drive-");
    const elsewhere = temp("h115-else-");
    const spec = join(work, "spec.json");
    expect(() => confineRender(spec, join(work, "renders"), work, undefined)).not.toThrow();
    expect(() => confineRender(spec, join(drive, "Posts", "x"), work, drive)).not.toThrow();
    expect(() => confineRender(spec, join(elsewhere, "out"), work, drive)).toThrow(
      "the output folder must be inside",
    );
    expect(() => confineRender(spec, join(work, "..", "up"), work, undefined)).toThrow(
      "the output folder must be inside",
    );
    expect(() =>
      confineRender(join(elsewhere, "spec.json"), join(work, "renders"), work, drive),
    ).toThrow("the spec must be inside your work folder");
    // no work folder named (a render started without the runner) is refused, never the current folder
    expect(() => confineRender("spec.json", "out", "", undefined)).toThrow("named no work folder");
    // a junction inside the work folder that leads out is not a way out
    symlinkSync(elsewhere, join(work, "door"), "junction");
    expect(() => confineRender(spec, join(work, "door", "out"), work, undefined)).toThrow(
      "the output folder must be inside",
    );
    expect(() =>
      confineRender(join(work, "door", "spec.json"), join(work, "renders"), work, undefined),
    ).toThrow("the spec must be inside your work folder");
  });

  it("renders only photographs that sit beside the spec, links resolved, at most 25 MB, and reads their size", async () => {
    const dir = temp("h115-spec-");
    const elsewhere = temp("h115-photo-");
    mkdirSync(join(dir, "photos"));
    copyFileSync("src/assets/los-altos.jpg", join(dir, "photos", "a.jpg"));
    copyFileSync("src/assets/los-altos.jpg", join(elsewhere, "b.jpg"));
    const property = {
      id: "p1",
      slug: "p",
      title: "T",
      city: "C",
      state: "California",
      market: "california",
      price: 1,
      currency: "USD",
      beds: 1,
      baths: 1,
      interiorSqFt: 1,
      yearBuilt: 2000,
      type: "Residence",
    };
    const write = (name: string, path: string) => {
      writeFileSync(
        join(dir, name),
        JSON.stringify({ property, images: [{ path, alt: "a", orientation: "landscape" }] }),
      );
      return join(dir, name);
    };
    const spec = z
      .object({ images: z.array(z.object({ url: z.string(), w: z.number(), h: z.number() })) })
      .parse(await localSpec("carousel", write("ok.json", "photos/a.jpg")));
    expect(spec.images[0]?.w).toBeGreaterThan(0);
    await expect(localSpec("carousel", write("up.json", "../a.jpg"))).rejects.toThrow(
      "is not inside the spec's folder",
    );
    // a junction beside the spec that leads to a photograph elsewhere is refused
    symlinkSync(elsewhere, join(dir, "door"), "junction");
    await expect(localSpec("carousel", write("door.json", "door/b.jpg"))).rejects.toThrow(
      "is not inside the spec's folder",
    );
    writeFileSync(join(dir, "notes.txt"), "x");
    await expect(localSpec("carousel", write("text.json", "notes.txt"))).rejects.toThrow(
      "is not a photograph",
    );
    writeFileSync(join(dir, "huge.jpg"), "");
    truncateSync(join(dir, "huge.jpg"), 25 * 1024 * 1024 + 1);
    await expect(localSpec("carousel", write("huge.json", "huge.jpg"))).rejects.toThrow(
      "is larger than 25 MB",
    );
  });
});

describe("H115, review of 2026-10-16: the render wrapper", () => {
  /** A runner's environment as a colleague's shell inherits it, with what must never reach bun. */
  const setup = () => {
    const app = temp("h115-app-");
    const bin = join(app, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "bun.exe"), "");
    writeFileSync(join(bin, "bun"), "");
    const work = temp("h115-wrap-work-");
    const drive = temp("h115-wrap-drive-");
    mkdirSync(join(work, "spec"));
    // a bun planted in a write place, on the PATH ahead of the real one
    writeFileSync(join(work, "bun.exe"), "");
    writeFileSync(join(work, "bun"), "");
    const env = {
      PATH: [work, "relative/bin", bin].join(delimiter),
      SYSTEMROOT: "C:/Windows",
      TEMP: "C:/Temp",
      NODE_OPTIONS: "--require=./x.js",
      BUN_OPTIONS: "--preload=./x.ts",
      BUN_CONFIG_REGISTRY: "https://example.com",
      CHROME_PATH: "C:/evil.exe",
      SUPABASE_SERVICE_ROLE_KEY: "decoy",
      MOP_RENDER_WORK: work,
      MOP_RENDER_OUT_ROOTS: drive,
    };
    return { app, bin, work, drive, env };
  };

  it("starts bun by its path from the app folder with the app's config, no .env, no install and a clean environment", () => {
    const { app, bin, work, drive, env } = setup();
    const plan = renderPlan(
      ["carousel", "--spec", "./spec/spec.json", "--out", join(drive, "Carousels")],
      work,
      env,
      app,
    );
    expect(plan.cwd).toBe(app);
    expect([join(bin, "bun.exe"), join(bin, "bun")]).toContain(plan.command);
    expect(plan.args).toEqual([
      `--config=${join(app, "bunfig.toml")}`,
      "--no-env-file",
      "--no-install",
      join(app, "scripts", "render-carousel.mjs"),
      "--spec",
      join(work, "spec", "spec.json"),
      "--out",
      join(drive, "Carousels"),
    ]);
    expect(plan.env).toEqual({
      PATH: bin,
      SYSTEMROOT: "C:/Windows",
      TEMP: "C:/Temp",
      MOP_RENDER_WORK: work,
      MOP_RENDER_OUT_ROOTS: drive,
    });
  });

  it("refuses anything but a named renderer, a spec in the work folder and an output in a write place", () => {
    const { app, work, env } = setup();
    const outside = temp("h115-wrap-else-");
    const plan =
      (argv: string[], over: Record<string, string> = {}) =>
      () =>
        renderPlan(argv, work, { ...env, ...over }, app);
    const spec = ["--spec", "./spec/spec.json", "--out", "./renders"];
    expect(plan(["constructor", ...spec])).toThrow("name one of carousel, post or story");
    expect(plan(["carousel", "post", ...spec])).toThrow("name one of carousel, post or story");
    expect(plan(["carousel", "--spec", "./spec/spec.json"])).toThrow("run it as");
    expect(plan(["carousel", ...spec, "--preload", "./x.ts"])).toThrow("Unknown option");
    expect(plan(["carousel", "--spec", join(outside, "s.json"), "--out", "./r"])).toThrow(
      "the spec must be inside your work folder",
    );
    expect(plan(["carousel", "--spec", "./s.json", "--out", outside])).toThrow(
      "the output folder must be inside",
    );
    expect(plan(["carousel", ...spec], { MOP_RENDER_WORK: "" })).toThrow("named no work folder");
    // with only a planted bun on the PATH, none is found
    expect(plan(["carousel", ...spec], { PATH: work })).toThrow("bun is not on the runner's PATH");
    expect(renderPlan(["story", ...spec], work, env, app).args[3]).toBe(
      join(app, "scripts", "render-story.mjs"),
    );
  });
});

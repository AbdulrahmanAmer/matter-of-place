// Role toolkits (operator, 2026-10-16; ruling H115): each colleague runs with exactly its toolkit's tools, as Claude
// Code permission rules; a run about outside text reads its own folder only, a run no person started reads only; no
// colleague has a shell or reaches the studio (review of 2026-10-19): the runner places a named piece's photographs in
// its folder and renders what its answer asks for, through the wrapper's checks, with bun started from the app folder
// in a clean environment; the render scripts take a local spec whose photographs sit beside it.
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
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import { colleagueLaunch, deskFor } from "../../scripts/workforce/daemon.ts";
import {
  anyCase,
  renderRoots,
  rulePath,
  runRenders,
  toolkitRules,
  writePlaces,
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

  it("gives Social no shell, its reads and its writes, and nothing that configures a run in any case", () => {
    const rules = toolkitRules(toolkitFor("social"), paths, false);
    expect(rules.tools).toEqual(["Read", "Glob", "Grep", "Write", "Edit"]);
    expect(rules.allow.some((rule) => rule.startsWith("Bash("))).toBe(false);
    expect(rules.allow).toEqual(
      expect.arrayContaining([
        "Read(./**)",
        "Edit(./**)",
        "Edit(//g/My Drive/Matter of Place/Social Media/**)",
      ]),
    );
    expect(anyCase("**/.env*")).toBe("**/.[eE][nN][vV]*");
    expect(rules.deny).toEqual(
      expect.arrayContaining([
        `Edit(./${anyCase("**/.claude/**")})`,
        `Edit(./${anyCase("**/bunfig.toml")})`,
        `Edit(//g/My Drive/Matter of Place/Social Media/${anyCase("**/package.json")})`,
        `Edit(//g/My Drive/Matter of Place/Social Media/${anyCase("**/tsconfig*.json")})`,
        `Edit(./${anyCase("**/.npmrc")})`,
        `Edit(./${anyCase("**/CLAUDE.md")})`,
        `Read(./${anyCase("**/.env*")})`,
      ]),
    );
    // every write place carries the whole list
    expect(rules.deny.filter((rule) => rule.includes(anyCase("bunfig.toml")))).toHaveLength(4);
    expect(rules.addDirs).toEqual([paths.knowledge, paths.driveSocial]);
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
    const row = (reads: string[], writes: string[], addDirs: (string | null)[]) => ({
      tools: ["Read", "Glob", "Grep", "Write", "Edit"],
      allow: [
        ...reads.map((root) => `Read(${root}/**)`),
        ...writes.map((root) => `Edit(${root}/**)`),
      ],
      deny: [
        ...reads.flatMap((root) => [
          `Read(${root}/${anyCase("**/.env*")})`,
          `Read(${root}/${anyCase("**/*credentials*")})`,
        ]),
        ...writes.flatMap((root) => config.map((name) => `Edit(${root}/${anyCase(name)})`)),
        // no run reads or writes the studio (review of 2026-10-19)
        `Read(${studio}/**)`,
        `Edit(${studio}/**)`,
      ],
      addDirs,
    });
    // the readers see a studio piece only as the photographs the runner places in their folder
    const reader = row([own, knowledge], [own], [paths.knowledge]);
    const table: Record<string, ReturnType<typeof row>> = {
      editor: reader,
      newsletter: reader,
      campaigns: reader,
      chief: reader,
      // the Concierge and the Analyst never read the studio
      concierge: row([own, knowledge], [own], [paths.knowledge]),
      analyst: row([own, knowledge], [own], [paths.knowledge]),
      social: row([own, knowledge], [own, drive], [paths.knowledge, paths.driveSocial]),
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
      expect(toolkitFor(slug)).toEqual({
        read: ["own_folder"],
        write: ["own_folder"],
        render: [],
        pieces: [],
      });
    }
    // the read-only form keeps the reads and drops every write, render and placement
    expect(readOnly(toolkitFor("social"))).toEqual({
      read: ["own_folder", "knowledge"],
      write: [],
      render: [],
      pieces: [],
    });
  });

  it("lets no run of any colleague read or write the studio, write the knowledge notes or hold a shell", () => {
    const slugs = ["editor", "concierge", "social", "newsletter", "campaigns", "analyst", "chief"];
    const kits = [
      outsideToolkit,
      ...[...slugs, "someone-new"].flatMap((slug) => [
        toolkitFor(slug),
        readOnly(toolkitFor(slug)),
      ]),
    ];
    const studio = rulePath(paths.studio);
    for (const kit of kits) {
      for (const research of [false, true]) {
        const rules = toolkitRules(kit, paths, research);
        expect(rules.tools).not.toContain("Bash");
        expect(
          rules.allow.filter((rule) => rule.includes(studio) || rule.startsWith("Bash(")),
        ).toEqual([]);
        expect(rules.addDirs).not.toContain(paths.studio);
        expect(rules.deny).toEqual(
          expect.arrayContaining([`Read(${studio}/**)`, `Edit(${studio}/**)`]),
        );
      }
      // what the runner later reads as a prompt, runs or loads is never a place a run writes or renders into
      for (const dir of [...writePlaces(kit, paths), ...renderRoots(kit, paths)])
        expect([paths.studio, paths.knowledge]).not.toContain(dir);
    }
  });

  it("gives render roots only to a toolkit that renders, even one that writes the Drive", () => {
    expect(
      renderRoots(
        { read: [], write: ["own_folder", "drive_social"], render: [], pieces: [] },
        paths,
      ),
    ).toEqual([]);
    expect(renderRoots(toolkitFor("social"), paths)).toEqual([paths.driveSocial]);
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
    ]).toEqual(["", "dontAsk", "Read,Glob,Grep,Write,Edit"]);
    expect(social.args).not.toContain("--restricted");
    expect(social.args).not.toContain(join(home, "studio"));
    expect(settingsOf(social.settingsFile).allow.some((rule) => rule.startsWith("Bash("))).toBe(
      false,
    );
    // it asks the runner for a render in its answer, and is told where an output may go
    expect(social.line).toContain('add to your JSON a "renders" list');
    expect(social.line).toContain(`"out": "a folder in your folder or ${drive}"`);
    expect(social.line).toContain("You run no command");
    // what the runner renders for it after the run: its renderers, its folder, the Drive
    expect(social.render).toEqual({
      allowed: ["carousel", "post", "story"],
      work,
      roots: [drive],
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
    expect(event.render.allowed).toEqual([]);
    expect(event.line).toContain("you write nothing");
    expect(event.line).not.toContain("renders");
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
    expect(outside.render.allowed).toEqual([]);
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
    const work = deskFor(home, "social");
    const planted = [
      join(work, "bunfig.toml"),
      join(work, "nested", "BunFig.TOML"),
      join(work, ".ENV.local"),
      join(work, "Package.json"),
      join(work, "tsconfig.build.json"),
      join(work, ".npmrc"),
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
    for (const file of [join(work, "nested", "BunFig.TOML"), join(work, ".npmrc")])
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

  // 19.4 s measured on the laptop while it rendered (a 25 MB sparse file, six launches): its own limit (G-031, P-3450)
  it("places the photographs of the pieces a person's line names beside where a spec goes, and nothing else", () => {
    const { home, drive } = homeWithDrive();
    const studio = join(home, "studio");
    const piece = join(studio, "4a3c2563-c07a-481d-839b-ad0523827f69");
    const elsewhere = temp("h115-place-else-");
    mkdirSync(join(piece, "photos"), { recursive: true });
    copyFileSync("src/assets/los-altos.jpg", join(piece, "photos", "a.jpg"));
    writeFileSync(join(piece, "brief.md"), "not a photograph");
    // the links a submitter typed (pull-images.ts): never placed, never read by a run
    writeFileSync(join(piece, "sources.json"), '[{"url": "https://example.com/typed"}]');
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
    // a reader is placed the studio's photographs only, never the Drive's
    colleagueLaunch(home, "editor", "sonnet", false, {
      id: "x",
      outside: false,
      inside: true,
      line,
    });
    expect(readdirSync(join(home, "desks", "editor", "work"))).toEqual([
      "4a3c2563-c07a-481d-839b-ad0523827f69",
    ]);
    // a toolkit with no piece source is placed nothing, even on a person's line
    colleagueLaunch(home, "concierge", "sonnet", false, {
      id: "y",
      outside: false,
      inside: true,
      line,
    });
    expect(readdirSync(join(home, "desks", "concierge", "work"))).toEqual([]);
  }, 60_000);

  it("says in words what each colleague may do, for the Office", () => {
    expect(toolkitWords(toolkitFor("social"), ["read_business", "chat"])).toEqual([
      "Reads its own folder (the material it was woken for, and its drafts); the team's knowledge notes.",
      "Gets the photographs of a piece a person names, from the studio and Google Drive, Social Media, in its own folder.",
      "Writes its own folder (the material it was woken for, and its drafts); Google Drive, Social Media (Carousels, Posts, Reels).",
      "Has the runner render a carousel, a single post and a story, from a spec in its folder.",
      "Writes and renders only on work a person started; otherwise it only reads.",
      "No command, no keys, nothing sent outside the company without a person's approval.",
    ]);
    expect(toolkitWords(toolkitFor("analyst"), ["research"])).toContain("Searches the web.");
    expect(toolkitWords(toolkitFor("editor"), [])).toContain(
      "Gets the photographs of a piece a person names, from the studio, in its own folder.",
    );
    expect(toolkitWords(toolkitFor("concierge"), []).join(" ")).not.toContain("photographs");
    expect(toolkitWords(toolkitFor("editor"), []).join(" ")).not.toContain("Has the runner render");
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

describe("H115, review of 2026-10-19: the runner renders what a colleague's answer asks for", () => {
  const scope = () => {
    const work = temp("h115-renders-work-");
    const drive = temp("h115-renders-drive-");
    const bin = temp("h115-renders-bin-");
    writeFileSync(join(bin, "bun.exe"), "");
    writeFileSync(join(bin, "bun"), "");
    mkdirSync(join(work, "spec"));
    const env = { PATH: bin, SYSTEMROOT: "C:/Windows", SUPABASE_SERVICE_ROLE_KEY: "decoy" };
    return { work, drive, bin, env };
  };
  /** A spawn that records each call and answers as a render would. */
  const ok = (stdout: string, status = 0, stderr = "") => {
    const calls: { command: string; args: string[]; env: NodeJS.ProcessEnv | undefined }[] = [];
    const spawn = (command: string, args: string[], options: { env?: NodeJS.ProcessEnv }) => {
      calls.push({ command, args, env: options.env });
      return { pid: 1, output: [], stdout, stderr, status, signal: null };
    };
    return Object.assign(spawn, { calls });
  };

  it("runs a named renderer through the wrapper's plan: bun from the app folder, a clean environment, no key", () => {
    const { work, drive, bin, env } = scope();
    const spawn = ok("slide-0 1080x1350 ok\nslide-1 1080x1350 ok\n");
    const lines = runRenders(
      [{ renderer: "carousel", spec: "./spec/spec.json", out: join(drive, "Carousels", "x") }],
      { allowed: ["carousel", "post", "story"], work, roots: [drive] },
      env,
      spawn,
    );
    expect(lines).toEqual([
      `Rendered a carousel from ./spec/spec.json into ${join(drive, "Carousels", "x")}: 2 files.`,
    ]);
    expect(spawn.calls).toHaveLength(1);
    const [first] = spawn.calls;
    const args = first?.args ?? [];
    expect([join(bin, "bun.exe"), join(bin, "bun")]).toContain(first?.command);
    expect(args).toContain("--no-env-file");
    expect(args.slice(-4)).toEqual([
      "--spec",
      join(work, "spec", "spec.json"),
      "--out",
      join(drive, "Carousels", "x"),
    ]);
    expect(first?.env).toEqual({
      PATH: bin,
      SYSTEMROOT: "C:/Windows",
      MOP_RENDER_WORK: work,
      MOP_RENDER_OUT_ROOTS: drive,
    });
  });

  it("refuses what the run may not render, a spec outside its folder and an output outside its places, and says a failure", () => {
    const { work, drive, env } = scope();
    const outside = temp("h115-renders-else-");
    const spawn = ok("");
    // a run with no renderer is told once, without its words
    expect(
      runRenders(
        [{ renderer: "carousel", spec: "./s.json", out: "./o" }],
        { allowed: [], work, roots: [] },
        env,
        spawn,
      ),
    ).toEqual(["Not rendered: this run may not render."]);
    expect(runRenders([], { allowed: [], work, roots: [] }, env, spawn)).toEqual([]);
    const lines = runRenders(
      [
        { renderer: "story", spec: "./spec/spec.json", out: "./r" },
        { renderer: "carousel", spec: join(outside, "spec.json"), out: "./r" },
        { renderer: "carousel", spec: "./spec/spec.json", out: outside },
      ],
      { allowed: ["carousel"], work, roots: [drive] },
      env,
      spawn,
    );
    expect(lines[0]).toBe("Not rendered: a story is not in this run's toolkit.");
    expect(lines[1]).toContain("the spec must be inside your work folder");
    expect(lines[2]).toContain("the output folder must be inside");
    expect(spawn.calls).toEqual([]);
    const failed = runRenders(
      [{ renderer: "carousel", spec: "./spec/spec.json", out: "./r" }],
      { allowed: ["carousel"], work, roots: [drive] },
      env,
      ok("", 1, "slide-0: no photograph\n"),
    );
    expect(failed).toEqual([
      "The render of a carousel from ./spec/spec.json failed (exit 1: slide-0: no photograph).",
    ]);
  });

  it("reads a colleague's renders from its answer, and keeps the answer when the list is malformed", () => {
    const asked = readJsonAnswer(
      JSON.stringify({
        reply: "Done.",
        renders: [{ renderer: "post", spec: "./a/spec.json", out: "./out" }],
      }),
    );
    expect(asked.renders).toEqual([{ renderer: "post", spec: "./a/spec.json", out: "./out" }]);
    const malformed = readJsonAnswer(
      JSON.stringify({ reply: "Done.", renders: [{ renderer: "bun", spec: "x", out: "y" }] }),
    );
    expect([malformed.reply, malformed.renders]).toEqual(["Done.", undefined]);
  });
});

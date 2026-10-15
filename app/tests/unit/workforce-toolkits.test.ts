// Role toolkits (operator, 2026-10-16; ruling H115): each colleague runs with exactly its toolkit's tools, as Claude
// Code permission rules; a run about outside text reads its own folder only; the render scripts take a local spec whose
// photographs sit beside it.
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { colleagueLaunch } from "../../scripts/workforce/daemon.ts";
import { rulePath, toolkitRules, type ToolkitPaths } from "../../scripts/workforce/toolkit-args.ts";
import { outsideToolkit, toolkitFor, toolkitWords } from "../../src/domain/toolkits.ts";
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
const settingsOf = (args: readonly string[]) =>
  z
    .object({ permissions: z.object({ allow: z.array(z.string()), deny: z.array(z.string()) }) })
    .parse(JSON.parse(readFileSync(value(args, "--settings") ?? "", "utf8"))).permissions;

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

  it("gives Social its renderers, its reads and its writes, and nothing that configures a run", () => {
    const rules = toolkitRules(toolkitFor("social"), paths, false);
    expect(rules.tools).toEqual(["Read", "Glob", "Grep", "Write", "Edit", "Bash"]);
    expect(rules.allow.filter((rule) => rule.startsWith("Bash("))).toEqual([
      "Bash(bun E:/mop-build/live/app/scripts/render-carousel.mjs --spec:*)",
      "Bash(bun E:/mop-build/live/app/scripts/render-cover.mjs --spec:*)",
      "Bash(bun E:/mop-build/live/app/scripts/render-story.mjs --spec:*)",
    ]);
    expect(rules.allow).toEqual(
      expect.arrayContaining([
        "Read(./**)",
        "Edit(./**)",
        "Edit(//g/My Drive/Matter of Place/Social Media/**)",
        "Read(//c/home/.mop-workforce/studio/**)",
      ]),
    );
    expect(rules.deny).toEqual(
      expect.arrayContaining([
        "Edit(./**/.claude/**)",
        "Edit(//g/My Drive/Matter of Place/Social Media/**/CLAUDE.md)",
        "Read(./**/.env*)",
      ]),
    );
    expect(rules.addDirs).toEqual([paths.studio, paths.knowledge, paths.driveSocial]);
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
    // a colleague hired later gets the base toolkit, never another's
    expect(toolkitFor("someone-new")).toEqual({
      read: ["own_folder"],
      write: ["own_folder"],
      render: [],
    });
  });

  it("launches every run in its work folder with its toolkit's rules in its own settings file", () => {
    const home = temp("h115-launch-");
    const social = colleagueLaunch(home, "social", "sonnet", false, false);
    const outside = colleagueLaunch(home, "concierge", "sonnet", true, true);
    expect([social.cwd, outside.cwd]).toEqual([
      join(home, "desks", "social", "work"),
      join(home, "desks", "concierge", "work"),
    ]);
    for (const launch of [social, outside]) {
      expect([
        value(launch.args, "--setting-sources"),
        value(launch.args, "--permission-mode"),
      ]).toEqual(["", "dontAsk"]);
      expect(launch.args).not.toContain("--restricted");
    }
    expect(value(outside.args, "--tools")).toBe("Read,Glob,Grep");
    expect(settingsOf(outside.args).allow).toEqual(["Read(./**)"]);
    expect(settingsOf(social.args).allow.filter((rule) => rule.startsWith("Bash("))).toHaveLength(
      3,
    );
    expect(social.line).toContain("--spec <spec.json> --out <folder>");
    expect(outside.line).toContain("you write nothing");
  });

  it("says in words what each colleague may do, for the Office", () => {
    expect(toolkitWords(toolkitFor("social"), ["read_business", "chat"])).toEqual([
      "Reads its own folder (the material it was woken for, and its drafts); the studio (every piece of work, its brief and drafts); the team's knowledge notes.",
      "Writes its own folder (the material it was woken for, and its drafts); the studio (every piece of work, its brief and drafts); Google Drive, Social Media (Carousels, Posts, Reels).",
      "Runs renders a carousel, renders a single post, renders a story, from a local spec.",
      "No other command, no keys, nothing sent outside the company without a person's approval.",
    ]);
  });

  it("renders only photographs that sit beside the spec, and reads their size from the file", async () => {
    const dir = temp("h115-spec-");
    mkdirSync(join(dir, "photos"));
    copyFileSync("src/assets/los-altos.jpg", join(dir, "photos", "a.jpg"));
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
    writeFileSync(join(dir, "notes.txt"), "x");
    await expect(localSpec("carousel", write("text.json", "notes.txt"))).rejects.toThrow(
      "is not a photograph",
    );
  });
});

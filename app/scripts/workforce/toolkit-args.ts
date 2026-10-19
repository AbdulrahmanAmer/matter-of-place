// Role toolkits, the runner's side (ruling H115): a colleague's toolkit (`src/domain/toolkits.ts`) becomes the Claude
// Code permission rules of one run. Measured on the real CLI under `--permission-mode dontAsk` (GOTCHAS P-4511): a rule
// names an absolute Windows path as `//e/...` (lower-case drive letter, no colon) and `--add-dir` lets the run reach a
// named folder. A colleague runs no command at all (review of 2026-10-19: on the real CLI, deny rules never stopped a
// read-only command's redirect); the runner renders what its answer asks for (`runRenders`).
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
  type SpawnSyncReturns,
} from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderers,
  series,
  type Place,
  type Renderer,
  type Toolkit,
} from "../../src/domain/toolkits.ts";
import { renderPlan } from "./render-run.mjs";

/** The checkout this runner runs from (`app/`): where the render scripts live. Node and Bun both know `import.meta.url`. */
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface ToolkitPaths {
  /** The run's own folder (`desks/<slug>/work`), its working directory. */
  own: string;
  /** The studio: never read or written by a colleague, only the source of a named piece's photographs. */
  studio: string;
  knowledge: string;
  /** The Google Drive Social Media folder from the runner's config, or null when the laptop names none. */
  driveSocial: string | null;
}

export interface ToolkitRules {
  tools: string[];
  allow: string[];
  deny: string[];
  addDirs: string[];
}

/** An absolute path as a permission rule names it: `E:\a\b` is `//e/a/b`, `/home/x` is `//home/x`. */
export function rulePath(path: string): string {
  const unix = path.replaceAll("\\", "/").replace(/\/+$/, "");
  const drive = /^([A-Za-z]):\/(.*)$/.exec(unix);
  if (drive !== null) return `//${(drive[1] ?? "").toLowerCase()}/${drive[2] ?? ""}`;
  return unix.startsWith("/") ? `/${unix}` : unix;
}

/**
 * Names never written by a run, wherever it may write: what configures a Claude run (W8 0e), and what configures bun or
 * node when started in that folder (review of 2026-10-16). The runner's sweep (`runConfigName` in daemon.ts) removes
 * the same names before each run.
 */
const RUN_CONFIG = [
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

/** A pattern that matches its name in any case (Windows finds `.Claude` and `.claude` as one folder). */
export function anyCase(pattern: string): string {
  return pattern.replace(
    /[A-Za-z]/g,
    (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`,
  );
}

/** The permission rules, tools and extra folders of one run with this toolkit. */
export function toolkitRules(
  toolkit: Toolkit,
  paths: ToolkitPaths,
  research: boolean,
): ToolkitRules {
  const allow: string[] = [];
  const deny: string[] = [];
  const addDirs: string[] = [];
  const at = (place: Place) => {
    const dir = folder(place, paths);
    if (dir !== null && !addDirs.includes(dir)) addDirs.push(dir);
    return dir === null ? "." : rulePath(dir);
  };
  for (const place of toolkit.read) {
    const root = at(place);
    allow.push(`Read(${root}/**)`);
    // a secret file is never read, even inside an allowed folder
    deny.push(
      `Read(${root}/${anyCase("**/.env*")})`,
      `Read(${root}/${anyCase("**/*credentials*")})`,
    );
  }
  for (const place of toolkit.write) {
    const root = at(place);
    allow.push(`Edit(${root}/**)`);
    deny.push(...RUN_CONFIG.map((name) => `Edit(${root}/${anyCase(name)})`));
  }
  // the studio holds what the reel engine runs and loads and the links a submitter typed: no run reads or writes it
  const studio = rulePath(paths.studio);
  deny.push(`Read(${studio}/**)`, `Edit(${studio}/**)`);
  const tools = [
    ...(toolkit.read.length > 0 ? ["Read", "Glob", "Grep"] : []),
    ...(toolkit.write.length > 0 ? ["Write", "Edit"] : []),
    ...(research ? ["WebSearch"] : []),
  ];
  if (research) allow.push("WebSearch");
  return { tools, allow, deny, addDirs };
}

/** The folders a toolkit writes, its own folder included: the runner sweeps them of run config before each run. */
export function writePlaces(toolkit: Toolkit, paths: ToolkitPaths): string[] {
  return toolkit.write.map((place) => folder(place, paths) ?? paths.own);
}

/** The folders a render may write outside the run's own folder: the toolkit's other write places (`MOP_RENDER_OUT_ROOTS`). */
export function renderRoots(toolkit: Toolkit, paths: ToolkitPaths): string[] {
  if (toolkit.render.length === 0) return [];
  return toolkit.write.flatMap((place) => {
    const dir = folder(place, paths);
    return dir === null ? [] : [dir];
  });
}

/** What a run is told about its tools, with the exact folders and commands. */
export function toolkitLine(toolkit: Toolkit, paths: ToolkitPaths, research: boolean): string {
  const name = (place: Place) =>
    place === "own_folder" ? `your folder (${paths.own})` : (folder(place, paths) ?? "");
  const lines = [
    `Your tools on this run: read ${toolkit.read.map(name).join(", ")}`,
    toolkit.write.length === 0
      ? "you write nothing"
      : `write ${toolkit.write.map(name).join(", ")}`,
    ...(research ? ["search the web"] : []),
  ];
  const outs = ["a folder in your folder", ...renderRoots(toolkit, paths)].join(" or ");
  const render =
    toolkit.render.length === 0
      ? []
      : [
          `To have ${series(toolkit.render.map((name) => renderers[name].label))} rendered, write its spec (and keep its photographs) in your folder and add to your JSON a "renders" list: {"renderer": "${toolkit.render.join("|")}", "spec": "the spec file, relative to your folder", "out": "${outs}"}. The runner renders each after your run and says the result in the thread.`,
        ];
  return [
    `${lines.join("; ")}. You run no command; anything that leaves the company is still a proposal a person approves.`,
    ...render,
  ].join(" ");
}

/** A place's folder; null for the run's own folder. A name this runner does not know is refused, never read as "own". */
function folder(place: Place, paths: ToolkitPaths): string | null {
  switch (place) {
    case "own_folder":
      return null;
    case "knowledge":
      return paths.knowledge;
    case "drive_social":
      // the runner refuses a toolkit that names a place this laptop has not set (review of 2026-10-16)
      if (paths.driveSocial === null) {
        throw new Error(
          "the toolkit names the Google Drive Social Media folder and ~/.mop-workforce/config.json sets no driveSocial",
        );
      }
      return paths.driveSocial;
    default:
      // the studio is no place (review of 2026-10-19): a toolkit that names it, or any other, starts no run
      throw new Error(`the toolkit names a place the runner does not know: ${String(place)}`);
  }
}

/** A render a colleague's answer asks for (`renders` in answer.ts). */
export interface RenderAsk {
  renderer: Renderer;
  spec: string;
  out: string;
}

/** What the runner may render for one run: the renderers its toolkit names on it, its folder, its other write places. */
export interface RenderScope {
  allowed: readonly Renderer[];
  work: string;
  roots: readonly string[];
}

type Spawn = (
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
) => SpawnSyncReturns<string>;

/** A carousel takes minutes (probe of 2026-10-16); the wrapper allows the same. */
const RENDER_TIMEOUT_MS = 10 * 60_000;

/**
 * Runs the renders a colleague's answer asks for, after its run (review of 2026-10-19). Only a renderer its toolkit
 * names on this run, each through the wrapper's checks (`renderPlan`: the spec in its folder, the output in its folder
 * or another write place, bun from the app folder with only what a render needs in its environment). Answers one line
 * per render for the thread; a run that may not render is told so once, without its words.
 */
export function runRenders(
  asks: readonly RenderAsk[],
  scope: RenderScope,
  env: Record<string, string | undefined>,
  spawn: Spawn = spawnSync,
): string[] {
  if (asks.length === 0) return [];
  if (scope.allowed.length === 0) return ["Not rendered: this run may not render."];
  return asks.map((ask) => {
    const label = renderers[ask.renderer].label;
    if (!scope.allowed.includes(ask.renderer))
      return `Not rendered: ${label} is not in this run's toolkit.`;
    let plan: ReturnType<typeof renderPlan>;
    try {
      plan = renderPlan([ask.renderer, "--spec", ask.spec, "--out", ask.out], scope.work, {
        ...env,
        MOP_RENDER_WORK: scope.work,
        MOP_RENDER_OUT_ROOTS: scope.roots.join(delimiter),
      });
    } catch (error) {
      return `Not rendered: ${label} from ${ask.spec} (${error instanceof Error ? error.message : String(error)}).`;
    }
    const run = spawn(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      encoding: "utf8",
      timeout: RENDER_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (run.status === 0) {
      const files = run.stdout.split("\n").filter((line) => line.trim().endsWith(" ok")).length;
      return `Rendered ${label} from ${ask.spec} into ${ask.out}: ${String(files)} ${files === 1 ? "file" : "files"}.`;
    }
    const why = run.error?.message ?? run.stderr.trim().split("\n").at(-1) ?? "";
    return `The render of ${label} from ${ask.spec} failed (exit ${String(run.status)}${why === "" ? "" : `: ${why}`}).`;
  });
}

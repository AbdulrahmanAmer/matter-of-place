// Role toolkits, the runner's side (ruling H115): a colleague's toolkit (`src/domain/toolkits.ts`) becomes the Claude
// Code permission rules of one run. Measured on the real CLI under `--permission-mode dontAsk` (GOTCHAS P-4511): a rule
// names an absolute Windows path as `//e/...` (lower-case drive letter, no colon) and `--add-dir` lets the run reach a
// named folder. A colleague's only command is the render wrapper (`render-run.mjs`), never bun or node on its own.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderers, type Place, type Renderer, type Toolkit } from "../../src/domain/toolkits.ts";

/** The checkout this runner runs from (`app/`): where the render scripts live. Node and Bun both know `import.meta.url`. */
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface ToolkitPaths {
  /** The run's own folder (`desks/<slug>/work`), its working directory. */
  own: string;
  studio: string;
  knowledge: string;
  /** The Google Drive Social Media folder from the runner's config, or null when the laptop names none. */
  driveSocial: string | null;
  /** The runner's checkout, where the render scripts live. */
  app: string;
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

/** The command a renderer is run with: node and the wrapper by absolute path, then the renderer's name. */
export function renderCommand(app: string, name: Renderer): string {
  return `node ${join(app, "scripts", "workforce", "render-run.mjs").replaceAll("\\", "/")} ${name}`;
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
  for (const name of toolkit.render) allow.push(`Bash(${renderCommand(paths.app, name)}:*)`);
  const tools = [
    ...(toolkit.read.length > 0 ? ["Read", "Glob", "Grep"] : []),
    ...(toolkit.write.length > 0 ? ["Write", "Edit"] : []),
    ...(toolkit.render.length > 0 ? ["Bash"] : []),
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
    ...toolkit.render.map(
      (render) =>
        `run \`${renderCommand(paths.app, render)} --spec <spec.json> --out <folder>\` to render ${renderers[render].label} (the spec and its photographs in your folder)`,
    ),
    ...(research ? ["search the web"] : []),
  ];
  return `${lines.join("; ")}. Nothing else runs; anything that leaves the company is still a proposal a person approves.`;
}

function folder(place: Place, paths: ToolkitPaths): string | null {
  if (place === "drive_social") {
    // the runner refuses a toolkit that names a place this laptop has not set (review of 2026-10-16)
    if (paths.driveSocial === null) {
      throw new Error(
        "the toolkit names the Google Drive Social Media folder and ~/.mop-workforce/config.json sets no driveSocial",
      );
    }
    return paths.driveSocial;
  }
  return place === "studio" ? paths.studio : place === "knowledge" ? paths.knowledge : null;
}

// Role toolkits, the runner's side (ruling H115): a colleague's toolkit (`src/domain/toolkits.ts`) becomes the Claude
// Code permission rules of one run. Measured on the real CLI under `--permission-mode dontAsk` (2026-10-16, GOTCHAS
// P-3577): a rule names an absolute Windows path as `//e/...` (lower-case drive letter, no colon), `--add-dir` lets the
// run reach a named folder, and a Bash rule for one script refuses every other command, chained ones included.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderers, type Place, type Toolkit } from "../../src/domain/toolkits.ts";

/** The checkout this runner runs from (`app/`): where the render scripts live. Node and Bun both know `import.meta.url`. */
export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export interface ToolkitPaths {
  /** The run's own folder (`desks/<slug>/work`), its working directory. */
  own: string;
  studio: string;
  knowledge: string;
  driveSocial: string;
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

/** The command a toolkit's renderer is run with: one script, one local spec, one output folder. */
export function renderCommand(app: string, name: keyof typeof renderers): string {
  return `bun ${join(app, renderers[name].script).replaceAll("\\", "/")} --spec`;
}

// Names that configure a Claude run: never written by a run, wherever it may write (W8 0e, second review).
const RUN_CONFIG = ["**/.claude/**", "**/CLAUDE.md", "**/CLAUDE.local.md", "**/.mcp.json"];

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
    deny.push(`Read(${root}/**/.env*)`, `Read(${root}/**/*credentials*)`);
  }
  for (const place of toolkit.write) {
    const root = at(place);
    allow.push(`Edit(${root}/**)`);
    deny.push(...RUN_CONFIG.map((name) => `Edit(${root}/${name})`));
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
        `run \`${renderCommand(paths.app, render)} <spec.json> --out <folder>\` (${renderers[render].label})`,
    ),
    ...(research ? ["search the web"] : []),
  ];
  return `${lines.join("; ")}. Nothing else runs; anything that leaves the company is still a proposal a person approves.`;
}

function folder(place: Place, paths: ToolkitPaths): string | null {
  return place === "studio"
    ? paths.studio
    : place === "knowledge"
      ? paths.knowledge
      : place === "drive_social"
        ? paths.driveSocial
        : null;
}

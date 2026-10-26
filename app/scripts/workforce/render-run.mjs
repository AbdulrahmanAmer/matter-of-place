// How a colleague's render is run (ruling H115; reviews of 2026-10-16 and 2026-10-19): never bun or node started from
// a folder a run can write, since bun reads `bunfig.toml` (its `preload`) and `.env` from the folder it starts in. A
// colleague runs no command: the runner takes the renders its answer asks for and plans each here (`renderPlan`, called
// by `runRenders` in toolkit-args.ts); by hand it is
//   node <app>/scripts/workforce/render-run.mjs <carousel|post|story> --spec <file> --out <folder>
// It checks the spec and the output folder against the run's work folder and write places (MOP_RENDER_WORK and
// MOP_RENDER_OUT_ROOTS, set by the runner), then starts bun on the named render script from the app folder, with the
// app's own config, no `.env` loaded, no auto-install and an environment of only what a render needs (no BUN_*,
// NODE_OPTIONS or CHROME_PATH). Anything else is refused.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { renderers } from "../../src/domain/toolkits.ts";
import { confineRender, inside } from "../lib/confine.mjs";

/** The checkout this wrapper belongs to (`app/`). */
const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// What a render needs from the environment, by name in upper case: Windows and Chrome, the temporary folder, the home.
const KEEP = new Set([
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "SYSTEMDRIVE",
  "WINDIR",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "LANG",
  "TZ",
]);

/**
 * @typedef {object} RenderPlan
 * @property {string} command bun, by its absolute path
 * @property {string[]} args
 * @property {string} cwd the app folder
 * @property {Record<string, string>} env
 */

/**
 * The bun command for a colleague's render, or an Error saying why it is refused.
 * @param {readonly string[]} argv the wrapper's arguments
 * @param {string} cwd the folder the colleague's shell is in (relative paths resolve from it)
 * @param {Record<string, string | undefined>} env the wrapper's environment
 * @param {string} [app]
 * @returns {RenderPlan}
 */
export function renderPlan(argv, cwd, env, app = APP) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { spec: { type: "string" }, out: { type: "string" } },
    allowPositionals: true,
    strict: true,
  });
  const name = positionals[0] ?? "";
  if (positionals.length !== 1 || !Object.hasOwn(renderers, name)) {
    throw new Error("render: name one of carousel, post or story");
  }
  if (values.spec === undefined || values.out === undefined) {
    throw new Error("render: run it as <carousel|post|story> --spec <file> --out <folder>");
  }
  const work = env["MOP_RENDER_WORK"] ?? "";
  const roots = env["MOP_RENDER_OUT_ROOTS"] ?? "";
  const spec = resolve(cwd, values.spec);
  const out = resolve(cwd, values.out);
  confineRender(spec, out, work, roots);
  const writable = [work, ...roots.split(delimiter).filter((root) => root !== "")];
  const path = (env["PATH"] ?? env["Path"] ?? "")
    .split(delimiter)
    // a folder the run may write is never where a program is looked for
    .filter((dir) => isAbsolute(dir) && !writable.some((root) => inside(root, dir)));
  const bun = path
    .flatMap((dir) => [join(dir, "bun.exe"), join(dir, "bun")])
    .find((file) => existsSync(file));
  if (bun === undefined) throw new Error("render: bun is not on the runner's PATH");
  /** @type {Record<string, string>} */
  const clean = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && KEEP.has(key.toUpperCase()) && key.toUpperCase() !== "PATH") {
      clean[key] = value;
    }
  }
  clean["PATH"] = path.join(delimiter);
  clean["MOP_RENDER_WORK"] = work;
  clean["MOP_RENDER_OUT_ROOTS"] = roots;
  const script = join(app, renderers[/** @type {keyof typeof renderers} */ (name)].script);
  return {
    command: bun,
    args: [
      `--config=${join(app, "bunfig.toml")}`,
      "--no-env-file",
      "--no-install",
      script,
      "--spec",
      spec,
      "--out",
      out,
    ],
    cwd: app,
    env: clean,
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const plan = renderPlan(process.argv.slice(2), process.cwd(), process.env);
    const run = spawnSync(plan.command, plan.args, {
      cwd: plan.cwd,
      env: plan.env,
      stdio: "inherit",
      timeout: 10 * 60_000,
    });
    process.exitCode = run.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository-root relative, because the git root is one folder above the app (G-012). */
const ALLOWED_FOLDERS = [
  "app/src/routes/",
  "app/src/lib/",
  "app/src/components/",
  "app/src/styles/",
  "app/public/",
  "app/docs/",
  "workspace/audits/",
];
const ALLOWED_FILES = ["GOTCHAS.md"];
const API_FOLDER = "app/src/routes/api";
const API_FLAT_PREFIX = "app/src/routes/api.";

/**
 * @param {string} path a path as `git diff --name-only` prints it
 * @returns {boolean}
 */
export function isAllowed(path) {
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  if ((segments.at(-1) ?? "").startsWith(".env")) return false;
  if (path === API_FOLDER || path.startsWith(`${API_FOLDER}/`)) return false;
  if (path.startsWith(API_FLAT_PREFIX)) return false;
  return ALLOWED_FILES.includes(path) || ALLOWED_FOLDERS.some((folder) => path.startsWith(folder));
}

/**
 * @param {string[]} paths
 * @returns {string[]}
 */
export function refusedPaths(paths) {
  return paths.filter((path) => !isAllowed(path));
}

/**
 * Renames are listed as a delete and an add, so the old path of a moved file is checked too.
 * @param {string} base
 * @param {string} head
 * @returns {string[]}
 */
export function changedPaths(base, head) {
  const result = spawnSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", `${base}...${head}`],
    { encoding: "utf8" },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git diff ${base}...${head} exited ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout.split("\0").filter((path) => path !== "");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2);
  if (base === undefined || head === undefined) {
    process.stderr.write("usage: node scripts/audit/scope-check.mjs <base> <head>\n");
    process.exitCode = 2;
  } else {
    const paths = changedPaths(base, head);
    const refused = refusedPaths(paths);
    for (const path of refused) process.stdout.write(`scope-check: refused ${path}\n`);
    if (refused.length === 0)
      process.stdout.write(`scope-check: OK ${String(paths.length)} paths\n`);
    process.exitCode = refused.length === 0 ? 0 : 1;
  }
}

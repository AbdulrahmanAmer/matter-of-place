import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { REPO_ROOT, field, isMain } from "./common.mjs";

// The deltas of a sidecar against the previous one (B14 step 5). Every number is compared by its path in the file;
// of the strings only a `status` is, because a `detail` changes wording from run to run. A list is read by the first
// of `line`, `check`, `path` or `name` its items carry, so a row that moves keeps its path.
const DATA_DIR = resolve(REPO_ROOT, "workspace/audits/data");
const SKIPPED_KEYS = ["front", "not_measured"];
const LABEL_KEYS = ["line", "check", "path", "name"];

/**
 * @typedef {{ key: string, kind: "changed" | "new" | "gone", previous: number | string | null, current: number | string | null, delta: number | null }} Delta
 */

/**
 * @param {unknown} item
 * @param {number} index
 * @returns {string}
 */
function labelOf(item, index) {
  const label = LABEL_KEYS.map((key) => field(item, key)).find(
    (value) => typeof value === "string",
  );
  return typeof label === "string" ? label : String(index);
}

/**
 * Every number and every `status` of a sidecar by path.
 * @param {unknown} value
 * @param {string} path
 * @param {Map<string, number | string>} found
 * @returns {Map<string, number | string>}
 */
function flatten(value, path, found = new Map()) {
  if (typeof value === "number" && Number.isFinite(value)) found.set(path, value);
  else if (typeof value === "string" && path.endsWith(".status")) found.set(path, value);
  else if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${path}[${labelOf(item, index)}]`, found));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      if (path === "" && SKIPPED_KEYS.includes(key)) continue;
      flatten(inner, path === "" ? key : `${path}.${key}`, found);
    }
  }
  return found;
}

/**
 * @param {unknown} current a sidecar
 * @param {unknown} previous the sidecar before it
 * @returns {{ deltas: Delta[], unchanged: number }}
 */
export function compareSidecars(current, previous) {
  const now = flatten(current, "");
  const before = flatten(previous, "");
  /** @type {Delta[]} */
  const deltas = [];
  let unchanged = 0;
  for (const [key, value] of now) {
    const old = before.get(key);
    if (old === undefined)
      deltas.push({
        key,
        kind: "new",
        previous: null,
        current: value,
        delta: null,
      });
    else if (old === value) unchanged += 1;
    else {
      const numbers = typeof old === "number" && typeof value === "number";
      deltas.push({
        key,
        kind: "changed",
        previous: old,
        current: value,
        delta: numbers ? Math.round((value - old) * 1000) / 1000 : null,
      });
    }
  }
  for (const [key, old] of before) {
    if (!now.has(key))
      deltas.push({
        key,
        kind: "gone",
        previous: old,
        current: null,
        delta: null,
      });
  }
  return { deltas, unchanged };
}

/**
 * @param {ReturnType<typeof compareSidecars>} result
 * @returns {string[]}
 */
export function describeDeltas({ deltas, unchanged }) {
  const count = (/** @type {Delta["kind"]} */ kind) =>
    deltas.filter((delta) => delta.kind === kind).length;
  return [
    ...deltas.map((delta) => {
      if (delta.kind === "new") return `${delta.key}  new  ${String(delta.current)}`;
      if (delta.kind === "gone") return `${delta.key}  gone  was ${String(delta.previous)}`;
      const sign = delta.delta !== null && delta.delta > 0 ? "+" : "";
      const change = delta.delta === null ? "" : `  ${sign}${String(delta.delta)}`;
      return `${delta.key}  ${String(delta.previous)} -> ${String(delta.current)}${change}`;
    }),
    `${String(count("changed"))} changed, ${String(count("new"))} new, ${String(count("gone"))} gone, ${String(unchanged)} unchanged`,
  ];
}

/**
 * @param {string} file
 * @returns {unknown}
 */
const readSidecar = (file) => JSON.parse(readFileSync(file, "utf8"));

/** @returns {string[]} the sidecars of the data folder, newest first; none when the folder does not exist yet */
function newestSidecars() {
  let names;
  try {
    names = readdirSync(DATA_DIR);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse()
    .map((name) => resolve(DATA_DIR, name));
}

if (isMain(import.meta.url)) {
  const { positionals } = parseArgs({ allowPositionals: true });
  const [current, previous] = positionals.length >= 2 ? positionals : newestSidecars();
  if (current === undefined || previous === undefined) {
    process.stdout.write(
      "Two sidecars are needed: pass <current> <previous> or keep two in workspace/audits/data.\n",
    );
  } else {
    const lines = describeDeltas(compareSidecars(readSidecar(current), readSidecar(previous)));
    process.stdout.write(`${lines.join("\n")}\n`);
  }
}

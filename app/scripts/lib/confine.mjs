// Where a colleague's render may reach (ruling H115): the spec inside the run's work folder, the output inside it or a
// folder the runner named. Shared by the render wrapper (`scripts/workforce/render-run.mjs`) and the render scripts'
// `--spec` mode (`shoot.mjs`), so both check the same thing. Paths are compared after links and junctions resolve.
import { realpathSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, relative, resolve } from "node:path";

/**
 * A path made real: its longest existing part through `realpathSync`, the rest appended (the output folder may not exist).
 * @param {string} target
 */
export function realPath(target) {
  let current = resolve(target);
  /** @type {string[]} */
  const tail = [];
  for (;;) {
    try {
      return resolve(realpathSync(current), ...tail.reverse());
    } catch {
      const parent = dirname(current);
      if (parent === current) return resolve(target);
      tail.push(basename(current));
      current = parent;
    }
  }
}

/**
 * Whether `path` lies inside `root`, both made real first (a link or a junction cannot lead out).
 * @param {string} root
 * @param {string} path
 */
export function inside(root, path) {
  const within = relative(realPath(root), realPath(path));
  return within === "" || (!within.startsWith("..") && !isAbsolute(within));
}

/**
 * The places a colleague's render may touch: the spec file inside `work`, the output folder inside `work` or a folder
 * named in `roots` (the toolkit's other write places, joined with the path delimiter).
 * @param {string} spec
 * @param {string} out
 * @param {string} work
 * @param {string | undefined} roots
 */
export function confineRender(spec, out, work, roots) {
  if (!isAbsolute(work)) throw new Error("render: the runner named no work folder");
  if (!inside(work, spec)) throw new Error("render: the spec must be inside your work folder");
  const allowed = [work, ...(roots ?? "").split(delimiter).filter((root) => root !== "")];
  if (!allowed.some((root) => isAbsolute(root) && inside(root, out))) {
    throw new Error(
      "render: the output folder must be inside your work folder or a folder you may write",
    );
  }
}

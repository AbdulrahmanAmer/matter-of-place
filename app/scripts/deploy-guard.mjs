import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The paths ci.yml runs on: a commit that its paths-ignore keeps out of CI never deploys, so it
// supersedes nothing.
const CODE_PATHS = [".", ":!workspace", ":!launch", ":!*.md"];

/**
 * True when `git rev-list <sha>..origin/main -- <code paths>` printed a commit: a newer code commit
 * is already on main, and its own run deploys it (B1b invariant 6a, DO-04).
 * @param {string} revListOutput
 * @returns {boolean}
 */
export function supersededBy(revListOutput) {
  return revListOutput.trim() !== "";
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sha = process.argv[2] ?? "";
  const output = process.env["GITHUB_OUTPUT"] ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha) || output === "") {
    process.stdout.write(
      "usage: GITHUB_OUTPUT=<file> node scripts/deploy-guard.mjs <40-character sha>\n",
    );
    process.exit(2);
  }
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const newer = execFileSync("git", ["rev-list", `${sha}..origin/main`, "--", ...CODE_PATHS], {
    cwd: root,
    encoding: "utf8",
  });
  const superseded = supersededBy(newer);
  appendFileSync(output, `superseded=${String(superseded)}\n`);
  process.stdout.write(superseded ? `superseded ${sha}\n` : `deploying ${sha}\n`);
}

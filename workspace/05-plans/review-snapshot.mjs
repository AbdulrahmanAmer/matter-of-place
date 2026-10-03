#!/usr/bin/env node
// A frozen copy of one commit for a reviewer (ruling H54, design in review-overlap.md), so a review never shares a
// folder with the builder working on the next group.
//
//   node workspace/05-plans/review-snapshot.mjs create <laneRoot> <sha>   prints the snapshot folder; installs packages
//   node workspace/05-plans/review-snapshot.mjs remove <laneRoot>         deletes the snapshot worktree and folder
//   node workspace/05-plans/review-snapshot.mjs sweep  <laneRoot>         removes a snapshot older than four hours
//
// The snapshot lives beside the lane as <laneRoot>-review. .env and app/.dev.vars are copied from the lane and go
// away with the folder. A git lock collision with the builder's own commands is retried once.
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { basename, dirname, join } from "node:path";

const [verb, laneRootArg, sha] = process.argv.slice(2);
if (!verb || !laneRootArg || (verb === "create" && !sha)) {
  console.error("usage: review-snapshot.mjs create <laneRoot> <sha> | remove <laneRoot> | sweep <laneRoot>");
  process.exit(2);
}
const laneRoot = laneRootArg.replace(/\\/g, "/").replace(/\/$/, "");
const snap = `${laneRoot}-review`;
const git = (args, cwd = laneRoot) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitRetry = (args, cwd) => {
  try {
    return git(args, cwd);
  } catch (error) {
    const text = String(error.stderr || error.message);
    if (!/index\.lock|Unable to create|lock/i.test(text)) throw error;
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1500)"]);
    return git(args, cwd);
  }
};

function remove() {
  if (existsSync(snap)) {
    try {
      gitRetry(["worktree", "remove", "--force", snap]);
    } catch {
      rmSync(snap, { recursive: true, force: true });
    }
  }
  rmSync(`${snap}.started`, { force: true });
  try {
    git(["worktree", "prune"]);
  } catch {
    // nothing to prune
  }
  console.log(`review-snapshot: removed ${snap}`);
}

if (verb === "remove") {
  remove();
} else if (verb === "sweep") {
  if (existsSync(snap)) {
    const marker = `${snap}.started`;
    const age = existsSync(marker) ? Date.now() - statSync(marker).mtimeMs : Infinity;
    if (age > 4 * 3_600_000) remove();
    else console.log(`review-snapshot: ${basename(snap)} is ${Math.round(age / 60000)} minutes old, kept`);
  } else {
    console.log("review-snapshot: nothing to sweep");
  }
} else if (verb === "create") {
  if (existsSync(snap)) remove();
  gitRetry(["worktree", "add", "--detach", snap, sha]);
  mkdirSync(join(snap, "app"), { recursive: true });
  for (const file of [".env", "app/.dev.vars"]) {
    const from = join(laneRoot, file);
    if (existsSync(from)) copyFileSync(from, join(snap, file));
  }
  writeFileSync(`${snap}.started`, new Date().toISOString());
  execSync("bun install --frozen-lockfile", { cwd: join(snap, "app"), stdio: ["ignore", "pipe", "pipe"] });
  console.log(snap);
  console.error(`review-snapshot: ${basename(snap)} at ${sha.slice(0, 7)} from ${dirname(snap)}`);
}

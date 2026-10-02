#!/usr/bin/env node
// Self-check of gotcha-guard.mjs: node .claude/hooks/gotcha-guard.test.mjs   (exit 1 on any wrong answer)
// It feeds the hook the payload of an Edit for files in this workspace, in a stand-in build lane (a folder elsewhere
// that holds GOTCHAS.md and .git, as a git worktree does) and outside any tree.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const hook = join(here, "gotcha-guard.mjs");
const lane = mkdtempSync(join(tmpdir(), "mop-lane-"));
copyFileSync(join(root, "GOTCHAS.md"), join(lane, "GOTCHAS.md"));
writeFileSync(join(lane, ".git"), "gitdir: stand-in for a worktree\n");

const ask = (file_path) => {
  const r = spawnSync("node", [hook], { input: JSON.stringify({ tool_name: "Edit", tool_input: { file_path } }), encoding: "utf8" });
  if (!r.stdout.trim()) return "silent";
  const h = JSON.parse(r.stdout).hookSpecificOutput;
  return h.permissionDecision === "deny" ? "deny" : "context";
};
const cases = [
  ["workspace, generated route tree", join(root, "app/src/routeTree.gen.ts"), "deny"],
  ["workspace, wordmark component", join(root, "app/src/components/brand/wordmark.tsx"), "context"],
  ["workspace, a file no entry names", join(root, "README.md"), "silent"],
  ["lane, generated route tree", join(lane, "app/src/routeTree.gen.ts"), "deny"],
  ["lane, wordmark component", join(lane, "app/src/components/brand/wordmark.tsx"), "context"],
  ["outside any tree", join(tmpdir(), "mop-outside-file.txt"), "silent"],
];
let bad = 0;
for (const [name, file, want] of cases) {
  const got = ask(file);
  if (got !== want) bad++;
  console.log(`${got === want ? "ok  " : "FAIL"} ${name}: ${got}${got === want ? "" : ` (expected ${want})`}`);
}
rmSync(lane, { recursive: true, force: true });
console.log(bad ? `gotcha-guard: ${bad} wrong answer(s)` : `gotcha-guard: OK (${cases.length} cases)`);
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
// PreToolUse hook (Edit | Write | MultiEdit | NotebookEdit) for the Matter of Place workspace.
// Reads GOTCHAS.md, finds entries whose `paths:` globs match the file about to be written, and
// pushes them into the session: severity `block` denies the edit, `warn` adds the entry as context.
// Fails open: any error, missing file or unparseable payload → exit 0 with no output.
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += ".*"; i++; if (glob[i + 1] === "/") i++; }
      else re += "[^/]*";
    } else if (".+?^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp("^" + re + "$");
}

function parseEntries(md) {
  const entries = [];
  for (const block of md.split(/\n(?=## )/)) {
    const title = (block.match(/^## (.+)$/m) || [])[1];
    const paths = (block.match(/^- paths:\s*(.+)$/m) || [])[1];
    if (!title || !paths || paths.startsWith("<")) continue;
    const severity = ((block.match(/^- severity:\s*(\w+)/m) || [])[1] || "warn").toLowerCase();
    const enforced = /^- enforced-by:/m.test(block);
    const rule = (block.match(/^- rule:\s*(.+)$/m) || [])[1] || "";
    const proof = (block.match(/^- proof:\s*(.+)$/m) || [])[1] || "";
    entries.push({ title, globs: paths.split(",").map((s) => s.trim()).filter(Boolean), severity, enforced, rule, proof });
  }
  return entries;
}

try {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  const payload = JSON.parse(raw || "{}");
  const fp = payload?.tool_input?.file_path || payload?.tool_input?.notebook_path;
  if (!fp) process.exit(0);
  // The file may sit in this workspace or in a build lane: a git worktree of the same repository in another folder
  // (S54, GOTCHAS P-051). Its own tree root is the nearest ancestor that holds both GOTCHAS.md and .git.
  let tree = null;
  for (let dir = dirname(resolve(fp)); ; dir = dirname(dir)) {
    if (existsSync(resolve(dir, "GOTCHAS.md")) && existsSync(resolve(dir, ".git"))) { tree = dir; break; }
    if (dirname(dir) === dir) break;
  }
  if (!tree) process.exit(0);
  const rel = relative(tree, resolve(fp)).replace(/\\/g, "/");
  if (rel.startsWith("..")) process.exit(0);

  // The bank on the workspace's branch is the newest; a lane's own copy may hold entries its builder just added.
  const seen = new Set();
  const all = [];
  for (const bank of [resolve(root, "GOTCHAS.md"), resolve(tree, "GOTCHAS.md")]) {
    if (!existsSync(bank)) continue;
    for (const e of parseEntries(readFileSync(bank, "utf8"))) if (!seen.has(e.title)) { seen.add(e.title); all.push(e); }
  }
  const entries = all.filter((e) => !e.enforced && e.globs.some((g) => globToRegExp(g).test(rel)));
  if (!entries.length) process.exit(0);

  const blocks = entries.filter((e) => e.severity === "block");
  const lines = entries.map((e) => `• ${e.title}\n  rule: ${e.rule}\n  proof: ${e.proof}`);
  if (blocks.length) {
    const reason = `GOTCHAS.md refuses this edit to ${rel}:\n${lines.join("\n")}\nIf the rule is wrong, change the entry in GOTCHAS.md first (with proof), then retry.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
    process.exit(0);
  }
  const ctx = `GOTCHAS.md entries for ${rel} (read before editing):\n${lines.join("\n")}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: ctx } }));
  process.exit(0);
} catch {
  process.exit(0);
}

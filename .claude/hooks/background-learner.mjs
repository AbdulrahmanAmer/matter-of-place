// PostToolUse hook on Bash: when the operator sends a running command to the background by hand, its signatures are
// learned, so shell-shaper.mjs backgrounds that kind of command by itself from then on (operator, 2026-10-13:
// "whatever I send manually to run in the background should be added to the list of things that automatically go to
// the background"). The list is .claude/hooks/background-learned.json, plain JSON a person can read and edit.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const LEARNED_FILE = join(dirname(fileURLToPath(import.meta.url)), "background-learned.json");

// Segments that are never long by themselves: moving around, reading, small git and file operations.
const TRIVIAL = /^(cd|echo|printf|ls|cat|head|tail|grep|sed|awk|wc|cut|sort|uniq|tr|mkdir|rm|mv|touch|test|true|false|:|date|which|pwd|sleep|until|for|while|do|done|if|then|fi|git (status|log|add|commit|diff|show|rev-parse|branch|worktree list)|node -e|bun -e)\b/;

/**
 * The signatures of a command: the program and its first word for every segment that is not trivial, with any
 * `cd`, `env`, `NAME=value` and `timeout N` prefix removed.
 */
export function signatures(command) {
  const out = new Set();
  for (const raw of String(command).split(/&&|\|\||;|\||\n|\(|\)/)) {
    let seg = raw.trim();
    for (let changed = true; changed; ) {
      const before = seg;
      seg = seg
        .replace(/^(env(\s+-u\s+\S+)*\s+)/, "")
        .replace(/^([A-Z_][A-Z0-9_]*=("[^"]*"|'[^']*'|\S*)\s+)+/, "")
        .replace(/^timeout\s+\d+\s+/, "")
        .trim();
      changed = seg !== before;
    }
    if (seg === "" || TRIVIAL.test(seg)) continue;
    const words = seg.split(/\s+/).filter((w) => !/^["']?\$/.test(w));
    const sig = words.slice(0, 2).join(" ").replace(/["']/g, "");
    if (sig.length >= 3) out.add(sig);
  }
  return [...out];
}

export function readLearned(file = LEARNED_FILE) {
  try {
    const list = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(list) ? list.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  if (payload.tool_name !== "Bash") return;
  const response = JSON.stringify(payload.tool_response ?? "");
  if (!/manually backgrounded|backgroundedByUser"\s*:\s*true/i.test(response)) return;
  const learned = new Set(readLearned());
  const added = signatures(payload.tool_input?.command ?? "").filter((s) => !learned.has(s));
  if (added.length === 0) return;
  writeFileSync(LEARNED_FILE, `${JSON.stringify([...learned, ...added].sort(), null, 2)}\n`);
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: `background-learner: from now on these go to the background by themselves: ${added.join(", ")}`,
      },
    }),
  );
}

if (process.argv[1] && /background-learner\.mjs$/.test(process.argv[1])) await main();

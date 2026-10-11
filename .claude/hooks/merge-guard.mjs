// PreToolUse hook on Bash: refuses `gh pr merge` (and `gh pr merge --auto`) typed by the orchestrator or an agent.
// The only merge path is `node workspace/05-plans/merge-gate.mjs <pr>` (B1b invariant 6b, P-028): it posts the
// `merge-gate` status on the head and merges pinned to it; main's own `merge-gate` ci job refuses any merge commit
// without that status, and then the dev deploy never runs. Measured 2026-10-11: ten merges by hand left main's ci red
// from 21:35 to 01:00 and the dev site at the morning's release. The script itself calls gh through a child process,
// not through this tool, so it is never blocked. Test: node .claude/hooks/merge-guard.test.mjs
import process from "node:process";

export function decide(command) {
  const text = String(command ?? "");
  if (/\bgh\s+pr\s+merge\b/.test(text)) {
    return "Merging by hand is refused (P-028, invariant 6b): run `node workspace/05-plans/merge-gate.mjs <pr>` instead; it posts the merge-gate status main's ci requires and merges pinned to the head. `--auto` is the same hazard: a merge with a failed check.";
  }
  return "";
}

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw || "{}");
  } catch {
    return;
  }
  if (input.tool_name !== "Bash" && input.tool_name !== "PowerShell") return;
  const reason = decide(input.tool_input?.command);
  if (reason) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
    );
  }
}

if (process.argv[1] && /merge-guard\.mjs$/.test(process.argv[1])) await main();

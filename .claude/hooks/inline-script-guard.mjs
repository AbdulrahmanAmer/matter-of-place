// PreToolUse hook on Bash: refuses an inline script that carries a backslash (P-008). On this machine the Bash tool
// drops or doubles backslashes inside `node -e`, `bun -e`, `python -c` and heredoc bodies, so a regex, an escape or a
// Windows path arrives changed and the script fails, or worse, writes the wrong thing. The operator, 2026-10-12: "if you
// know something will break a script write the script the right way". The right way is mechanical: write the script
// to a file with the Write tool (it keeps every character), then run the file. Test: node .claude/hooks/inline-script-guard.test.mjs
import process from "node:process";

const INLINE = /(\b(node|bun|deno)\s+(-e|--eval|-p|--print)\b|\bpython3?\s+-c\b|<<-?\s*['"]?\w+)/;

export function decide(command) {
  const text = String(command ?? "");
  if (!INLINE.test(text) || !text.includes("\\")) return "";
  return "An inline script with a backslash is refused (P-008): this shell changes backslashes inside `node -e`, `python -c` and heredocs. Write the script to a file in the scratchpad with the Write tool, then run that file (`node <file>`).";
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
  if (input.tool_name !== "Bash") return;
  const reason = decide(input.tool_input?.command);
  if (reason) {
    process.stdout.write(
      JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
    );
  }
}

if (process.argv[1] && /inline-script-guard\.mjs$/.test(process.argv[1])) await main();

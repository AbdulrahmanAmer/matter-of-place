#!/usr/bin/env node
// Run a long command and print little (ruling H52): node workspace/05-plans/quiet.mjs -- <command...>
// Green: the last 12 lines (the summaries of check, test and build live there). Red: everything from the
// first line that names a failure to the end, capped at 160 lines, plus the exit code. Nothing a reader
// needs to see a failure is ever cut. Every line a command prints otherwise sits in the agent's context for
// the rest of its session and is re-sent on every later call.
import { spawnSync } from "node:child_process";

const at = process.argv.indexOf("--");
const argv = at >= 0 ? process.argv.slice(at + 1) : process.argv.slice(2);
if (!argv.length) {
  console.error("usage: node workspace/05-plans/quiet.mjs -- <command> [args...]");
  process.exit(2);
}
const run = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", shell: true, maxBuffer: 1 << 28 });
const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`.split(/\r?\n/).filter((line) => line.trim() !== "");
const code = run.status ?? 1;
if (code === 0) {
  console.log(lines.slice(-12).join("\n"));
  console.log(`quiet: ok (${lines.length} lines, showing the last ${Math.min(12, lines.length)})`);
} else {
  const first = lines.findIndex((line) => /\b(FAIL|ERROR|error|Error|×|✖|failed|refusing)\b/.test(line));
  const from = first >= 0 ? Math.max(0, first - 3) : Math.max(0, lines.length - 60);
  const shown = lines.slice(from, from + 160);
  console.log(shown.join("\n"));
  console.log(`quiet: exit ${code} (${lines.length} lines, showing ${shown.length} from line ${from + 1})`);
}
process.exit(code);

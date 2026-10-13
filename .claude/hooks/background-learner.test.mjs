// node .claude/hooks/background-learner.test.mjs: the signatures learned from commands the operator backgrounded by hand.
import assert from "node:assert/strict";
import { signatures } from "./background-learner.mjs";

const cases = [
  ["a scan after a cd and a time limit", "cd /e/mop-build/authkey && timeout 300 gitleaks detect --source . --redact", ["gitleaks detect"]],
  ["an install with its check", "scoop install gitleaks 2>&1 | tail -3; which gitleaks && gitleaks version", ["scoop install", "gitleaks version"]],
  ["settings prefixes", "env -u SUPABASE_URL VITE_X=/a bun --env-file=x scripts/backup.mjs", ["bun --env-file=x"]],
  ["nothing from reading and small git", "cd /e/x && git status --short && grep -c a b | head -3", []],
];
let failed = 0;
for (const [name, command, expected] of cases) {
  try {
    assert.deepEqual(signatures(command), expected);
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);

// node .claude/hooks/shell-shaper.test.mjs: every case prints ok, or the process exits 1 at the first failure.
import assert from "node:assert/strict";
import { shape } from "./shell-shaper.mjs";

const written = [];
const io = { cwd: "E:/work", now: () => 1, write: (file, text, append) => written.push({ file, text, append }) };
const cases = [];
const it = (name, fn) => cases.push([name, fn]);

it("leaves a plain short command alone", () => {
  assert.equal(shape({ command: "git status --short" }, io), null);
});

it("moves a node -e script with a backslash into a file, keeping every character", () => {
  written.length = 0;
  const r = shape({ command: `cd /e/x && node -e "const re = /a\\\\d+/; console.log(\\"hi\\")" && echo done` }, io);
  assert.match(r.input.command, /^cd \/e\/x && node "[^"]+inline-1-\d+\.mjs" && echo done$/);
  assert.equal(written[0].text, 'const re = /a\\d+/; console.log("hi")');
});

it("keeps a single-quoted body literal", () => {
  written.length = 0;
  const r = shape({ command: "bun -e 'console.log(\"a\\nb\")'" }, io);
  assert.match(r.input.command, /^bun "[^"]+\.mjs"$/);
  assert.equal(written[0].text, 'console.log("a\\nb")');
});

it("leaves a node -e script without a backslash inline", () => {
  assert.equal(shape({ command: 'node -e "console.log(1)"' }, io), null);
});

it("writes a quoted heredoc into its file, appending with >>, and drops it from the command", () => {
  written.length = 0;
  const r = shape({ command: "cd /e/rec && cat >> GOTCHAS.md <<'EOF'\n## P-1 \\d stays\n- added: x\nEOF\ngrep -c P-1 GOTCHAS.md" }, io);
  assert.equal(r.input.command, "cd /e/rec && : wrote GOTCHAS.md\ngrep -c P-1 GOTCHAS.md");
  assert.deepEqual(written[0], { file: "E:/work/GOTCHAS.md", text: "## P-1 \\d stays\n- added: x\n", append: true });
});

it("maps a Git Bash drive path for the heredoc file", () => {
  written.length = 0;
  shape({ command: "cat > /e/mop-build/x.txt <<'EOF'\nhello\nEOF" }, io);
  assert.equal(written[0].file, "E:/mop-build/x.txt");
});

it("sends a long command to the background, and keeps one already there", () => {
  const r = shape({ command: "cd app && timeout 300 bunx vitest run tests/unit/a.test.ts" }, io);
  assert.equal(r.input.run_in_background, true);
  assert.equal(shape({ command: "bun run check", run_in_background: true }, io), null);
  for (const long of ["bun run build", "node scripts/watchfail.mjs --only x", "bash gate-loop.sh l 1", "bunx tsc --noEmit -p x", "bun install --frozen-lockfile"]) {
    assert.equal(shape({ command: long }, io)?.input.run_in_background, true, long);
  }
});

it("still refuses what it cannot rewrite safely", () => {
  assert.match(shape({ command: 'python -c "print(\\"a\\\\b\\")"' }, io).deny, /python/);
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL ${name}\n     ${error instanceof Error ? error.message : String(error)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);

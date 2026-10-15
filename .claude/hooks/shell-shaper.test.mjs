// node .claude/hooks/shell-shaper.test.mjs: every case prints ok, or the process exits 1 at the first failure.
import assert from "node:assert/strict";
import { shape } from "./shell-shaper.mjs";

const written = [];
const io = { cwd: "E:/work", now: () => 1, learned: [], write: (file, text, append) => written.push({ file, text, append }) };
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
  assert.deepEqual(written[0], { file: "E:/rec/GOTCHAS.md", text: "## P-1 \\d stays\n- added: x\n", append: true });
});

it("maps a Git Bash drive path for the heredoc file", () => {
  written.length = 0;
  shape({ command: "cat > /e/mop-build/x.txt <<'EOF'\nhello\nEOF" }, io);
  assert.equal(written[0].file, "E:/mop-build/x.txt");
});

it("writes a relative heredoc file where the command's own cd has taken it (P-3459 landed in the root bank)", () => {
  written.length = 0;
  shape({ command: "cd /e/mop-build/harness && cat >> GOTCHAS.md <<'EOF'\n## P-9\nEOF\ngit add -A" }, io);
  assert.equal(written[0].file, "E:/mop-build/harness/GOTCHAS.md");
});

it("sends a long command to the background, and keeps one already there", () => {
  const r = shape({ command: "cd app && timeout 300 bunx vitest run tests/unit/a.test.ts" }, io);
  assert.equal(r.input.run_in_background, true);
  assert.equal(shape({ command: "bun run check", run_in_background: true }, io), null);
  for (const long of ["bun run build", "node scripts/watchfail.mjs --only x", "bash gate-loop.sh l 1", "bunx tsc --noEmit -p x", "bun install --frozen-lockfile"]) {
    assert.equal(shape({ command: long }, io)?.input.run_in_background, true, long);
  }
});

it("refuses a bare wrangler call in Matter of Place while the shell holds a personal token (P-530)", () => {
  const personal = { ...io, env: { CLOUDFLARE_API_TOKEN: "x" } };
  const bare = "cd /e/mop-build/x/app && bun --env-file=../.env x wrangler secret put K --name matter-of-place";
  assert.match(shape({ command: bare }, personal)?.deny ?? "", /P-530/);
  assert.equal(shape({ command: `env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID ${bare}` }, personal), null);
  assert.equal(shape({ command: "node scratch/cfw.mjs secret list --name matter-of-place" , }, { ...personal, cwd: "E:/mop-build/x" }), null);
  assert.equal(shape({ command: bare }, { ...io, env: {} }), null);
  assert.equal(shape({ command: "cd /e/mop-build/x/app && grep -n account_id wrangler.toml" }, personal), null);
  assert.equal(shape({ command: 'grep -n "account_id\\|^name" E:/mop-build/x/app/wrangler.toml' }, personal), null);
  assert.equal(shape({ command: "cd /e/mop-build/x/app && node scripts/w.mjs --only hy-wrangler", run_in_background: true }, personal), null);
  assert.equal(shape({ command: "cd /e/mop-build/x && printf '%s\\n' 'a hook refuses bare wrangler calls' >> STATE.md" }, personal), null);
  assert.equal(shape({ command: "cd /e/mop-build/x && git commit -q -F - <<'EOF'\nfix: a wrangler call now fails\nEOF\ngit log -1" }, { ...personal, write: () => {} })?.deny, undefined);
  assert.equal(shape({ command: "bunx wrangler whoami" }, { ...personal, cwd: "D:/other-project" }), null);
});

it("leaves a command that only reads or searches text about a long tool in the foreground", () => {
  for (const reader of [
    "cd /e/x/app && grep -n PENDING scripts/watchfail.mjs | head",
    "git show origin/main:app/scripts/watchfail.mjs | sed -n 1,20p",
    "sed -n 155,175p scripts/watchfail.mjs && ls node_modules",
  ]) {
    assert.equal(shape({ command: reader }, io), null, reader);
  }
  assert.equal(shape({ command: "grep -c x a.txt && node scripts/watchfail.mjs --only y" }, io)?.input.run_in_background, true);
});

it("backgrounds what was once backgrounded by hand, and any command with a time limit of a minute or more", () => {
  const learnedIo = { ...io, learned: ["gitleaks detect", "scoop install"] };
  assert.equal(shape({ command: "cd /e/x && gitleaks detect --source . --redact" }, learnedIo)?.input.run_in_background, true);
  assert.equal(shape({ command: "scoop install gitleaks" }, learnedIo)?.input.run_in_background, true);
  assert.equal(shape({ command: "node scripts/x.mjs" }, learnedIo), null);
  assert.equal(shape({ command: "timeout 120 node scripts/x.mjs" }, learnedIo)?.input.run_in_background, true);
  assert.equal(shape({ command: "timeout 20 node scripts/x.mjs" }, learnedIo), null);
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

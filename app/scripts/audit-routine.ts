// `bun scripts/audit-routine.ts`: the Saturday audit routine (B14; gap audit item 25, 2026-10-12: nothing started it).
// The "MOP Audit" scheduled task (scripts/workforce/install.ps1) runs this at 09:00 Saturday on the operator's laptop,
// in its own local time, so Cairo's clock changes need no edit. It refreshes its own checkout of main, then runs the
// operator's Claude CLI with the prompt of workspace/audits/ROUTINE-PROMPT.md word for word, as the mop-auditor
// agent. `run-all.mjs` itself honours schedule_settings.audit.enabled: switched off, the run prints "skipped, disabled".
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runClaude } from "./workforce/cli.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DESK = join(dirname(root), "audit-desk");
const STATE = join(homedir(), ".mop-workforce");
const TIMEOUT_MS = 90 * 60_000;

/** The fenced prompt of ROUTINE-PROMPT.md, word for word. */
export function routinePrompt(markdown: string): string {
  const match = /```\r?\n([\s\S]*?)\r?\n```/.exec(markdown);
  if (match?.[1] === undefined)
    throw new Error("audit routine: no fenced prompt in ROUTINE-PROMPT.md");
  return match[1];
}

function git(...args: string[]): void {
  const ran = spawnSync("git", args, { windowsHide: true, encoding: "utf8" });
  if (ran.status !== 0)
    throw new Error(`audit routine: git ${args.join(" ")} failed: ${ran.stderr.trim()}`);
}

/** The desk at origin/main, its packages current, the workspace's `.env` linked in (never copied or printed). */
function freshDesk(): void {
  git("-C", root, "fetch", "-q", "origin", "main");
  if (!existsSync(DESK)) git("-C", root, "worktree", "add", "-q", "--detach", DESK, "origin/main");
  git("-C", DESK, "stash", "push", "-u", "-q", "-m", `audit ${new Date().toISOString()}`);
  git("-C", DESK, "switch", "-q", "--detach", "origin/main");
  const env = join(DESK, ".env");
  if (!existsSync(env)) linkSync(join(root, ".env"), env);
  const lock = createHash("sha256")
    .update(readFileSync(join(DESK, "app/bun.lock")))
    .digest("hex");
  const marker = join(STATE, "audit-desk.lock-hash");
  if (!existsSync(marker) || readFileSync(marker, "utf8") !== lock) {
    const installed = spawnSync("bun", ["install", "--frozen-lockfile"], {
      cwd: join(DESK, "app"),
      windowsHide: true,
    });
    if (installed.status !== 0) throw new Error("audit routine: bun install failed");
    writeFileSync(marker, lock);
  }
}

async function main(): Promise<void> {
  mkdirSync(STATE, { recursive: true });
  freshDesk();
  const prompt = routinePrompt(
    readFileSync(join(DESK, "workspace/audits/ROUTINE-PROMPT.md"), "utf8"),
  );
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env))
    if (!name.startsWith("CLAUDE")) env[name] = value;
  console.log(`${new Date().toISOString()} audit routine: started in ${DESK}`);
  const answer = await runClaude({
    args: [
      "-p",
      "--model",
      "claude-opus-5-5",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch",
    ],
    cwd: DESK,
    env,
    prompt,
    timeoutMs: TIMEOUT_MS,
    who: "The audit routine",
  });
  console.log(`${new Date().toISOString()} audit routine: done\n${answer.text.slice(-1500)}`);
}

if (import.meta.main) await main();

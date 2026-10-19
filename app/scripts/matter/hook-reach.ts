// W6 item 6: do the operator's global hooks (`~/.claude/settings.json`: shell-shaper, push-gate, edit-impact) reach
// Matter's own `claude -p` runs? Two checks and one live proof, all on this laptop:
//  - `settingsReach`: the global file lists the three hooks on the right events and their scripts exist;
//  - `argsKeepUserSettings`: Matter's full-power command line does not switch user settings off (`--restricted`,
//    `--bare` and a `--setting-sources` without `user` all do; the read-only run uses `--restricted` on purpose, H101);
//  - `probeEvidence`: a real run in a scratch repository, whose stream must show shell-shaper sending a long command to
//    the background and an edit-impact note after an edit.
// Run: `bun scripts/matter/hook-reach.ts` (the two checks) or `bun scripts/matter/hook-reach.ts probe` (also the live run,
// one Haiku turn). The verdict is appended to `~/.mop-workforce/hook-reach.log`; exit 1 when a check fails.
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { matterArgs } from "./run.ts";

/** The hooks the operator named, with where each one is declared in `settings.json`. */
const GLOBAL_HOOKS = [
  { script: "shell-shaper.mjs", event: "PreToolUse", tool: "Bash" },
  { script: "push-gate.mjs", event: "PreToolUse", tool: "Bash" },
  { script: "edit-impact.mjs", event: "PostToolUse", tool: "Edit" },
] as const;

const hookGroup = z.object({
  matcher: z.string().optional(),
  hooks: z.array(z.object({ command: z.string().optional() })).default([]),
});
const globalSettings = z.object({ hooks: z.record(z.string(), z.array(hookGroup)).default({}) });

/** The global hooks that do not reach a run: not declared for their tool on their event, or their script is missing. */
export function settingsReach(settingsText: string, hooksDir: string): string[] {
  let settings: z.infer<typeof globalSettings>;
  try {
    settings = globalSettings.parse(JSON.parse(settingsText));
  } catch {
    return GLOBAL_HOOKS.map((hook) => `${hook.script}: ~/.claude/settings.json is not readable`);
  }
  return GLOBAL_HOOKS.flatMap((hook) => {
    const declared = (settings.hooks[hook.event] ?? []).some(
      (group) =>
        (group.matcher === undefined || new RegExp(`^(?:${group.matcher})$`).test(hook.tool)) &&
        group.hooks.some((entry) => entry.command?.includes(hook.script) === true),
    );
    if (!declared) return [`${hook.script}: not declared for ${hook.tool} on ${hook.event}`];
    return existsSync(join(hooksDir, hook.script)) ? [] : [`${hook.script}: the script is missing`];
  });
}

/** The reasons a command line stops Claude Code reading `~/.claude/settings.json`; empty when it reads it. */
export function argsKeepUserSettings(args: readonly string[]): string[] {
  const reasons: string[] = [];
  if (args.includes("--restricted")) reasons.push("--restricted ignores user settings");
  if (args.includes("--bare")) reasons.push("--bare skips hooks");
  const sources = args[args.indexOf("--setting-sources") + 1];
  if (args.includes("--setting-sources") && !(sources ?? "").split(",").includes("user"))
    reasons.push("--setting-sources leaves out user");
  return reasons;
}

const hookResponse = z.object({
  type: z.literal("system"),
  subtype: z.literal("hook_response"),
  hook_event: z.string(),
  output: z.string(),
});
/** What a hook prints: Claude Code reports it as a JSON string in the `output` of a `hook_response` event. */
const hookOutput = z.object({
  hookSpecificOutput: z.object({
    permissionDecisionReason: z.string().optional(),
    updatedInput: z.object({ run_in_background: z.boolean().optional() }).optional(),
    additionalContext: z.string().optional(),
  }),
});

interface HookEvidence {
  /** The shell-shaper reason that sent a command to the background, or null. */
  shellShaper: string | null;
  /** The first lines of the edit-impact note after an edit, or null. */
  editImpact: string | null;
}

/** What a probe run's stream (one JSON event per line, with hook events) shows about the hooks. */
export function probeEvidence(stream: string): HookEvidence {
  const evidence: HookEvidence = { shellShaper: null, editImpact: null };
  for (const line of stream.split(/\r?\n/)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const response = hookResponse.safeParse(event);
    if (!response.success || response.data.output === "") continue;
    let printed: z.infer<typeof hookOutput>;
    try {
      printed = hookOutput.parse(JSON.parse(response.data.output));
    } catch {
      continue;
    }
    const { permissionDecisionReason, updatedInput, additionalContext } =
      printed.hookSpecificOutput;
    if (
      response.data.hook_event === "PreToolUse" &&
      permissionDecisionReason?.startsWith("shell-shaper:") === true &&
      updatedInput?.run_in_background === true
    )
      evidence.shellShaper ??= permissionDecisionReason;
    if (
      response.data.hook_event === "PostToolUse" &&
      additionalContext?.startsWith("edit-impact") === true
    )
      evidence.editImpact ??= additionalContext.split("\n").slice(0, 2).join(" ");
  }
  return evidence;
}

/** A scratch repository where the probe's edit breaks an import, so edit-impact has something to say. */
export function makeProbeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "mop-hook-probe-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(
    join(dir, "src", "lib.ts"),
    'export function greet(): string {\n  return "hi";\n}\n',
  );
  writeFileSync(
    join(dir, "src", "use.ts"),
    'import { greet } from "./lib";\n\nexport const said = greet();\n',
  );
  const git = (...args: string[]) =>
    spawnSync(
      "git",
      ["-C", dir, "-c", "user.name=probe", "-c", "user.email=probe@mop.invalid", ...args],
      {
        windowsHide: true,
      },
    );
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "probe");
  return dir;
}

const PROBE_PROMPT = [
  "Do these two things in order, with no commentary, then reply DONE.",
  "1. Run this shell command exactly: npm install --help",
  "2. Read src/lib.ts, then edit it so the exported function greet is named hello.",
  "Do nothing else: do not fix anything the edit breaks.",
].join("\n");

/** Matter's own full-power command line, with a Haiku turn and the stream that shows hook events. */
export function probeArgs(): string[] {
  const args = matterArgs("full");
  const format = args.indexOf("--output-format");
  const model = args.indexOf("--model");
  args[format + 1] = "stream-json";
  args[model + 1] = "claude-haiku-5-5";
  return [...args, "--verbose", "--include-hook-events"];
}

const LOG = join(homedir(), ".mop-workforce", "hook-reach.log");

function note(line: string): void {
  mkdirSync(join(homedir(), ".mop-workforce"), { recursive: true });
  appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

function main(): number {
  const claude = join(homedir(), ".claude");
  const settingsFile = join(claude, "settings.json");
  const missing = settingsReach(
    existsSync(settingsFile) ? readFileSync(settingsFile, "utf8") : "",
    join(claude, "hooks"),
  );
  const blocked = argsKeepUserSettings(matterArgs("full"));
  for (const problem of [...missing, ...blocked]) note(`hook-reach: FAIL ${problem}`);
  if (missing.length + blocked.length === 0)
    note("hook-reach: settings and command line reach the hooks");
  let failed = missing.length + blocked.length > 0;
  if (process.argv[2] === "probe") {
    const repo = makeProbeRepo();
    const run = spawnSync(process.env["WORKFORCE_CLI"]?.trim() || "claude", probeArgs(), {
      cwd: repo,
      input: PROBE_PROMPT,
      encoding: "utf8",
      timeout: 5 * 60_000,
      windowsHide: true,
    });
    const evidence = probeEvidence(run.stdout);
    if (evidence.shellShaper === null)
      note("hook-reach: FAIL the live run shows no shell-shaper background note");
    else note(`hook-reach: live run, shell-shaper said "${evidence.shellShaper}"`);
    if (evidence.editImpact === null)
      note("hook-reach: FAIL the live run shows no edit-impact note");
    else note(`hook-reach: live run, edit-impact said "${evidence.editImpact}"`);
    failed ||= evidence.shellShaper === null || evidence.editImpact === null;
  }
  return failed ? 1 : 0;
}

if (import.meta.main) process.exit(main());

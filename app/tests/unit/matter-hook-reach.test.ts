import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  argsKeepUserSettings,
  makeProbeRepo,
  probeArgs,
  probeEvidence,
  settingsReach,
} from "../../scripts/matter/hook-reach";
import { liveArgs } from "../../scripts/matter/live";
import { matterArgs } from "../../scripts/matter/run";

// W6 item 6: the global hooks (shell-shaper, push-gate, edit-impact) reach Matter's own `claude -p` runs.

const hook = (matcher: string, script: string) => ({
  matcher,
  hooks: [{ type: "command", command: `node "$HOME/.claude/hooks/${script}"` }],
});
const settings = (parts: { pre?: unknown[]; post?: unknown[] }) =>
  JSON.stringify({ hooks: { PreToolUse: parts.pre ?? [], PostToolUse: parts.post ?? [] } });
const complete = settings({
  pre: [hook("Bash", "shell-shaper.mjs"), hook("Bash", "push-gate.mjs")],
  post: [hook("Edit|Write|MultiEdit", "edit-impact.mjs")],
});

function hooksFolder(scripts: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "mop-hooks-"));
  for (const script of scripts) writeFileSync(join(dir, script), "// hook");
  return dir;
}
const ALL = ["shell-shaper.mjs", "push-gate.mjs", "edit-impact.mjs"];

describe("the global settings file", () => {
  it("lists shell-shaper, push-gate and edit-impact on their events, with their scripts present", () => {
    expect(settingsReach(complete, hooksFolder(ALL))).toEqual([]);
  });

  it("names a hook that is not declared for its tool or whose script is gone", () => {
    const noPushGate = settings({
      pre: [hook("Bash", "shell-shaper.mjs")],
      post: [hook("Edit", "edit-impact.mjs")],
    });
    const wrongTool = settings({
      pre: [hook("Bash", "shell-shaper.mjs"), hook("Bash", "push-gate.mjs")],
      post: [hook("Bash", "edit-impact.mjs")],
    });
    expect({
      undeclared: settingsReach(noPushGate, hooksFolder(ALL)),
      wrongTool: settingsReach(wrongTool, hooksFolder(ALL)),
      scriptGone: settingsReach(complete, hooksFolder(["shell-shaper.mjs", "edit-impact.mjs"])),
      unreadable: settingsReach("{", hooksFolder(ALL)).length,
    }).toEqual({
      undeclared: ["push-gate.mjs: not declared for Bash on PreToolUse"],
      wrongTool: ["edit-impact.mjs: not declared for Edit on PostToolUse"],
      scriptGone: ["push-gate.mjs: the script is missing"],
      unreadable: 3,
    });
  });
});

describe("Matter's command lines", () => {
  it("keep ~/.claude/settings.json for a full-power run and the live session, and drop it for the read-only run (H101)", () => {
    expect({
      full: argsKeepUserSettings(matterArgs("full")),
      live: argsKeepUserSettings(liveArgs(null)),
      read: argsKeepUserSettings(matterArgs("read")),
      bare: argsKeepUserSettings(["-p", "--bare"]),
      project: argsKeepUserSettings(["-p", "--setting-sources", "project,local"]),
      withUser: argsKeepUserSettings(["-p", "--setting-sources", "user,project"]),
    }).toEqual({
      full: [],
      live: [],
      read: ["--restricted ignores user settings"],
      bare: ["--bare skips hooks"],
      project: ["--setting-sources leaves out user"],
      withUser: [],
    });
  });

  it("make the probe the same full-power command with a Haiku turn and the hook events in the stream", () => {
    const args = probeArgs();
    expect({
      model: args[args.indexOf("--model") + 1],
      format: args[args.indexOf("--output-format") + 1],
      events: args.includes("--include-hook-events"),
      verbose: args.includes("--verbose"),
      settings: args.some((arg) => arg.endsWith("settings-full.json")),
      keepsUser: argsKeepUserSettings(args),
    }).toEqual({
      model: "claude-haiku-5-5",
      format: "stream-json",
      events: true,
      verbose: true,
      settings: true,
      keepsUser: [],
    });
  });
});

const response = (event: string, output: unknown) =>
  JSON.stringify({
    type: "system",
    subtype: "hook_response",
    hook_event: event,
    output: typeof output === "string" ? output : JSON.stringify(output),
  });
const shaper = (updatedInput: object) =>
  response("PreToolUse", {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "shell-shaper: long command sent to the background",
      updatedInput,
    },
  });
const post = (additionalContext: string) =>
  response("PostToolUse", {
    hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext },
  });
const IMPACT =
  "edit-impact (fix these before running any test or check):\n- GONE greet left src/lib.ts but is still imported by: src/use.ts.";

describe("the stream of a probe run", () => {
  it("shows shell-shaper sending a command to the background and an edit-impact note after an edit", () => {
    const stream = [
      response("SessionStart", ""),
      shaper({ command: "npm install --help", run_in_background: true }),
      post("[write-sanity] `src/lib.ts`\n- 3 CRLF line endings."),
      post(IMPACT),
    ].join("\n");
    expect(probeEvidence(stream)).toEqual({
      shellShaper: "shell-shaper: long command sent to the background",
      editImpact:
        "edit-impact (fix these before running any test or check): - GONE greet left src/lib.ts but is still imported by: src/use.ts.",
    });
  });

  it("does not count a shell-shaper note that left the command in the foreground, nor another hook's note after an edit", () => {
    const stream = [
      shaper({ command: "ls" }),
      post("[write-sanity] `src/lib.ts`\n- 3 CRLF line endings."),
      "not json",
      response("PostToolUse", "not json either"),
      JSON.stringify({ type: "assistant", message: { content: [] } }),
    ].join("\n");
    expect(probeEvidence(stream)).toEqual({ shellShaper: null, editImpact: null });
  });

  it("does not take an edit-impact note for the before-edit event", () => {
    expect(
      probeEvidence(response("PreToolUse", { hookSpecificOutput: { additionalContext: IMPACT } })),
    ).toEqual({
      shellShaper: null,
      editImpact: null,
    });
  });
});

describe("the probe repository", () => {
  it("holds a committed export that another file imports, so renaming it gives edit-impact something to say", () => {
    const repo = makeProbeRepo();
    const git = (...args: string[]) =>
      spawnSync("git", ["-C", repo, ...args], {
        encoding: "utf8",
        windowsHide: true,
      }).stdout.trim();
    expect({
      files: git("ls-files").split(/\r?\n/).sort(),
      clean: git("status", "--porcelain"),
      commits: git("rev-list", "--count", "HEAD"),
      imports: git("show", "HEAD:src/use.ts").includes('import { greet } from "./lib"'),
    }).toEqual({
      files: ["src/lib.ts", "src/use.ts"],
      clean: "",
      commits: "1",
      imports: true,
    });
  });
});

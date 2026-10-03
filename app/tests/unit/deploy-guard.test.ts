import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { supersededBy } from "../../scripts/deploy-guard.mjs";

const SCRIPT = resolve(import.meta.dirname, "../../scripts/deploy-guard.mjs");
const IDENTITY = {
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

describe("supersededBy", () => {
  it("a listed commit supersedes the deployed one", () => {
    expect(supersededBy("4b825dc642cb6eb9a060e54bf8d69288fbee4904\n")).toBe(true);
  });

  it("an empty list supersedes nothing", () => {
    expect([supersededBy(""), supersededBy("\n")]).toEqual([false, false]);
  });
});

describe("deploy-guard.mjs on a repository whose origin/main moved on", () => {
  let dir = "";

  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...IDENTITY },
    }).trim();

  function commit(path: string): string {
    const file = join(dir, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${path}\n`);
    git("add", path);
    git("commit", "-q", "-m", path);
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    return git("rev-parse", "HEAD");
  }

  function guard(sha: string) {
    const output = join(dir, ".git", "github-output");
    writeFileSync(output, "");
    const run = spawnSync(process.execPath, [SCRIPT, sha], {
      cwd: join(dir, "app"),
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: output },
    });
    return { status: run.status, stdout: run.stdout, output: readFileSync(output, "utf8") };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "deploy-guard-"));
    git("init", "-q", "-b", "main");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("deploys when main gained only workspace, launch and Markdown commits", () => {
    const deployed = commit("app/src/a.ts");
    commit("workspace/notes.txt");
    commit("launch/brief.txt");
    commit("app/docs/runbooks/x.md");
    expect(guard(deployed)).toEqual({
      status: 0,
      stdout: `deploying ${deployed}\n`,
      output: "superseded=false\n",
    });
  });

  it("is superseded once a newer code commit is on main", () => {
    const deployed = commit("app/src/a.ts");
    commit("workspace/notes.txt");
    commit("app/src/b.ts");
    expect(guard(deployed)).toEqual({
      status: 0,
      stdout: `superseded ${deployed}\n`,
      output: "superseded=true\n",
    });
  });

  it("is superseded by a newer commit outside app, such as a workflow", () => {
    const deployed = commit("app/src/a.ts");
    commit(".github/workflows/ci.yml");
    expect(guard(deployed)).toEqual({
      status: 0,
      stdout: `superseded ${deployed}\n`,
      output: "superseded=true\n",
    });
  });

  it("refuses a SHA that is not 40 hex characters", () => {
    const deployed = commit("app/src/a.ts");
    expect(guard(deployed.slice(0, 7))).toEqual({
      status: 2,
      stdout: "usage: GITHUB_OUTPUT=<file> node scripts/deploy-guard.mjs <40-character sha>\n",
      output: "",
    });
  });
});

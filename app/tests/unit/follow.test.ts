import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { followMain } from "../../scripts/workforce/follow";

// Gap audit item 6: the runner folder follows main between runs, and only the folder install.ps1 registered.

const git = (cwd: string, ...args: string[]) =>
  spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t.invalid", ...args], {
    encoding: "utf8",
  });

describe("followMain", () => {
  it("moves only the registered runner, only when clean, and leaves any other folder alone", () => {
    const root = mkdtempSync(join(tmpdir(), "mop-follow-"));
    const origin = join(root, "origin");
    const runner = join(root, "live");
    mkdirSync(join(origin, "app"), { recursive: true });
    spawnSync("git", ["init", "-q", "-b", "main", origin]);
    writeFileSync(join(origin, "app", "bun.lock"), "lock");
    writeFileSync(join(origin, "app", "a.txt"), "one");
    git(origin, "add", ".");
    git(origin, "commit", "-q", "-m", "one");
    spawnSync("git", ["clone", "-q", origin, runner]);
    git(runner, "checkout", "-q", "--detach");
    writeFileSync(join(origin, "app", "a.txt"), "two");
    git(origin, "commit", "-q", "-am", "two");
    const app = join(runner, "app");
    const marker = join(root, "runner-app");
    writeFileSync(marker, join(root, "elsewhere", "app"));
    const stranger = followMain(app, marker);
    writeFileSync(marker, app);
    const moved = followMain(app, marker);
    const content = readFileSync(join(app, "a.txt"), "utf8");
    writeFileSync(join(app, "a.txt"), "mine");
    writeFileSync(join(origin, "app", "a.txt"), "three");
    git(origin, "commit", "-q", "-am", "three");
    const kept = followMain(app, marker);
    expect([stranger, moved, content, kept, readFileSync(join(app, "a.txt"), "utf8")]).toEqual([
      "not the runner",
      "moved",
      "two",
      "kept local changes",
      "mine",
    ]);
    // Eleven git processes: seconds on Windows, more under load (G-031).
  }, 60_000);
});

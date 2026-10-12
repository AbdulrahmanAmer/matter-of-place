import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P-3444: one watched-fail replay per folder. A replay started while another lives refuses before it mutates anything.

const app = join(import.meta.dirname, "..", "..");
const lock = join(app, "node_modules", ".cache", "watchfail.lock");

describe("watchfail's lock", () => {
  it("refuses a second replay while the first lives, and leaves the holder's lock alone", () => {
    if (existsSync(lock))
      throw new Error("a replay is running in this folder; run this test alone");
    mkdirSync(join(app, "node_modules", ".cache"), { recursive: true });
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      stdio: "ignore",
    });
    try {
      writeFileSync(lock, String(holder.pid));
      const second = spawnSync(
        process.execPath,
        ["scripts/watchfail.mjs", "--registry", "tests/mutations", "--only", "ap-a-job-name"],
        { cwd: app, encoding: "utf8" },
      );
      expect([
        second.status,
        second.stderr.includes("another replay"),
        readFileSync(lock, "utf8"),
      ]).toEqual([3, true, String(holder.pid)]);
    } finally {
      holder.kill();
      rmSync(lock, { force: true });
    }
  }, 60_000);
});

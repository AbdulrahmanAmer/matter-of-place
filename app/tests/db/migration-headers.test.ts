// GD-07, DB-08, STANDARDS R16 and R17: a file test, it opens no connection. The destructive-change scan is imported
// from scripts/check-migrations.mjs, never typed a second time (ruling H43 (3)).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkMigrations } from "../../scripts/check-migrations.mjs";

const APP = new URL("../../", import.meta.url);
const DIR = "supabase/migrations";
const HEADER_LINES = 30;
const HEADER = /^-- (?:down:|irreversible: \S)/;
const VERSION = /^(\d{14})_/;
const LOCK_TIMEOUT = "set lock_timeout = '5s';";

const files = readdirSync(new URL(`${DIR}/`, APP))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const read = (file: string) => readFileSync(new URL(`${DIR}/${file}`, APP), "utf8");
const mainVersions = execFileSync("git", ["ls-tree", "--name-only", "origin/main", `${DIR}/`], {
  cwd: APP,
  encoding: "utf8",
})
  .split("\n")
  .flatMap((path) => VERSION.exec(path.slice(path.lastIndexOf("/") + 1))?.[1] ?? []);

/** The first line that is neither blank nor a `--` comment. */
function firstStatement(text: string): string | undefined {
  return text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "" && !line.startsWith("--"));
}

describe("migration headers", () => {
  it("every migration opens with -- down: or -- irreversible: in its first 30 lines", () => {
    const offenders = files.filter(
      (file) =>
        !read(file)
          .split("\n")
          .slice(0, HEADER_LINES)
          .some((line) => HEADER.test(line)),
    );
    expect(offenders).toEqual([]);
  });

  it("every migration's first statement is set lock_timeout = '5s';", () => {
    const offenders = files.filter((file) => firstStatement(read(file)) !== LOCK_TIMEOUT);
    expect(offenders).toEqual([]);
  });

  // An expand migration on main always sorts before its contract, so only older versions on main may be named.
  it("no destructive change without -- contract-of: naming an older version on main", () => {
    const offenders = files.flatMap((file) => {
      const version = VERSION.exec(file)?.[1] ?? "";
      return checkMigrations({
        changed: [],
        added: [file],
        mainPrefixes: mainVersions.filter((onMain) => onMain < version),
        readFile: read,
      });
    });
    expect(offenders).toEqual([]);
  });
});

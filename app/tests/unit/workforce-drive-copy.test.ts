// W8 0g: the nightly copy to Google Drive copies what its allow-list names, never a secret, never render scratch, the
// newest database dumps only, and copies nothing when the Drive folder is missing.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyAll, copyRules, plan, refused } from "../../scripts/workforce/drive-copy.ts";

const made: string[] = [];
function world() {
  const root = mkdtempSync(join(tmpdir(), "w8-0g-"));
  made.push(root);
  const home = join(root, "home");
  const drive = join(root, "drive");
  const dumps = join(root, "dumps");
  const put = (path: string, text = "x") => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  };
  put(join(home, "studio", "2026-10-15-reel", "brief.json"));
  put(join(home, "studio", "2026-10-15-reel", "out", "reel.mp4"));
  put(join(home, "studio", "2026-10-15-reel", "shots", "0001.png"));
  put(join(home, "studio", "2026-10-15-reel", "reference", "STUDY.md"));
  put(join(home, "studio", "2026-10-15-reel", ".env"));
  put(join(home, "studio", "creds", "token.txt"));
  put(join(home, "matter", "notes.md"));
  put(join(home, "matter", "live-state.md"));
  put(join(home, "matter", "goal.json"));
  put(join(home, "matter", "live-session.json"));
  put(join(home, "matter", "knowledge", "audience.md"));
  for (const day of ["01", "02", "03", "04", "05", "06", "07", "08", "09"])
    put(join(dumps, `mop-dev-2026-10-${day}.dump.p7m`));
  put(join(dumps, "x.dump"));
  mkdirSync(drive, { recursive: true });
  return { home, drive, dumps, rules: copyRules(home, join(drive, "Backups"), dumps) };
}
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("W8 0g: the copy to Google Drive", () => {
  it("refuses every path shaped like a secret", () => {
    expect(
      [
        ".env",
        "a/.env.local",
        "creds/x.txt",
        "a/credentials.json",
        "k.pem",
        "a/api-token.txt",
        ".ssh/id",
      ].map(refused),
    ).toEqual([true, true, true, true, true, true, true]);
    expect(["brief.json", "out/reel.mp4", "notes.md", "environment.md"].map(refused)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("copies what the allow-list names, without render scratch, secrets or unnamed files", () => {
    const { drive, rules } = world();
    const result = copyAll(drive, rules);
    const backups = join(drive, "Backups");
    const there = (path: string) => existsSync(join(backups, path));
    expect([
      there("Studio/2026-10-15-reel/brief.json"),
      there("Studio/2026-10-15-reel/out/reel.mp4"),
      there("Matter/notes.md"),
      there("Matter/live-state.md"),
      there("Matter/goal.json"),
      there("Knowledge/audience.md"),
    ]).toEqual([true, true, true, true, true, true]);
    expect([
      there("Studio/2026-10-15-reel/shots/0001.png"),
      there("Studio/2026-10-15-reel/reference/STUDY.md"),
      there("Studio/2026-10-15-reel/.env"),
      there("Studio/creds/token.txt"),
      there("Matter/live-session.json"),
    ]).toEqual([false, false, false, false, false]);
    expect(result.refused).toBe(2);
  });

  it("keeps only the newest seven encrypted dumps, and copies each changed file once", () => {
    const { drive, rules } = world();
    copyAll(drive, rules);
    const database = rules.find((rule) => rule.to.endsWith("Database"));
    expect(database).toBeDefined();
    if (database === undefined) return;
    const copied = plan({ ...database, to: join(drive, "nowhere") }).copy.map((item) =>
      basename(item.from),
    );
    expect(copied).toEqual([
      "mop-dev-2026-10-03.dump.p7m",
      "mop-dev-2026-10-04.dump.p7m",
      "mop-dev-2026-10-05.dump.p7m",
      "mop-dev-2026-10-06.dump.p7m",
      "mop-dev-2026-10-07.dump.p7m",
      "mop-dev-2026-10-08.dump.p7m",
      "mop-dev-2026-10-09.dump.p7m",
    ]);
    expect(existsSync(join(drive, "Backups", "Database", "x.dump"))).toBe(false);
    // a second night copies nothing that did not change, even where the Drive folder stored the time coarser
    const notes = join(drive, "Backups", "Matter", "notes.md");
    const then = statSync(notes).mtime;
    utimesSync(notes, then, new Date(then.getTime() - 1));
    expect(copyAll(drive, rules).files).toBe(0);
  });

  it("copies nothing and says the Drive folder is missing when it is", () => {
    const { drive, rules } = world();
    rmSync(drive, { recursive: true, force: true });
    expect(copyAll(drive, rules)).toEqual({
      ok: false,
      missing: true,
      files: 0,
      bytes: 0,
      refused: 0,
      failed: 0,
    });
    expect(existsSync(drive)).toBe(false);
  });

  it("refuses the login and key files a studio folder could hold, by name", () => {
    expect(
      [
        ".credentials.json",
        ".claude.json",
        ".git-credentials",
        ".npmrc",
        ".pgpass",
        ".netrc",
        "id_rsa",
        "id_ed25519",
        "key.ppk",
        "dev.env",
        ".env-backup",
        ".envrc",
        "service-account-prod.json",
        "a/.ssh/config",
      ].map(refused),
    ).toEqual(Array(14).fill(true));
  });

  it("copies only the file types a piece of work is made of", () => {
    const { drive, home, rules } = world();
    const piece = join(home, "studio", "2026-10-15-reel");
    writeFileSync(join(piece, "tool.exe"), "x");
    writeFileSync(join(piece, "notes"), "x");
    copyAll(drive, rules);
    const there = (name: string) =>
      existsSync(join(drive, "Backups", "Studio", "2026-10-15-reel", name));
    expect([there("brief.json"), there("tool.exe"), there("notes")]).toEqual([true, false, false]);
  });

  it("refuses a file whose text looks like a key, a login or a token, and counts it", () => {
    const { drive, home, rules } = world();
    const piece = join(home, "studio", "2026-10-15-reel");
    const fake = ["sk", "ant", "x".repeat(30)].join("-");
    writeFileSync(join(piece, "status.md"), `a pasted line ${fake}`);
    writeFileSync(
      join(piece, "login.json"),
      JSON.stringify({ password: "correct-horse-battery-staple" }),
    );
    writeFileSync(join(piece, "plain.md"), "a calm note about a reel");
    const result = copyAll(drive, rules);
    const there = (name: string) =>
      existsSync(join(drive, "Backups", "Studio", "2026-10-15-reel", name));
    expect([there("status.md"), there("login.json"), there("plain.md")]).toEqual([
      false,
      false,
      true,
    ]);
    expect(result.refused).toBe(4);
  });

  it("does not follow a link or a junction at a rule's own folder, a named file or an encrypted dump", () => {
    const { drive, home, dumps, rules } = world();
    const outside = join(home, "..", "outside");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "private.md"), "private");
    rmSync(join(home, "matter", "knowledge"), { recursive: true, force: true });
    symlinkSync(outside, join(home, "matter", "knowledge"), "junction");
    copyAll(drive, rules);
    expect(existsSync(join(drive, "Backups", "Knowledge", "private.md"))).toBe(false);
    // a link as a named file or a dump is refused where the system allows creating one without privileges
    try {
      rmSync(join(home, "matter", "notes.md"));
      symlinkSync(join(outside, "private.md"), join(home, "matter", "notes.md"), "file");
      rmSync(join(dumps, "mop-dev-2026-10-09.dump.p7m"));
      symlinkSync(join(outside, "private.md"), join(dumps, "mop-dev-2026-10-09.dump.p7m"), "file");
    } catch {
      return;
    }
    rmSync(join(drive, "Backups"), { recursive: true, force: true });
    copyAll(drive, rules);
    expect(existsSync(join(drive, "Backups", "Matter", "notes.md"))).toBe(false);
    expect(existsSync(join(drive, "Backups", "Database", "mop-dev-2026-10-09.dump.p7m"))).toBe(
      false,
    );
  });

  it("goes on past a file it cannot copy and says so, so the beat is not ok", () => {
    const { drive, rules } = world();
    // a file where a folder must be: the studio copy of one piece fails, the notes still arrive
    mkdirSync(join(drive, "Backups"), { recursive: true });
    writeFileSync(join(drive, "Backups", "Studio"), "a file where the Studio folder should be");
    const result = copyAll(drive, rules);
    expect(result.ok).toBe(false);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.error).toBeDefined();
    expect(existsSync(join(drive, "Backups", "Matter", "notes.md"))).toBe(true);
  });
});

// Re-stamp this branch's new migrations past the newest migration on origin/main, keeping their relative order,
// and update every tracked file that names an old version (registry entries, logs, the bank, contract-of headers).
//
//   bun run migrations:restamp              # from app/: renames with `git mv`, rewrites references, prints the map
//   bun run migrations:restamp -- --dry-run # prints the map and the files it would touch, changes nothing
//
// Why a script (ruling H57, P-511, hit again on B9, B17 and B7): two lanes stamp their migrations in parallel, the one
// that merges second sorts before main's newest and `migrations:check` refuses it; the rename by hand missed a
// reference each time (a registry `run` line, a log block, a bank proof). One stale file moves them all: a later
// branch migration may depend on it (a contract-of header, a function the next file calls), so every branch
// migration is re-stamped in its current order, one second apart, starting after the later of main's newest version
// and the current UTC time.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DIR = "supabase/migrations";
const PREFIX = /^(\d{14})_/;
const dryRun = process.argv.includes("--dry-run");

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 26 });
}
function sqlNames(text: string): string[] {
  return text.split("\n").filter((line) => line.endsWith(".sql"));
}
function versionOf(path: string): string {
  return PREFIX.exec(path.split("/").pop() ?? "")?.[1] ?? "";
}
function stamp(date: Date): string {
  return date.toISOString().replace(/\D/g, "").slice(0, 14);
}
function plusOneSecond(version: string): string {
  const n = (from: number, to: number) => Number(version.slice(from, to));
  return stamp(
    new Date(Date.UTC(n(0, 4), n(4, 6) - 1, n(6, 8), n(8, 10), n(10, 12), n(12, 14) + 1)),
  );
}

const onMain = sqlNames(git(["ls-tree", "--name-only", "origin/main", `${DIR}/`]));
// The working tree against main (not HEAD): a rename staged by an earlier run already counts.
const added = sqlNames(
  git(["diff", "--relative", "--name-only", "--diff-filter=A", "origin/main", "--", DIR]),
);
const latest = onMain.map(versionOf).reduce((max, p) => (p > max ? p : max), "");
const stale = added.filter((file) => versionOf(file) <= latest);

if (stale.length === 0) {
  process.stdout.write(
    `restamp-migrations: nothing to do (${String(added.length)} added, all after ${latest || "none"})\n`,
  );
  process.exit(0);
}

const toMove = [...added].sort();
const now = stamp(new Date());
let cursor = latest > now ? latest : now;
const renames: { oldPath: string; newPath: string; oldVersion: string; newVersion: string }[] = [];
for (const oldPath of toMove) {
  cursor = plusOneSecond(cursor);
  const name = oldPath.split("/").pop() ?? oldPath;
  renames.push({
    oldPath,
    newPath: `${DIR}/${cursor}${name.slice(14)}`,
    oldVersion: versionOf(oldPath),
    newVersion: cursor,
  });
}

// Every tracked file of the repository (not only app/) that names an old version: registry JSON, logs, the bank.
// A renamed migration may itself name an earlier one (a contract-of header): it is read at its old path and
// written at its new one.
const top = git(["rev-parse", "--show-toplevel"]).trim();
const tracked = git(["-C", top, "ls-files"]).split("\n").filter(Boolean);
const edits = new Map<string, string>();
for (const rel of tracked) {
  let text: string;
  try {
    text = readFileSync(`${top}/${rel}`, "utf8");
  } catch {
    continue;
  }
  let next = text;
  for (const { oldVersion, newVersion } of renames) next = next.split(oldVersion).join(newVersion);
  if (next === text) continue;
  const renamed = renames.find((r) => rel.endsWith(r.oldPath));
  const target = renamed
    ? `${top}/${rel.slice(0, rel.length - renamed.oldPath.length)}${renamed.newPath}`
    : `${top}/${rel}`;
  edits.set(target, next);
}

for (const { oldPath, oldVersion, newVersion } of renames) {
  process.stdout.write(`${oldVersion} -> ${newVersion}  ${oldPath}\n`);
}
const touched = [...edits.keys()].map((p) => p.slice(top.length + 1));
process.stdout.write(
  `references in ${String(edits.size)} file(s): ${touched.join(", ") || "none"}\n`,
);
if (dryRun) {
  process.stdout.write("restamp-migrations: dry run, nothing changed\n");
  process.exit(0);
}
for (const { oldPath, newPath } of renames) git(["mv", oldPath, newPath]);
for (const [path, next] of edits) writeFileSync(path, next);
process.stdout.write(
  `restamp-migrations: ${String(renames.length)} renamed, ${String(edits.size)} file(s) rewritten; review \`git status\` and commit\n`,
);

// W8 0g (operator, 2026-10-15: "using Google Drive to save a few things here and there that can work as a backup"): the
// nightly copy of what lives only on the laptop into the folder Google Drive for desktop mirrors. The rules name what
// is copied (an allow-list of folders and files), never what is left out; a second check refuses anything shaped like
// a secret even inside an allowed folder. Never the .env file, the creds folder, keys or tokens.
//   bun scripts/workforce/drive-copy.ts           copy, then beat `drive_copy` (ops_health names a stale or failed copy)
//   bun scripts/workforce/drive-copy.ts --plan    list what would be copied, copy nothing
// The nightly "MOP Backup" task runs it after the database dump (~/.mop-workforce/backup-local.mjs, ruling H114).
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";

/** The folder Google Drive for desktop mirrors (W8 item 8). */
export const DRIVE_ROOT = "G:/My Drive/Matter of Place";
const TIME_SLACK_MS = 2000;

export interface CopyRule {
  /** What the rule copies, in words, for the log. */
  name: string;
  from: string;
  to: string;
  /** Only these files of `from` (no folders); omitted: every file below `from`, minus `skipDirs`. */
  files?: readonly string[];
  /** Folders below `from` that are render scratch, rebuilt on every run. */
  skipDirs?: readonly string[];
  /** Only the newest `keep` files whose name matches `pattern` (the encrypted database dumps). */
  newest?: { pattern: RegExp; keep: number };
}

/** The allow-list: each folder the copy may read, and where its copy goes under `Backups`. */
export function copyRules(home: string, backups: string, dumps: string): CopyRule[] {
  return [
    {
      name: "the studio, without render scratch",
      from: join(home, "studio"),
      to: join(backups, "Studio"),
      skipDirs: ["shots", "reference", "frames", "cache", ".cache", "tmp", "node_modules"],
    },
    {
      name: "Matter's notes, live state and goal list",
      from: join(home, "matter"),
      to: join(backups, "Matter"),
      files: ["notes.md", "live-state.md", "goal.json"],
    },
    {
      name: "the team's knowledge",
      from: join(home, "matter", "knowledge"),
      to: join(backups, "Knowledge"),
    },
    {
      name: "the encrypted database backups",
      from: dumps,
      to: join(backups, "Database"),
      newest: { pattern: /^mop-dev-\d{4}-\d{2}-\d{2}\.dump\.p7m$/, keep: 7 },
    },
  ];
}

const SECRET_SHAPES = [
  /(^|\/)\.env($|[./])/i,
  /(^|\/)creds?(\/|$)/i,
  /(^|\/)credentials?(\.json)?$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|\/)[^/]*(token|secret|password)[^/]*$/i,
  /(^|\/)\.(ssh|aws|claude)(\/|$)/i,
];

/** A second guard inside an allowed folder: a path shaped like a secret is never copied. */
export function refused(relativePath: string): boolean {
  const path = relativePath.replaceAll("\\", "/");
  return SECRET_SHAPES.some((shape) => shape.test(path));
}

export interface Planned {
  from: string;
  to: string;
  bytes: number;
}

/** What one rule copies: every allowed file that is new or changed (size or a newer time) at the destination. */
export function plan(rule: CopyRule): { copy: Planned[]; refused: string[] } {
  const copy: Planned[] = [];
  const skipped: string[] = [];
  if (!existsSync(rule.from)) return { copy, refused: skipped };
  const consider = (from: string, to: string) => {
    const rel = relative(rule.from, from);
    if (refused(rel)) {
      skipped.push(rel);
      return;
    }
    const size = statSync(from).size;
    // A copy keeps the source's time, and the Drive folder stores it coarser (it drops the fraction of a
    // millisecond, measured 2026-10-16): within two seconds counts as the same, or every night copies everything.
    const same =
      existsSync(to) &&
      statSync(to).size === size &&
      statSync(to).mtimeMs + TIME_SLACK_MS >= statSync(from).mtimeMs;
    if (!same) copy.push({ from, to, bytes: size });
  };
  if (rule.files !== undefined) {
    for (const file of rule.files) {
      const from = join(rule.from, file);
      if (existsSync(from) && statSync(from).isFile()) consider(from, join(rule.to, file));
    }
    return { copy, refused: skipped };
  }
  if (rule.newest !== undefined) {
    const { pattern, keep } = rule.newest;
    const names = readdirSync(rule.from)
      .filter((name) => pattern.test(name))
      .sort()
      .slice(-keep);
    for (const name of names) consider(join(rule.from, name), join(rule.to, name));
    return { copy, refused: skipped };
  }
  const walk = (dir: string, depth: number) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (rule.skipDirs?.includes(entry.name.toLowerCase()) === true) continue;
        if (refused(relative(rule.from, from))) {
          skipped.push(relative(rule.from, from));
          continue;
        }
        if (depth < 8) walk(from, depth + 1);
      } else if (entry.isFile()) consider(from, join(rule.to, relative(rule.from, from)));
    }
  };
  walk(rule.from, 0);
  return { copy, refused: skipped };
}

/** The encrypted dumps on Drive beyond the newest `keep`: removed, so Drive holds what the laptop keeps. */
export function staleDumps(rule: CopyRule): string[] {
  if (rule.newest === undefined || !existsSync(rule.to)) return [];
  const { pattern, keep } = rule.newest;
  const names = readdirSync(rule.to)
    .filter((name) => pattern.test(name))
    .sort();
  return names.slice(0, Math.max(0, names.length - keep)).map((name) => join(rule.to, name));
}

export interface CopyResult {
  ok: boolean;
  missing: boolean;
  files: number;
  bytes: number;
  refused: number;
}

/** Copy every rule's plan; when the Drive folder is missing, copy nothing and say so. */
export function copyAll(root: string, rules: readonly CopyRule[], dryRun = false): CopyResult {
  if (!existsSync(root)) return { ok: false, missing: true, files: 0, bytes: 0, refused: 0 };
  let files = 0;
  let bytes = 0;
  let refusedCount = 0;
  for (const rule of rules) {
    const { copy, refused: skipped } = plan(rule);
    refusedCount += skipped.length;
    for (const item of copy) {
      if (!dryRun) {
        mkdirSync(dirname(item.to), { recursive: true });
        copyFileSync(item.from, item.to);
      }
      files += 1;
      bytes += item.bytes;
    }
    if (!dryRun) for (const stale of staleDumps(rule)) rmSync(stale, { force: true });
  }
  return { ok: true, missing: false, files, bytes, refused: refusedCount };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--plan");
  const home = join(homedir(), ".mop-workforce");
  const rules = copyRules(home, join(DRIVE_ROOT, "Backups"), "E:/mop-backups");
  if (dryRun)
    for (const rule of rules) {
      const { copy, refused: skipped } = plan(rule);
      console.log(
        `${rule.name}: ${String(copy.length)} to copy, ${String(skipped.length)} refused`,
      );
    }
  const result = copyAll(DRIVE_ROOT, rules, dryRun);
  const stamp = new Date().toISOString();
  console.log(
    result.missing
      ? `${stamp} drive copy: the Drive folder ${DRIVE_ROOT} is missing; nothing copied`
      : `${stamp} drive copy: ${String(result.files)} files, ${String(result.bytes)} bytes${dryRun ? " (plan only)" : ""}, ${String(result.refused)} refused`,
  );
  if (dryRun) return;
  // The health check reads this beat (ops_health, `drive_copy`): a missing folder or no copy for a day is named there.
  const { serviceDb } = await import("./env.ts");
  const { error } = await serviceDb().rpc("beat", {
    p_name: "drive_copy",
    p_detail: { ...result, where: "laptop" },
  });
  if (error !== null) console.log(`drive copy: the heartbeat was not recorded (${error.message})`);
}

if (import.meta.main) await main();

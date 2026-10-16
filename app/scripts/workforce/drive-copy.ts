// W8 0g (operator, 2026-10-15: "using Google Drive to save a few things here and there that can work as a backup"): the
// nightly copy of what lives only on the laptop into the folder Google Drive for desktop mirrors. The rules name what
// is copied (an allow-list of folders and files), never what is left out; a second check refuses anything shaped like
// a secret even inside an allowed folder. Never the .env file, the creds folder, keys or tokens.
//   bun scripts/workforce/drive-copy.ts           copy, then beat `drive_copy` (ops_health names a stale or failed copy)
//   bun scripts/workforce/drive-copy.ts --plan    list what would be copied, copy nothing
// The nightly "MOP Backup" task runs it after the database dump (~/.mop-workforce/backup-local.mjs, ruling H122).
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, join, relative } from "node:path";

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
  /** Only files with these extensions (lower case, with the dot): what a piece of work or a note is made of. */
  types?: readonly string[];
  /** Only the newest `keep` files whose name matches `pattern` (the encrypted database dumps). */
  newest?: { pattern: RegExp; keep: number };
}

/** What a studio piece is made of (review, third finding of 2026-10-16): briefs, scenes, stills, finished films. */
const PIECE_TYPES = [
  ".json",
  ".md",
  ".txt",
  ".html",
  ".mjs",
  ".vtt",
  ".svg",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".mp4",
  ".wav",
];

/** The allow-list: each folder the copy may read, and where its copy goes under `Backups`. */
export function copyRules(home: string, backups: string, dumps: string): CopyRule[] {
  return [
    {
      name: "the studio, without render scratch",
      from: join(home, "studio"),
      to: join(backups, "Studio"),
      skipDirs: ["shots", "reference", "frames", "cache", ".cache", "tmp", "node_modules"],
      types: PIECE_TYPES,
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
      types: [".md", ".txt", ".json"],
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
  /(^|\/)\.(ssh|aws|claude|gnupg|config)(\/|$)/i,
  /(^|\/)\.(claude|git-credentials|npmrc|pgpass|netrc|envrc|bash_history)(\.json)?$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(ppk|keystore|jks|kdbx|gpg|asc)$/i,
  /(^|\/)[^/]*\.env([.-][^/]*)?$/i,
  /(^|\/)service-account[^/]*\.json$/i,
];

/** Text that looks like a key or a login wherever it sits: a file holding one is never copied (review, 2026-10-16). */
const SECRET_TEXT = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bsb_(secret|publishable)_[A-Za-z0-9_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\b(api[_-]?key|secret|token|password|passwd)["']?\s*[:=]\s*["']?[A-Za-z0-9_\-+/=.]{16,}/i,
];
const TEXT_TYPES = new Set([".json", ".md", ".txt", ".html", ".mjs", ".vtt", ".svg"]);
const SCAN_MAX_BYTES = 2_000_000;

/** Whether the text of a file looks like it holds a secret. */
export function holdsSecret(text: string): boolean {
  return SECRET_TEXT.some((shape) => shape.test(text));
}

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
  // a link or junction as a rule's own folder would copy whatever it points to (review, 2026-10-16)
  if (!existsSync(rule.from) || lstatSync(rule.from).isSymbolicLink())
    return { copy, refused: skipped };
  const consider = (from: string, to: string) => {
    const rel = relative(rule.from, from);
    const kind = lstatSync(from);
    if (kind.isSymbolicLink() || !kind.isFile()) {
      skipped.push(`${rel} (a link)`);
      return;
    }
    if (refused(rel)) {
      skipped.push(rel);
      return;
    }
    const type = extname(from).toLowerCase();
    if (rule.types !== undefined && !rule.types.includes(type)) return;
    if (
      TEXT_TYPES.has(type) &&
      kind.size <= SCAN_MAX_BYTES &&
      holdsSecret(readFileSync(from, "utf8"))
    ) {
      skipped.push(`${rel} (its text looks like a secret)`);
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
      if (existsSync(from)) consider(from, join(rule.to, file));
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
  /** Files that could not be copied (locked, Drive full): the rest are still copied and the beat says ok false. */
  failed: number;
  error?: string;
}

/** Copy every rule's plan; when the Drive folder is missing, copy nothing and say so. */
export function copyAll(root: string, rules: readonly CopyRule[], dryRun = false): CopyResult {
  if (!existsSync(root))
    return { ok: false, missing: true, files: 0, bytes: 0, refused: 0, failed: 0 };
  let files = 0;
  let bytes = 0;
  let refusedCount = 0;
  let failed = 0;
  let error: string | undefined;
  for (const rule of rules) {
    const { copy, refused: skipped } = plan(rule);
    refusedCount += skipped.length;
    for (const item of copy) {
      try {
        if (!dryRun) {
          mkdirSync(dirname(item.to), { recursive: true });
          copyFileSync(item.from, item.to);
        }
        files += 1;
        bytes += item.bytes;
      } catch (failure) {
        failed += 1;
        error ??=
          failure instanceof Error ? failure.message.slice(0, 200) : "a file could not be copied";
      }
    }
    if (!dryRun) for (const stale of staleDumps(rule)) rmSync(stale, { force: true });
  }
  return {
    ok: failed === 0,
    missing: false,
    files,
    bytes,
    refused: refusedCount,
    failed,
    ...(error === undefined ? {} : { error }),
  };
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
  let result: CopyResult;
  try {
    result = copyAll(DRIVE_ROOT, rules, dryRun);
  } catch (failure) {
    // a crash is beaten as a failure too, so the health check names it, never silence (review, 2026-10-16)
    result = {
      ok: false,
      missing: false,
      files: 0,
      bytes: 0,
      refused: 0,
      failed: 0,
      error: failure instanceof Error ? failure.message.slice(0, 200) : "the copy stopped",
    };
  }
  const stamp = new Date().toISOString();
  console.log(
    result.missing
      ? `${stamp} drive copy: the Drive folder ${DRIVE_ROOT} is missing; nothing copied`
      : `${stamp} drive copy: ${String(result.files)} files, ${String(result.bytes)} bytes${dryRun ? " (plan only)" : ""}, ${String(result.refused)} refused, ${String(result.failed)} failed${result.error === undefined ? "" : ` (${result.error})`}`,
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

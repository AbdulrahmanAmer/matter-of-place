// Pure checks of `bun run db:push` (scripts/db-push.mjs) and the branch check of `bun run db:reset` (B2 invariant 17,
// ruling H1, DB-01, E2E-06). Unit tested in tests/unit/db-push-guard.test.ts.
import { isProductionEnvironment } from "./assert-not-production.mjs";

export { findForeignMigrations } from "./reset-guard.mjs";

const VERSION = /^(\d{14})_/;

/**
 * The `.sql` file names among paths or names (`git ls-tree` lines, `readdirSync` entries), sorted.
 * @param {string[]} paths
 * @returns {string[]}
 */
export function migrationFiles(paths) {
  return paths
    .map((path) => path.slice(path.lastIndexOf("/") + 1).trim())
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * @param {string} file
 * @returns {string | undefined}
 */
export function migrationVersion(file) {
  return VERSION.exec(file)?.[1];
}

/**
 * File names in one list and not the other: migrations this branch holds that `origin/main` does not, and the reverse.
 * @param {string[]} localFiles
 * @param {string[]} mainFiles
 * @returns {string[]}
 */
export function findBranchMigrations(localFiles, mainFiles) {
  const local = new Set(localFiles);
  const main = new Set(mainFiles);
  return [
    ...localFiles.filter((file) => !main.has(file)),
    ...mainFiles.filter((file) => !local.has(file)),
  ].sort();
}

/**
 * Local files not yet applied whose version sorts before the newest applied one: the CLI would refuse them.
 * @param {string[]} remoteVersions
 * @param {string[]} localFiles
 * @returns {string[]}
 */
export function findOutOfOrder(remoteVersions, localFiles) {
  const applied = new Set(remoteVersions);
  const newest = [...remoteVersions].sort().at(-1);
  if (newest === undefined) return [];
  return localFiles.filter((file) => {
    const version = migrationVersion(file);
    return version !== undefined && !applied.has(version) && version < newest;
  });
}

/**
 * Applied versions whose recorded sha256 differs from the sha256 of the local file.
 * @param {{ version: string, sha256: string }[]} checksums
 * @param {{ file: string, sha256: string }[]} fileHashes
 * @returns {string[]}
 */
export function findChecksumDrift(checksums, fileHashes) {
  const current = new Map(fileHashes.map(({ file, sha256 }) => [migrationVersion(file), sha256]));
  return checksums
    .filter(({ version, sha256 }) => current.has(version) && current.get(version) !== sha256)
    .map(({ version }) => version);
}

/**
 * The branch check is skipped only while one lane is open and the database is not yet production (ruling H35).
 * @param {{ singleLane: boolean, environment: string | null }} stage
 * @returns {boolean}
 */
export function shouldCheckBranch({ singleLane, environment }) {
  return !singleLane || isProductionEnvironment(environment);
}

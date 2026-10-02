// Pure checks of `bun run db:reset` (scripts/db-reset-dev.mjs), unit tested in tests/unit/reset-guard.test.ts.
// Production is not decided here: that is assert-not-production.mjs (B2 invariant 23, ruling H35).

const POOLER_USER = /^postgres\.([a-z0-9]+)$/;
const CRON_SCHEDULE = /cron\.schedule\(\s*'([^']+)'/g;
const VERSION = /^(\d{14})_/;

/**
 * Throws `refusing: ref mismatch` unless the linked project, `DEV_SUPABASE_PROJECT_REF` and the user of `DEV_DB_URL`
 * (`postgres.<ref>` on the session pooler) all name the same project.
 * @param {{ linkedRef: string | undefined, envRef: string | undefined, dbUrlUser: string | undefined }} target
 */
export function checkResetTarget({ linkedRef, envRef, dbUrlUser }) {
  const urlRef = POOLER_USER.exec(dbUrlUser ?? "")?.[1];
  const refs = [linkedRef, envRef, urlRef];
  if (refs.some((ref) => ref === undefined || ref === "") || new Set(refs).size !== 1) {
    throw new Error(
      `refusing: ref mismatch (linked ${linkedRef ?? "none"}, DEV_SUPABASE_PROJECT_REF ${envRef ?? "none"}, DEV_DB_URL user ${urlRef ?? "none"})`,
    );
  }
}

/**
 * Applied versions that have no file in the local `supabase/migrations`: history this branch would erase.
 * @param {string[]} remoteVersions
 * @param {string[]} localFiles
 * @returns {string[]}
 */
export function findForeignMigrations(remoteVersions, localFiles) {
  const local = new Set(localFiles.map((file) => VERSION.exec(file)?.[1]));
  return remoteVersions.filter((version) => !local.has(version));
}

/**
 * Names of the pg_cron jobs the migrations schedule, so a reset unschedules jobs of later slices without an edit here.
 * @param {string[]} sqlTexts
 * @returns {string[]}
 */
export function cronJobNames(sqlTexts) {
  const names = sqlTexts.flatMap((text) =>
    [...text.matchAll(CRON_SCHEDULE)].map((match) => match[1] ?? ""),
  );
  return [...new Set(names)];
}

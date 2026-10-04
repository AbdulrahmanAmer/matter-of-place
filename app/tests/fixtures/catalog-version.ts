import pg from "pg";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";

// The bump writes the settings row, so the guard runs before the first one of a process, not before each of up to five.
let checked: Promise<void> | undefined;

/**
 * Moves the catalog version the way a catalog edit does, through the database function over `DEV_DB_URL`. A page the
 * Worker stored under the old version is never answered again, so the next request renders it from the running build:
 * without this, a Worker that kept its cache from an earlier build (wrangler persists it) answers the old page.
 * Refuses on a production database: a bump empties the live site's whole edge cache.
 */
export async function bumpCatalogVersion(): Promise<void> {
  checked ??= assertNotProduction();
  await checked;
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("select public.bump_catalog_version()");
  } finally {
    await db.end();
  }
}

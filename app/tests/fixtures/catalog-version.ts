import pg from "pg";

/**
 * Moves the catalog version the way a catalog edit does, through the database function over `DEV_DB_URL`. A page the
 * Worker stored under the old version is never answered again, so the next request renders it from the running build:
 * without this, a Worker that kept its cache from an earlier build (wrangler persists it) answers the old page.
 */
export async function bumpCatalogVersion(): Promise<void> {
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

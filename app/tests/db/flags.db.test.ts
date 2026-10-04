// GQ-05: the `flags` settings row exists with every feature flag false, and a change to it moves catalog_version
// once through B2's settings trigger (F25 a).
import { describe, expect, it } from "vitest";
import { withRollback, type Db } from "../fixtures/db";

async function catalogVersion(db: Db): Promise<number> {
  const read = await db.query<{ version: string }>(
    "select value #>> '{}' as version from public.settings where key = 'catalog_version'",
  );
  const version = read.rows[0]?.version;
  if (version === undefined) throw new Error("no catalog_version row");
  return Number(version);
}

describe("settings.flags", () => {
  it("exists with new_channels and archive_pages false", async () => {
    const rows = await withRollback(
      async (db) =>
        (
          await db.query<{ value: unknown }>(
            "select value from public.settings where key = 'flags'",
          )
        ).rows,
    );
    expect(rows).toEqual([{ value: { new_channels: false, archive_pages: false } }]);
  });

  it("an update of the row bumps catalog_version once", async () => {
    const outcome = await withRollback(async (db) => {
      const before = await catalogVersion(db);
      const updated = await db.query(
        `update public.settings set value = value || '{"archive_pages": true}'::jsonb where key = 'flags'`,
      );
      return { rows: updated.rowCount, bumps: (await catalogVersion(db)) - before };
    });
    expect(outcome).toEqual({ rows: 1, bumps: 1 });
  });
});

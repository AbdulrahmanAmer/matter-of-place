// B7 invariant 17 (the caching contract, admin side): every admin list filters and sorts on an index its own migration
// creates. Later steps add the catalog_version cases and the one-call dashboard here.
import { describe, expect, it } from "vitest";
import { withRollback } from "../fixtures/db";

describe("admin list indexes", () => {
  it("the submissions list index leads with the state and pages by received_at desc, id", async () => {
    const definitions = await withRollback(async (db) =>
      (
        await db.query<{ indexdef: string }>(
          `select indexdef from pg_indexes
           where schemaname = 'public' and tablename = 'submissions' and indexname = 'submissions_list_idx'`,
        )
      ).rows.map((row) => row.indexdef),
    );
    expect(definitions).toEqual([
      "CREATE INDEX submissions_list_idx ON public.submissions USING btree (workflow_state, received_at DESC, id)",
    ]);
  });
});

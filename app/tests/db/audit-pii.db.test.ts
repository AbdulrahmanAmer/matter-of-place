// DB-03, invariant 18: `write_audit` keeps only the changed keys plus `id`, and stores `{"pii": "changed"}` instead of
// the value of every column `pii_columns` lists for the entity's table. Every case runs in one rolled-back
// transaction (F22). No admin write function exists before step 4, so the cases call `write_audit` directly.
import { describe, expect, it } from "vitest";
import { dbNow, withRollback, type Db } from "../fixtures/db";
import { createSubmission } from "../fixtures/factories";

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

/** The id of the system row `write_audit` writes; read in a later statement, which sees the insert. */
async function audited(db: Db, entity: string, before: object, after: object): Promise<string> {
  return (
    await one<{ id: string }>(
      db,
      "select public.write_audit(null, null, 'probe.update', $1, null, $2, $3, 'req-pii') as id",
      [entity, before, after],
    )
  ).id;
}

describe("write_audit and personal data", () => {
  it("stores no plaintext value of any pii_columns row, under the table name or its singular", async () => {
    await withRollback(async (db) => {
      const { rows } = await db.query<{ table_name: string; column_name: string }>(
        "select table_name, column_name from public.pii_columns order by 1, 2",
      );
      expect(rows.length).toBeGreaterThan(0);
      const leaks: string[] = [];
      for (const [index, { table_name: table, column_name: column }] of rows.entries()) {
        const before = `plain-before-${String(index)}@example.invalid`;
        const after = `plain-after-${String(index)}@example.invalid`;
        const singular = table.replace(/ies$/, "y").replace(/s$/, "");
        for (const entity of [table, singular]) {
          const { stored } = await one<{ stored: string }>(
            db,
            "select before::text || after::text as stored from public.audit_log where id = $1",
            [
              await audited(
                db,
                entity,
                { id: "x", [column]: before },
                { id: "x", [column]: after },
              ),
            ],
          );
          if (
            stored.includes(before) ||
            stored.includes(after) ||
            !stored.includes('"pii": "changed"')
          ) {
            leaks.push(`${entity}.${column}: ${stored}`);
          }
        }
      }
      expect(leaks).toEqual([]);
    });
  });

  it("an update of submissions.submitter_email keeps only the changed keys plus id, the email as pii changed", async () => {
    await withRollback(async (db) => {
      const id = await createSubmission(db, {
        state: "Under Review",
        n: 9702,
        base: await dbNow(db),
      });
      const { before } = await one<{ before: Record<string, unknown> }>(
        db,
        "select to_jsonb(s) as before from public.submissions s where s.id = $1",
        [id],
      );
      const address = "new.owner.address@example.invalid";
      const after = { ...before, submitter_email: address, city: "Montecito" };
      const row = await one<{ before: unknown; after: unknown; text: string }>(
        db,
        "select before, after, before::text || after::text as text from public.audit_log where id = $1",
        [await audited(db, "submission", before, after)],
      );
      expect(row.text).not.toContain(address);
      expect(row.text).not.toContain(String(before["submitter_email"]));
      expect({ before: row.before, after: row.after }).toEqual({
        before: { id, submitter_email: { pii: "changed" }, city: before["city"] },
        after: { id, submitter_email: { pii: "changed" }, city: "Montecito" },
      });
    });
  });
});

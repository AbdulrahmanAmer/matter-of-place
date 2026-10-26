// W8 0f (the studio folder): one small row per piece, written only by studio_piece_put under the service role. It is an
// upsert by the brief's id, a change of state is audited once, and a state outside the list is refused. Every case runs in
// a rolled-back transaction through the harness (F22).
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createStaffUser, withRollback, type Db } from "../fixtures/db";

const CALL = `select public.studio_piece_put($1, $2, 'social', $3, $4, 'Matter reviews draft 1.', $5)`;

async function put(
  db: Db,
  over: { id: string; title?: string; state?: string; folder?: string; preview?: string | null },
): Promise<void> {
  await db.query(CALL, [
    over.id,
    over.title ?? "Fairfield stair",
    over.state ?? "draft",
    over.folder ?? `w8-0f-${over.id}`,
    over.preview ?? null,
  ]);
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable (G-102). */
async function attempt(db: Db, sql: string, params: unknown[] = []): Promise<string> {
  await db.query("savepoint attempt");
  try {
    await db.query(sql, params);
    await db.query("release savepoint attempt");
    return "ok";
  } catch (error) {
    await db.query("rollback to savepoint attempt");
    if (error instanceof pg.DatabaseError) return `${error.code ?? ""} ${error.message}`;
    throw error;
  }
}

const auditOf = async (db: Db, id: string) =>
  (
    await db.query<{ before: unknown; after: unknown }>(
      "select before, after from public.audit_log where entity = 'studio_pieces' and entity_id = $1 order by id",
      [id],
    )
  ).rows;

describe("studio_piece_put", () => {
  it("writes the piece's row and audits its first state", async () => {
    await withRollback(async (db) => {
      const id = randomUUID();
      await put(db, { id });
      const row = (
        await db.query<{
          title: string;
          owner_slug: string;
          state: string;
          folder: string;
          note: string;
        }>(
          "select title, owner_slug, state, folder, note from public.studio_pieces where id = $1",
          [id],
        )
      ).rows;
      expect(row).toEqual([
        {
          title: "Fairfield stair",
          owner_slug: "social",
          state: "draft",
          folder: `w8-0f-${id}`,
          note: "Matter reviews draft 1.",
        },
      ]);
      expect(await auditOf(db, id)).toEqual([{ before: null, after: { state: "draft" } }]);
    });
  });

  it("is an upsert: the same piece again changes its row, and only a change of state is audited", async () => {
    await withRollback(async (db) => {
      const id = randomUUID();
      await put(db, { id });
      await put(db, { id, preview: "studio/x/preview.ab12cd34.jpg" });
      await put(db, { id, state: "done", title: "Fairfield stair, revised" });
      const rows = (
        await db.query<{ title: string; state: string; preview_key: string | null }>(
          "select title, state, preview_key from public.studio_pieces where id = $1",
          [id],
        )
      ).rows;
      expect(rows).toEqual([
        { title: "Fairfield stair, revised", state: "done", preview_key: null },
      ]);
      expect(await auditOf(db, id)).toEqual([
        { before: null, after: { state: "draft" } },
        { before: { state: "draft" }, after: { state: "done" } },
      ]);
    });
  });

  it("keeps the preview a waiting piece was given", async () => {
    await withRollback(async (db) => {
      const id = randomUUID();
      await put(db, { id, state: "waiting_operator", preview: "studio/x/preview.ab12cd34.jpg" });
      const key = (
        await db.query<{ preview_key: string }>(
          "select preview_key from public.studio_pieces where id = $1",
          [id],
        )
      ).rows[0]?.preview_key;
      expect(key).toBe("studio/x/preview.ab12cd34.jpg");
    });
  });

  it("refuses a state outside the list, a blank title and a folder that is a path", async () => {
    await withRollback(async (db) => {
      const id = randomUUID();
      const outcomes = [
        await attempt(db, CALL, [id, "T", "published", "w8-0f-a", null]),
        await attempt(db, CALL, [id, "  ", "draft", "w8-0f-a", null]),
        await attempt(db, CALL, [id, "T", "draft", "../desks/social", null]),
      ];
      expect(outcomes[0]).toBe("P0001 bad_request");
      expect(outcomes[1]).toBe("P0001 bad_request");
      expect(outcomes[2]).toMatch(/^23514 .*studio_pieces_folder_check/);
      expect(
        (await db.query("select 1 from public.studio_pieces where id = $1", [id])).rowCount,
      ).toBe(0);
    });
  });

  it("lets staff read the rows and nobody write them, and anon and authenticated cannot execute it", async () => {
    await withRollback(async (db) => {
      const id = randomUUID();
      await put(db, { id });
      const staff = await createStaffUser(db, ["media_ops"]);
      const seen: string[] = [];
      for (const role of ["anon", "authenticated"] as const) {
        await db.query("savepoint as_role");
        await asRole(db, role, role === "authenticated" ? staff : undefined);
        seen.push(await attempt(db, CALL, [id, "T", "done", "w8-0f-b", null]));
        await db.query("rollback to savepoint as_role");
      }
      expect(seen).toEqual([
        "42501 permission denied for function studio_piece_put",
        "42501 permission denied for function studio_piece_put",
      ]);
      await asRole(db, "authenticated", staff);
      const read = await db.query("select id from public.studio_pieces where id = $1", [id]);
      expect(read.rowCount).toBe(1);
      expect(
        await attempt(db, "update public.studio_pieces set title = 'x' where id = $1", [id]),
      ).toMatch(/^42501 permission denied for table studio_pieces/);
    });
  });
});

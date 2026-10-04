// The interest signups per market (B3b Data changes): `market_interest_counts` counts each live signup once for every
// market it names, splits confirmed from pending, and runs with the caller's rights, so only staff read it.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { asRole, createAuthUser, createStaffUser, withRollback, type Db } from "../fixtures/db";

type Counts = Record<string, { total: number; confirmed: number; pending: number }>;

/** The view as the current role; a database that already holds signups is read as a starting point. */
async function counts(db: Db): Promise<Counts> {
  const read = await db.query<{
    market_slug: string;
    total: string;
    confirmed: string;
    pending: string;
  }>("select market_slug, total, confirmed, pending from public.market_interest_counts");
  return Object.fromEntries(
    read.rows.map((row) => [
      row.market_slug,
      { total: Number(row.total), confirmed: Number(row.confirmed), pending: Number(row.pending) },
    ]),
  );
}

/** What the signups planted since `before` added, per market. */
function added(before: Counts, after: Counts): Counts {
  return Object.fromEntries(
    Object.entries(after).flatMap(([market, now]) => {
      const was = before[market] ?? { total: 0, confirmed: 0, pending: 0 };
      const delta = {
        total: now.total - was.total,
        confirmed: now.confirmed - was.confirmed,
        pending: now.pending - was.pending,
      };
      return delta.total === 0 && delta.confirmed === 0 ? [] : [[market, delta]];
    }),
  );
}

async function signup(db: Db, n: number, markets: string[]): Promise<void> {
  await db.query(
    "insert into public.subscribers (email, source, markets) values ($1, 'interest:home', $2::text[])",
    [`test+b3b-${String(n)}@fixtures.invalid`, markets],
  );
}

const CALIFORNIA_TWO_FLORIDA_ONE = {
  california: { total: 2, confirmed: 0, pending: 2 },
  florida: { total: 1, confirmed: 0, pending: 1 },
};

describe("market_interest_counts", () => {
  it("counts one signup for california and one for california and florida as 2 and 1", async () => {
    const delta = await withRollback(async (db) => {
      const before = await counts(db);
      await signup(db, 1, ["california"]);
      await signup(db, 2, ["california", "florida"]);
      return added(before, await counts(db));
    });
    expect(delta).toEqual(CALIFORNIA_TWO_FLORIDA_ONE);
  });

  it("moves a confirmed signup from pending to confirmed", async () => {
    const delta = await withRollback(async (db) => {
      const before = await counts(db);
      await signup(db, 1, ["new-york"]);
      await db.query(
        "update public.subscribers set confirmed_at = now() where email = 'test+b3b-1@fixtures.invalid'",
      );
      return added(before, await counts(db));
    });
    expect(delta).toEqual({ "new-york": { total: 1, confirmed: 1, pending: 0 } });
  });

  it("does not count an unsubscribed or an archived signup", async () => {
    const delta = await withRollback(async (db) => {
      const before = await counts(db);
      await signup(db, 1, ["florida"]);
      await signup(db, 2, ["florida"]);
      await db.query(
        "update public.subscribers set unsubscribed_at = now() where email = 'test+b3b-1@fixtures.invalid'",
      );
      await db.query(
        "update public.subscribers set archived_at = now() where email = 'test+b3b-2@fixtures.invalid'",
      );
      return added(before, await counts(db));
    });
    expect(delta).toEqual({});
  });

  it("refuses anon, shows a staff user the counts and a signed-in non-staff user none", async () => {
    const outcome = await withRollback(async (db) => {
      const staff = await createStaffUser(db, ["managing_editor"]);
      const visitor = await createAuthUser(db);
      const before = await counts(db);
      await signup(db, 1, ["california"]);
      await signup(db, 2, ["california", "florida"]);

      await db.query("savepoint role");
      await asRole(db, "anon");
      let anon = "ok";
      try {
        await counts(db);
      } catch (error) {
        if (!(error instanceof pg.DatabaseError)) throw error;
        anon = `${error.code ?? ""} ${error.message}`;
      }
      await db.query("rollback to savepoint role");

      await db.query("savepoint role");
      await asRole(db, "authenticated", staff);
      const asStaff = added(before, await counts(db));
      await db.query("rollback to savepoint role");

      await asRole(db, "authenticated", visitor);
      return { anon, asStaff, asVisitor: await counts(db) };
    });
    expect(outcome).toEqual({
      anon: "42501 permission denied for view market_interest_counts",
      asStaff: CALIFORNIA_TWO_FLORIDA_ONE,
      asVisitor: {},
    });
  });
});

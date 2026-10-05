import { describe, expect, it } from "vitest";
import { deterministicUuid } from "../fixtures/clock";
import { dbNow, withRollback, type Db } from "../fixtures/db";
import { fixtureDataset, loadDataset } from "../fixtures/dataset";
import { createSubmission, removeFixtureRows } from "../fixtures/factories";

// GQ-03: every case runs inside one rolled-back transaction (invariant 4); none is committed.
const FIXTURE_IDS =
  "select count(*)::int as count, md5(string_agg(id::text, ',' order by id)) as hash from public.submissions where submitter_email like '%@fixtures.invalid'";
const datasetIds = fixtureDataset.submissions.map(({ n }) =>
  deterministicUuid("fixtures:submission", n),
);

async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T & Record<string, unknown>>(sql, params)).rows[0];
}

async function datasetRows(db: Db): Promise<Record<string, unknown>[]> {
  const result = await db.query<Record<string, unknown>>(
    "select * from public.submissions where id = any($1::uuid[]) order by id",
    [datasetIds],
  );
  return result.rows;
}

describe("loadDataset", () => {
  it("leaves the same rows when it runs twice: same ids, same hash", async () => {
    const seen = await withRollback(async (db) => {
      const counts = [await loadDataset(db)];
      const first = { ids: await one(db, FIXTURE_IDS), rows: await datasetRows(db) };
      counts.push(await loadDataset(db));
      const second = { ids: await one(db, FIXTURE_IDS), rows: await datasetRows(db) };
      return { counts, first, second };
    });
    expect(seen.counts).toEqual([
      [{ table: "submissions", count: datasetIds.length }],
      [{ table: "submissions", count: datasetIds.length }],
    ]);
    expect(seen.second).toEqual(seen.first);
  });
});

describe("createSubmission", () => {
  it("inserts a row the constraints accept at every workflow state, linked to its contact", async () => {
    const rows = await withRollback(async (db) => {
      const base = await dbNow(db);
      const found = [];
      for (const [index, { state }] of fixtureDataset.submissions.entries()) {
        const id = await createSubmission(db, { state, n: 500 + index, base });
        found.push(
          await one(
            db,
            `select s.workflow_state, c.email = lower(s.submitter_email) as linked
             from public.submissions s join public.contacts c on c.id = s.contact_id where s.id = $1`,
            [id],
          ),
        );
      }
      return found;
    });
    expect(rows).toEqual(
      fixtureDataset.submissions.map(({ state }) => ({ workflow_state: state, linked: true })),
    );
  });

  it("gives the gate an accepted row it lets move on, and takes an owner without a brokerage", async () => {
    const moved = await withRollback(async (db) => {
      const base = await dbNow(db);
      const accepted = await createSubmission(db, { state: "Accepted", n: 601, base });
      await db.query(
        "update public.submissions set workflow_state = 'Invoice Issued' where id = $1",
        [accepted],
      );
      const owner = await createSubmission(db, {
        state: "Submitted",
        n: 602,
        base,
        submitter_kind: "owner",
        brokerage: null,
      });
      const read = (id: string) =>
        one(
          db,
          "select workflow_state, submitter_kind, brokerage from public.submissions where id = $1",
          [id],
        );
      return { accepted: await read(accepted), owner: await read(owner) };
    });
    expect(moved).toEqual({
      accepted: {
        workflow_state: "Invoice Issued",
        submitter_kind: "agent",
        brokerage: "Fixture Brokerage",
      },
      owner: { workflow_state: "Submitted", submitter_kind: "owner", brokerage: null },
    });
  });
});

describe("removeFixtureRows", () => {
  it("leaves zero rows with the marker in each table it deletes from", async () => {
    const seen = await withRollback(async (db) => {
      const base = await dbNow(db);
      const submission = await createSubmission(db, { state: "Accepted", n: 701, base });
      await db.query(
        "insert into public.payments (submission_id, product, amount) values ($1, 'The Feature', 1)",
        [submission],
      );
      await db.query(
        "insert into public.inquiries (intent, name, email, message, source_path) values ('general', 'Fixture', 'reader+701@fixtures.invalid', 'A question.', '/contact')",
      );
      await db.query(
        "insert into public.subscribers (email, source) values ('reader+701@fixtures.invalid', 'home')",
      );
      const counts = await removeFixtureRows(db);
      const left = await one(
        db,
        `select
           (select count(*)::int from public.payments where submission_id = $1) as payments,
           (select count(*)::int from public.submissions where submitter_email like '%@fixtures.invalid') as submissions,
           (select count(*)::int from public.contacts c where c.email like '%@fixtures.invalid'
              and not exists (select 1 from public.submissions s where s.contact_id = c.id)) as contacts,
           (select count(*)::int from public.inquiries where email like '%@fixtures.invalid') as inquiries,
           (select count(*)::int from public.subscribers where email like '%@fixtures.invalid') as subscribers`,
        [submission],
      );
      return { counts, left };
    });
    expect(seen.left).toEqual({
      payments: 0,
      submissions: 0,
      contacts: 0,
      inquiries: 0,
      subscribers: 0,
    });
    expect(
      [
        seen.counts.payments,
        seen.counts.submissions,
        seen.counts.contacts,
        seen.counts.inquiries,
        seen.counts.subscribers,
      ].every((count) => count >= 1),
    ).toBe(true);
  });

  it("keeps a contact that a submission it does not match still uses", async () => {
    const seen = await withRollback(async (db) => {
      const id = await createSubmission(db, {
        state: "Submitted",
        n: 702,
        base: await dbNow(db),
        submitter_email: "Fixture+702@FIXTURES.invalid",
      });
      await removeFixtureRows(db);
      return one<{ count: number }>(
        db,
        `select count(*)::int as count from public.submissions s
         join public.contacts c on c.id = s.contact_id where s.id = $1`,
        [id],
      );
    });
    expect(seen).toEqual({ count: 1 });
  });

  it("removes fixture jobs only with the default pattern", async () => {
    const seen = await withRollback(async (db) => {
      await db.query(
        "insert into public.jobs (type, idempotency_key) values ('fixture', 'fixtures:job-1')",
      );
      const jobsLeft = async () =>
        (
          await one<{ count: number }>(
            db,
            "select count(*)::int as count from public.jobs where idempotency_key like 'fixtures:%'",
          )
        )?.count;
      const live = await removeFixtureRows(db, { emailLike: "e2e+%@fixtures.invalid" });
      const afterLive = await jobsLeft();
      const all = await removeFixtureRows(db);
      return { live: live.jobs, afterLive, all: all.jobs, afterAll: await jobsLeft() };
    });
    expect(seen).toEqual({ live: 0, afterLive: 1, all: 1, afterAll: 0 });
  });
});

describe("withRollback (the harness proof)", () => {
  it("leaves no fixture row behind once it returns", async () => {
    const id = await withRollback(async (db) =>
      createSubmission(db, { state: "Submitted", n: 801, base: await dbNow(db) }),
    );
    const after = await withRollback((db) =>
      one<{ count: number }>(
        db,
        "select count(*)::int as count from public.submissions where id = $1",
        [id],
      ),
    );
    expect(after).toEqual({ count: 0 });
  });
});

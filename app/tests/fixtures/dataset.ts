// The named deterministic data set the admin and e2e specs load (B4 step 8, GQ-03): one submission per workflow state.
// B6 adds three invoices and B8 seven jobs through their own factories (G24); the counts print in that order.
import pg from "pg";
import { submissionTransitions, type WorkflowState } from "../../src/domain/workflow";
import { dbNow, type Db } from "./db";
import { createSubmission, removeFixtureRows } from "./factories";

const states = Object.keys(submissionTransitions).filter(
  (state): state is WorkflowState => state in submissionTransitions,
);

export const fixtureDataset = {
  submissions: states.map((state, index) => ({ state, n: index + 1 })),
};

export interface TableCount {
  table: string;
  count: number;
}

/** Upserts the data set by its deterministic ids, dated from one `dbNow(db)`; returns the rows now present per table. */
export async function loadDataset(db: Db): Promise<TableCount[]> {
  const base = await dbNow(db);
  const ids: string[] = [];
  for (const submission of fixtureDataset.submissions) {
    ids.push(await createSubmission(db, { ...submission, base }));
  }
  const present = await db.query<{ count: number }>(
    "select count(*)::int as count from public.submissions where id = any($1::uuid[])",
    [ids],
  );
  return [{ table: "submissions", count: present.rows[0]?.count ?? 0 }];
}

/** Removes every fixture row first, in the same transaction, then loads the data set again. */
export async function resetDataset(db: Db): Promise<TableCount[]> {
  await removeFixtureRows(db);
  return loadDataset(db);
}

export function formatCounts(counts: TableCount[]): string {
  return counts.map(({ table, count }) => `${table} ${String(count)}`).join(", ");
}

/**
 * Commits the data set to the database of DEV_DB_URL in one transaction. The callers have already called the
 * production guard and hold the writer lock (invariant 4, G34).
 */
export async function commitDataset({ reset }: { reset: boolean }): Promise<TableCount[]> {
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await db.query("begin");
    try {
      const counts = reset ? await resetDataset(db) : await loadDataset(db);
      await db.query("commit");
      return counts;
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  } finally {
    await db.end();
  }
}

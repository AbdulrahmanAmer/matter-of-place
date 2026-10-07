// The named deterministic data set the admin and e2e specs load (B4 step 8, GQ-03): one submission per workflow state.
// B6 adds three invoices and B8 seven jobs through their own factories (G24); the counts print in that order.
import pg from "pg";
import { submissionTransitions, type WorkflowState } from "../../src/domain/workflow";
import { dbNow, type Db } from "./db";
import { createInvoice, createSubmission, removeFixtureRows } from "./factories";

const states = Object.keys(submissionTransitions).filter(
  (state): state is WorkflowState => state in submissionTransitions,
);

const submissions = states.map((state, index) => ({ state, n: index + 1 }));

/** The `n` of the data set's submission in `state`. */
function submissionIn(state: WorkflowState): number {
  const found = submissions.find((submission) => submission.state === state);
  if (found === undefined) throw new Error(`the data set has no ${state} submission`);
  return found.n;
}

export const fixtureDataset = {
  submissions,
  // B6: one invoice per payment state a request in that workflow state holds.
  invoices: [
    { status: "due", submission: submissionIn("Invoice Issued"), n: 1 },
    { status: "paid", submission: submissionIn("Scheduled"), n: 2 },
    { status: "waived", submission: submissionIn("Published"), n: 3 },
  ] as const,
};

export interface TableCount {
  table: string;
  count: number;
}

/** Upserts the data set by its deterministic ids, dated from one `dbNow(db)`; returns the rows now present per table. */
export async function loadDataset(db: Db): Promise<TableCount[]> {
  const base = await dbNow(db);
  const ids = new Map<number, string>();
  for (const submission of fixtureDataset.submissions) {
    ids.set(submission.n, await createSubmission(db, { ...submission, base }));
  }
  const invoiceIds: string[] = [];
  for (const { submission, ...invoice } of fixtureDataset.invoices) {
    const submissionId = ids.get(submission);
    if (submissionId === undefined)
      throw new Error(`no submission ${String(submission)} for an invoice`);
    invoiceIds.push(await createInvoice(db, { ...invoice, submission: submissionId }));
  }
  const present = await db.query<{ submissions: number; invoices: number }>(
    `select (select count(*)::int from public.submissions where id = any($1::uuid[])) as submissions,
       (select count(*)::int from public.payments where id = any($2::uuid[])) as invoices`,
    [[...ids.values()], invoiceIds],
  );
  const row = present.rows[0];
  return [
    { table: "submissions", count: row?.submissions ?? 0 },
    { table: "invoices", count: row?.invoices ?? 0 },
  ];
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

// B6 step 1: the invoicing functions, the gate they meet and the reads screen 5 uses (migrations `invoicing_enum` and
// `invoicing`). Every case runs in one rolled-back transaction except the parallel numbering case and the concurrent
// activate case, which commit through `committed()` and remove what they made (audit_log rows stay: it is append-only).
import pg from "pg";
import { describe, expect, it } from "vitest";
import { atFrom, deterministicUuid } from "../fixtures/clock";
import { asRole, committed, createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import { createInvoice, createSubmission, publishedPropertyRow } from "../fixtures/factories";

type Product = "The Feature" | "The Reach" | "The Campaign" | "Five Features";

interface Issued {
  payment_id: string;
  event_id: string;
}

const SNAPSHOT = { entity: "Fixture Entity LLC", description: "The Feature" };
const PRICE: Record<Product, number> = {
  "The Feature": 295,
  "The Reach": 695,
  "The Campaign": 1495,
  "Five Features": 1250,
};
const YEAR = "extract(year from now() at time zone 'utc')::integer";

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
}

async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(db, `select count(*)::int as n from ${sql}`, params)).n;
}

/** Runs `sql` under a savepoint and returns `ok` or `<SQLSTATE> <message>`; the transaction stays usable. */
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

// The matrix rows of step 3's `permissions/payments.ts`, which regenerates `action_roles`; once that migration is on
// the database each insert does nothing.
const PAYMENT_ACTIONS = [
  ["payments.issue", ["managing_editor", "admin"], false],
  ["payments.mark_paid", ["managing_editor", "admin"], true],
  ["payments.waive", ["managing_editor", "admin"], true],
  ["payments.void", ["admin"], true],
  ["submissions.activate", ["managing_editor", "admin"], true],
] as const;

/** An admin who may run every payment action, inside the caller's transaction. */
async function admin(db: Db): Promise<string> {
  for (const [action, roles, humanOnly] of PAYMENT_ACTIONS) {
    await db.query(
      `insert into public.action_roles (action, roles, human_only) values ($1, $2::public.app_role[], $3)
       on conflict (action) do nothing`,
      [action, roles, humanOnly],
    );
  }
  return createStaffUser(db, ["admin"]);
}

const ISSUE =
  "select * from public.issue_invoice($1, $2, $3, 'bank_transfer', $4, $5, 'human', 'req-payments-db')";

function issue(
  db: Db,
  submission: string,
  actor: string | null,
  product: Product = "The Feature",
): Promise<Issued> {
  return one<Issued>(db, ISSUE, [
    submission,
    product,
    PRICE[product],
    JSON.stringify(SNAPSHOT),
    actor,
  ]);
}

function markPaid(db: Db, payment: string, actor: string): Promise<Issued> {
  return one<Issued>(
    db,
    "select * from public.mark_payment_paid($1, now(), 'wire', 'REF-1', $2, 'human', 'req-payments-db')",
    [payment, actor],
  );
}

function waive(db: Db, payment: string, actor: string): Promise<Issued> {
  return one<Issued>(
    db,
    "select * from public.waive_payment($1, 'Five Features credit', $2, 'human', 'req-payments-db')",
    [payment, actor],
  );
}

function voidPayment(db: Db, payment: string, actor: string): Promise<Issued> {
  return one<Issued>(
    db,
    "select * from public.void_payment($1, 'issued in error', $2, 'human', 'req-payments-db')",
    [payment, actor],
  );
}

interface Activated {
  property_id: string;
  event_id: string | null;
  copy_job_id: string | null;
}

function activate(db: Db, submission: string, actor: string | null): Promise<Activated> {
  return one<Activated>(
    db,
    "select * from public.activate_submission($1, $2, 'human', 'req-payments-db')",
    [submission, actor],
  );
}

async function invoiceNumber(db: Db, payment: string): Promise<number> {
  const { invoice_number } = await one<{ invoice_number: string }>(
    db,
    "select invoice_number from public.payments where id = $1",
    [payment],
  );
  return Number(invoice_number.split("-")[2]);
}

/**
 * A draft property made from `submission` and linked to it, standing where B7's `create_property_from_submission`
 * would put one, so activation takes its path for a request that already has its property.
 */
async function linkedDraft(db: Db, submission: string, n: number): Promise<string> {
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    `insert into public.regions (slug, market_slug, name, intro) values ('bay-area', 'california', 'Bay Area', 'x')
     on conflict (slug) do nothing`,
  );
  const row = publishedPropertyRow({ n, editorial_state: "draft", submission_id: submission });
  const entries = Object.entries(row);
  const { id } = await one<{ id: string }>(
    db,
    `insert into public.properties (${entries.map(([column]) => column).join(", ")})
     values (${entries.map((_, index) => `$${String(index + 1)}`).join(", ")}) returning id`,
    entries.map(([, value]) => value),
  );
  await db.query("update public.submissions set property_id = $2 where id = $1", [submission, id]);
  return id;
}

/** A request in Invoice Issued with a paid invoice of `product`, made through the real functions. */
async function paidRequest(
  db: Db,
  actor: string,
  n: number,
  product: Product,
): Promise<{ submission: string; payment: string }> {
  const submission = await createSubmission(db, {
    state: "Accepted",
    n,
    base: await dbNow(db),
  });
  const { payment_id } = await issue(db, submission, actor, product);
  await markPaid(db, payment_id, actor);
  return { submission, payment: payment_id };
}

async function events(
  db: Db,
  entity: string,
  id: string,
): Promise<{ type: string; payload: unknown }[]> {
  return (
    await db.query<{ type: string; payload: unknown }>(
      "select type, payload from public.events where entity = $1 and entity_id = $2 order by type",
      [entity, id],
    )
  ).rows;
}

async function audits(db: Db, id: string): Promise<string[]> {
  return (
    await db.query<{ action: string }>(
      "select action from public.audit_log where entity_id = $1 order by id",
      [id],
    )
  ).rows.map(({ action }) => action);
}

/** B7's `create_property_from_submission` (step 7) is on this database. */
async function hasCreateProperty(db: Db): Promise<boolean> {
  return (
    await one<{ present: boolean }>(
      db,
      "select to_regproc('public.create_property_from_submission') is not null as present",
    )
  ).present;
}

describe("invoice numbers", () => {
  it("are gapless across a rolled-back issue, which leaves no invoice_pdf job", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const base = await dbNow(db);
      const a = await createSubmission(db, { state: "Accepted", n: 701, base });
      const b = await createSubmission(db, { state: "Accepted", n: 702, base });
      await db.query("savepoint issue");
      const rolledBack = await issue(db, a, actor);
      const firstTry = await invoiceNumber(db, rolledBack.payment_id);
      await db.query("rollback to savepoint issue");
      const jobsLeft = await count(db, "public.jobs where idempotency_key = $1", [
        `invoice_pdf:${rolledBack.payment_id}`,
      ]);
      const again = await invoiceNumber(db, (await issue(db, a, actor)).payment_id);
      const next = await invoiceNumber(db, (await issue(db, b, actor)).payment_id);
      return { firstTry, again, next, jobsLeft };
    });
    expect(seen).toEqual({
      firstTry: seen.firstTry,
      again: seen.firstTry,
      next: seen.firstTry + 1,
      jobsLeft: 0,
    });
  });

  it("gives two parallel issues two consecutive numbers and cleans up after itself (committed)", async () => {
    const submissions = [7901, 7902].map((n) => deterministicUuid("fixtures:submission", n));
    const committedNumbers: number[] = [];
    let before: number | null = null;
    const numbers = await committed(
      async (a) => {
        const base = await dbNow(a);
        for (const [index, n] of [7901, 7902].entries()) {
          await createSubmission(a, { state: "Accepted", n, base });
          expect(submissions[index]).toBe(deterministicUuid("fixtures:submission", n));
        }
        before =
          (
            await a.query<{ last: number }>(
              `select last from public.invoice_counters where year = ${YEAR}`,
            )
          ).rows[0]?.last ?? null;
        const b = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
        await b.connect();
        try {
          await a.query("begin");
          const first = await issue(a, submissions[0] ?? "", null);
          await b.query("begin");
          // committed() never applies a registered mutation (it would commit it): the second issue applies it in its
          // own transaction, which rolls back, so a `sql` watched-fail reaches the race (P-901).
          const mutation = process.env["MOP_MUTATION_SQL"];
          if (mutation !== undefined && mutation !== "") await b.query(mutation);
          const { pid } = await one<{ pid: number }>(b, "select pg_backend_pid() as pid");
          const second = issue(b, submissions[1] ?? "", null);
          let waiting = false;
          for (let poll = 0; poll < 50 && !waiting; poll += 1) {
            await a.query("select pg_stat_clear_snapshot()");
            const state = await a.query<{ wait: string | null }>(
              "select wait_event_type as wait from pg_stat_activity where pid = $1",
              [pid],
            );
            waiting = state.rows[0]?.wait === "Lock";
            if (!waiting) await new Promise((resolve) => setTimeout(resolve, 100));
          }
          const firstNumber = await invoiceNumber(a, first.payment_id);
          await a.query("commit");
          committedNumbers.push(firstNumber);
          const secondNumber = await invoiceNumber(b, (await second).payment_id);
          await b.query("rollback");
          return { waiting, first: firstNumber, second: secondNumber };
        } finally {
          await b.end();
        }
      },
      async (a) => {
        await a.query("rollback");
        await a.query("begin");
        await a.query("select set_config('mop.retention', 'on', true)");
        const payments = (
          await a.query<{ id: string }>(
            "select id from public.payments where submission_id = any($1::uuid[])",
            [submissions],
          )
        ).rows.map(({ id }) => id);
        await a.query(
          `select public.job_queue_delete(heavy, msg_id) from public.jobs
           where (idempotency_key = any($1::text[]) or event_id in (select id from public.events where entity_id = any($2::uuid[])))
             and msg_id is not null`,
          [payments.map((id) => `invoice_pdf:${id}`), payments],
        );
        await a.query(
          `delete from public.jobs
           where idempotency_key = any($1::text[]) or event_id in (select id from public.events where entity_id = any($2::uuid[]))`,
          [payments.map((id) => `invoice_pdf:${id}`), payments],
        );
        await a.query("delete from public.events where entity_id = any($1::uuid[])", [payments]);
        await a.query("delete from public.payments where id = any($1::uuid[])", [payments]);
        await a.query("delete from public.submissions where id = any($1::uuid[])", [submissions]);
        await a.query(
          `delete from public.contacts c where c.email in ('fixture+7901@fixtures.invalid', 'fixture+7902@fixtures.invalid')
           and not exists (select 1 from public.submissions s where s.contact_id = c.id)`,
        );
        // Another writer's number is never rewound below: the counter goes back only while it still holds ours.
        const highest = Math.max(...committedNumbers);
        const last = (
          await a.query<{ last: number }>(
            `select last from public.invoice_counters where year = ${YEAR}`,
          )
        ).rows[0]?.last;
        if (committedNumbers.length > 0 && last === highest) {
          await (before === null
            ? a.query(`delete from public.invoice_counters where year = ${YEAR}`)
            : a.query(`update public.invoice_counters set last = $1 where year = ${YEAR}`, [
                before,
              ]));
        }
        await a.query("commit");
        if (committedNumbers.length > 0 && last !== highest) {
          throw new Error(
            `invoice_counters.last is ${String(last)}, not ${String(highest)}: left as it is`,
          );
        }
      },
    );
    const left = await withRollback(async (db) => ({
      payments: await count(db, "public.payments where submission_id = any($1::uuid[])", [
        submissions,
      ]),
      submissions: await count(db, "public.submissions where id = any($1::uuid[])", [submissions]),
      last:
        (
          await db.query<{ last: number }>(
            `select last from public.invoice_counters where year = ${YEAR}`,
          )
        ).rows[0]?.last ?? null,
    }));
    expect({ ...numbers, left }).toEqual({
      waiting: true,
      first: numbers.first,
      second: numbers.first + 1,
      left: { payments: 0, submissions: 0, last: before },
    });
  });

  it("are stored in the frozen snapshot with the issue and due dates", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const submission = await createSubmission(db, {
        state: "Accepted",
        n: 703,
        base: await dbNow(db),
      });
      const { payment_id } = await issue(db, submission, actor);
      return one(
        db,
        `select invoice_snapshot ->> 'invoice_number' = invoice_number as number,
           invoice_snapshot ->> 'issue_date' = to_char(issued_at at time zone 'utc', 'YYYY-MM-DD') as issue_date,
           invoice_snapshot ->> 'due_date' = to_char(due_at at time zone 'utc', 'YYYY-MM-DD') as due_date,
           invoice_snapshot ->> 'entity' as entity,
           due_at - issued_at = make_interval(days => (select (value ->> 'due_days')::integer
             from public.settings where key = 'invoice')) as due_days,
           issued_at = now() as issued_now, issued_by = $2 as issued_by, invoice_number ~ '^[A-Z]+-[0-9]{4}-[0-9]{4,}$' as format
         from public.payments where id = $1`,
        [payment_id, actor],
      );
    });
    expect(seen).toEqual({
      number: true,
      issue_date: true,
      due_date: true,
      entity: SNAPSHOT.entity,
      due_days: true,
      issued_now: true,
      issued_by: true,
      format: true,
    });
  });
});

describe("the gate and the one live payment", () => {
  it("refuses to issue on Under Review through B2's editorial gate", async () => {
    const result = await withRollback(async (db) => {
      const actor = await admin(db);
      const submission = await createSubmission(db, {
        state: "Under Review",
        n: 711,
        base: await dbNow(db),
      });
      return attempt(db, ISSUE, [submission, "The Feature", 295, JSON.stringify(SNAPSHOT), actor]);
    });
    expect(result).toBe("P0001 wrong_state");
  });

  it("refuses Scheduled with no paid or waived payment, and lets a waived one through", async () => {
    const seen = await withRollback(async (db) => {
      const submission = await createSubmission(db, {
        state: "Invoice Issued",
        n: 712,
        base: await dbNow(db),
      });
      const schedule = "update public.submissions set workflow_state = 'Scheduled' where id = $1";
      const unpaid = await attempt(db, schedule, [submission]);
      await createInvoice(db, { submission, status: "waived", n: 712 });
      return { unpaid, waived: await attempt(db, schedule, [submission]) };
    });
    expect(seen).toEqual({ unpaid: "P0001 wrong_state", waived: "ok" });
  });

  it("refuses a second live payment for one submission, in the function and in the index", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const submission = await createSubmission(db, {
        state: "Accepted",
        n: 713,
        base: await dbNow(db),
      });
      await issue(db, submission, actor);
      return {
        function: await attempt(db, ISSUE, [
          submission,
          "The Feature",
          295,
          JSON.stringify(SNAPSHOT),
          actor,
        ]),
        index: await attempt(
          db,
          `insert into public.payments (submission_id, product, amount, invoice_number, status)
           values ($1, 'The Feature', 295, 'MOP-2026-9713', 'paid')`,
          [submission],
        ),
      };
    });
    expect(seen.function).toBe("P0001 wrong_state");
    expect(seen.index).toMatch(/^23505 .*payments_one_live_idx/);
  });

  it("issues the next number after a due payment is voided, and refuses to void a paid one", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const base = await dbNow(db);
      const submission = await createSubmission(db, { state: "Accepted", n: 714, base });
      const first = await issue(db, submission, actor);
      await voidPayment(db, first.payment_id, actor);
      const state = await one<{ workflow_state: string }>(
        db,
        "select workflow_state from public.submissions where id = $1",
        [submission],
      );
      const second = await issue(db, submission, actor);
      await markPaid(db, second.payment_id, actor);
      return {
        state: state.workflow_state,
        first: await invoiceNumber(db, first.payment_id),
        second: await invoiceNumber(db, second.payment_id),
        voidPaid: await attempt(
          db,
          "select * from public.void_payment($1, 'issued in error', $2, 'human', 'req')",
          [second.payment_id, actor],
        ),
        statuses: (
          await db.query<{ status: string }>(
            "select status::text from public.payments where submission_id = $1 order by invoice_number",
            [submission],
          )
        ).rows.map(({ status }) => status),
      };
    });
    expect(seen).toEqual({
      state: "Invoice Issued",
      first: seen.first,
      second: seen.first + 1,
      voidPaid: "P0001 wrong_state",
      statuses: ["void", "paid"],
    });
  });

  it("refuses a due row without a number through payments_number_unless_waived", async () => {
    const result = await withRollback(async (db) => {
      const submission = await createSubmission(db, {
        state: "Invoice Issued",
        n: 715,
        base: await dbNow(db),
      });
      return attempt(
        db,
        "insert into public.payments (submission_id, product, amount, status) values ($1, 'The Feature', 295, 'due')",
        [submission],
      );
    });
    expect(result).toMatch(/^23514 .*payments_number_unless_waived/);
  });
});

describe("payment transitions", () => {
  it("raise wrong_state for mark paid on void and on waived, waive on paid and void on waived", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const base = await dbNow(db);
      const ids = [];
      for (const n of [721, 722, 723]) {
        const submission = await createSubmission(db, { state: "Accepted", n, base });
        ids.push((await issue(db, submission, actor)).payment_id);
      }
      const [voided = "", waived = "", paid = ""] = ids;
      await voidPayment(db, voided, actor);
      await waive(db, waived, actor);
      await markPaid(db, paid, actor);
      const mark =
        "select * from public.mark_payment_paid($1, now(), 'wire', null, $2, 'human', 'req')";
      return {
        markVoid: await attempt(db, mark, [voided, actor]),
        markWaived: await attempt(db, mark, [waived, actor]),
        waivePaid: await attempt(
          db,
          "select * from public.waive_payment($1, 'a reason', $2, 'human', 'req')",
          [paid, actor],
        ),
        voidWaived: await attempt(
          db,
          "select * from public.void_payment($1, 'a reason', $2, 'human', 'req')",
          [waived, actor],
        ),
      };
    });
    expect(seen).toEqual({
      markVoid: "P0001 wrong_state",
      markWaived: "P0001 wrong_state",
      waivePaid: "P0001 wrong_state",
      voidWaived: "P0001 wrong_state",
    });
  });

  it("raises paid_at_future for a payment date an hour ahead", async () => {
    const result = await withRollback(async (db) => {
      const actor = await admin(db);
      const submission = await createSubmission(db, {
        state: "Accepted",
        n: 724,
        base: await dbNow(db),
      });
      const { payment_id } = await issue(db, submission, actor);
      return attempt(
        db,
        "select * from public.mark_payment_paid($1, now() + interval '1 hour', 'wire', null, $2, 'human', 'req')",
        [payment_id, actor],
      );
    });
    expect(result).toBe("P0001 paid_at_future");
  });
});

describe("audit rows and events", () => {
  it("issue_invoice writes payments.issue, invoice.issued and one invoice_pdf job, and no plaintext snapshot", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const submission = await createSubmission(db, {
        state: "Accepted",
        n: 731,
        base: await dbNow(db),
      });
      const { payment_id, event_id } = await issue(db, submission, actor, "The Reach");
      const { invoice_number } = await one<{ invoice_number: string }>(
        db,
        "select invoice_number from public.payments where id = $1",
        [payment_id],
      );
      return {
        audits: await audits(db, payment_id),
        snapshotInAudit: (
          await one<{ snapshot: unknown }>(
            db,
            "select after -> 'invoice_snapshot' as snapshot from public.audit_log where entity_id = $1",
            [payment_id],
          )
        ).snapshot,
        events: await events(db, "payment", payment_id),
        eventIsReturned: await count(db, "public.events where id = $1 and entity_id = $2", [
          event_id,
          payment_id,
        ]),
        jobs: (
          await db.query<{ type: string; payload: unknown; max_attempts: number }>(
            "select type, payload, max_attempts from public.jobs where idempotency_key = $1",
            [`invoice_pdf:${payment_id}`],
          )
        ).rows,
        expected: { submission, payment_id, invoice_number },
      };
    });
    const { submission, payment_id, invoice_number } = seen.expected;
    expect(seen.audits).toEqual(["payments.issue"]);
    expect(seen.snapshotInAudit).toEqual({ pii: "changed" });
    expect(seen.events).toEqual([
      {
        type: "invoice.issued",
        payload: { submission_id: submission, payment_id, invoice_number, tier: "Reach" },
      },
    ]);
    expect(seen.eventIsReturned).toBe(1);
    expect(seen.jobs).toEqual([
      { type: "invoice_pdf", payload: { params: {}, data: { payment_id } }, max_attempts: 12 },
    ]);
  });

  it("mark paid, waive and void each write one audit row with their action and one event", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const base = await dbNow(db);
      const issued = [];
      for (const n of [732, 733, 734]) {
        const submission = await createSubmission(db, { state: "Accepted", n, base });
        issued.push({ submission, ...(await issue(db, submission, actor)) });
      }
      const [paid, waived, voided] = issued;
      if (paid === undefined || waived === undefined || voided === undefined)
        throw new Error("issue");
      await markPaid(db, paid.payment_id, actor);
      await waive(db, waived.payment_id, actor);
      await voidPayment(db, voided.payment_id, actor);
      const read = async ({ submission, payment_id }: { submission: string } & Issued) => ({
        submission,
        payment_id,
        invoice_number: (
          await one<{ invoice_number: string }>(
            db,
            "select invoice_number from public.payments where id = $1",
            [payment_id],
          )
        ).invoice_number,
        audits: await audits(db, payment_id),
        events: await events(db, "payment", payment_id),
      });
      return {
        paid: await read(paid),
        waived: await read(waived),
        voided: await read(voided),
        voidedUnprocessed: await count(
          db,
          "public.events where entity_id = $1 and type = 'invoice.voided' and processed_at is null",
          [voided.payment_id],
        ),
      };
    });
    const marked = (
      row: { submission: string; payment_id: string },
      status: string,
    ): { type: string; payload: unknown } => ({
      type: "payment.marked",
      payload: {
        submission_id: row.submission,
        payment_id: row.payment_id,
        status,
        amount: 295,
        tier: "Feature",
        invoiced: true,
      },
    });
    const issuedEvent = (row: {
      submission: string;
      payment_id: string;
      invoice_number: string;
    }) => ({
      type: "invoice.issued",
      payload: {
        submission_id: row.submission,
        payment_id: row.payment_id,
        invoice_number: row.invoice_number,
        tier: "Feature",
      },
    });
    expect(seen.paid.audits).toEqual(["payments.issue", "payments.mark_paid"]);
    expect(seen.paid.events).toEqual([issuedEvent(seen.paid), marked(seen.paid, "paid")]);
    expect(seen.waived.audits).toEqual(["payments.issue", "payments.waive"]);
    expect(seen.waived.events).toEqual([issuedEvent(seen.waived), marked(seen.waived, "waived")]);
    expect(seen.voided.audits).toEqual(["payments.issue", "payments.void"]);
    expect(seen.voided.events).toEqual([
      issuedEvent(seen.voided),
      {
        type: "invoice.voided",
        payload: {
          submission_id: seen.voided.submission,
          payment_id: seen.voided.payment_id,
          invoice_number: seen.voided.invoice_number,
          reason: "issued in error",
        },
      },
    ]);
    expect(seen.voidedUnprocessed).toBe(1);
  });

  it("activate_submission writes submissions.activate and submission.activated once, and a second call changes nothing", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const { submission } = await paidRequest(db, actor, 741, "The Campaign");
      const property = await linkedDraft(db, submission, 741);
      const copyJob = await one<{ id: string }>(
        db,
        "select public.enqueue_job('copy_submission_media', '{}', $1) as id",
        [`copy_submission_media:${property}`],
      );
      const first = await activate(db, submission, actor);
      const second = await activate(db, submission, actor);
      return {
        property,
        copyJob: copyJob.id,
        first,
        second,
        audits: await audits(db, submission),
        events: await events(db, "submission", submission),
        links: await one(
          db,
          `select s.workflow_state::text as state, s.activated_by = $2 as activated_by,
             s.activated_at is not null as activated_at,
             (select count(*)::int from public.properties p where p.submission_id = s.id) as properties,
             (select count(*)::int from public.campaigns c where c.submission_id = s.id) as campaigns,
             (select array_agg(distinct x) from (
               select s.property_id as x
               union all select p.property_id from public.payments p where p.submission_id = s.id and p.status = 'paid'
               union all select c.property_id from public.campaigns c where c.submission_id = s.id
             ) ids) as property_ids,
             (select c.payment_id = p.id and c.package = p.product and c.media_budget = 0
                and c.starts_on is null and c.ends_on is null
              from public.campaigns c join public.payments p on p.id = c.payment_id where c.submission_id = s.id) as campaign,
             (select campaign_tier::text from public.properties where id = s.property_id) as tier
           from public.submissions s where s.id = $1`,
          [submission, actor],
        ),
      };
    });
    expect(seen.first).toEqual({
      property_id: seen.property,
      event_id: seen.first.event_id,
      copy_job_id: seen.copyJob,
    });
    expect(seen.first.event_id).not.toBeNull();
    expect(seen.second).toEqual({
      property_id: seen.property,
      event_id: null,
      copy_job_id: seen.copyJob,
    });
    expect(seen.audits).toEqual(["submissions.activate"]);
    expect(seen.events).toEqual([
      {
        type: "submission.activated",
        payload: {
          submission_id: deterministicUuid("fixtures:submission", 741),
          property_id: seen.property,
          tier: "Campaign",
          market: "california",
        },
      },
    ]);
    expect(seen.links).toEqual({
      state: "Scheduled",
      activated_by: true,
      activated_at: true,
      properties: 1,
      campaigns: 1,
      property_ids: [seen.property],
      campaign: true,
      tier: "Campaign",
    });
  });

  it("activate_submission sets campaign_tier Feature for The Feature and refuses an unpaid request", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const { submission } = await paidRequest(db, actor, 744, "The Feature");
      const property = await linkedDraft(db, submission, 744);
      await activate(db, submission, actor);
      const unpaid = await createSubmission(db, {
        state: "Accepted",
        n: 747,
        base: await dbNow(db),
      });
      await issue(db, unpaid, actor);
      return {
        tier: (
          await one<{ tier: string }>(
            db,
            "select campaign_tier::text as tier from public.properties where id = $1",
            [property],
          )
        ).tier,
        unpaid: await attempt(
          db,
          "select * from public.activate_submission($1, $2, 'human', 'req')",
          [unpaid, actor],
        ),
      };
    });
    expect(seen).toEqual({ tier: "Feature", unpaid: "P0001 wrong_state" });
  });

  it("record_waiver writes a waived payment without an invoice, and activation then succeeds", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await admin(db);
      const submission = await createSubmission(db, {
        state: "Accepted",
        n: 750,
        base: await dbNow(db),
      });
      const counters = "select coalesce(sum(last), 0)::int as n from public.invoice_counters";
      const countersBefore = await one<{ n: number }>(db, counters);
      const { payment_id } = await one<Issued>(
        db,
        "select * from public.record_waiver($1, 'Five Features', 1250, 'Five Features credit', $2, 'human', 'req')",
        [submission, actor],
      );
      const row = await one(
        db,
        `select status::text, invoice_number, invoice_snapshot, due_at, amount::float as amount,
           waived_by = $2 as waived_by, notes,
           (select workflow_state::text from public.submissions where id = submission_id) as state
         from public.payments where id = $1`,
        [payment_id, actor],
      );
      const after = {
        audits: await audits(db, payment_id),
        events: await events(db, "payment", payment_id),
        jobs: await count(db, "public.jobs where idempotency_key = $1", [
          `invoice_pdf:${payment_id}`,
        ]),
        counters: (await one<{ n: number }>(db, counters)).n - countersBefore.n,
      };
      const property = await linkedDraft(db, submission, 750);
      return {
        payment_id,
        row,
        ...after,
        activated: (await activate(db, submission, actor)).property_id === property,
      };
    });
    expect(seen).toEqual({
      payment_id: seen.payment_id,
      row: {
        status: "waived",
        invoice_number: null,
        invoice_snapshot: null,
        due_at: null,
        amount: 1250,
        waived_by: true,
        notes: "Five Features credit",
        state: "Invoice Issued",
      },
      audits: ["payments.waive"],
      events: [
        {
          type: "payment.marked",
          payload: {
            submission_id: deterministicUuid("fixtures:submission", 750),
            payment_id: seen.payment_id,
            status: "waived",
            amount: 1250,
            tier: "Feature",
            invoiced: false,
          },
        },
      ],
      jobs: 0,
      counters: 0,
      activated: true,
    });
  });

  it("activate_submission leaves one copy_submission_media job and returns it twice", async (ctx) => {
    const seen = await withRollback(async (db) => {
      if (!(await hasCreateProperty(db))) return undefined;
      const actor = await admin(db);
      await db.query(
        "insert into public.user_roles (user_id, role) values ($1, 'managing_editor') on conflict do nothing",
        [actor],
      );
      const { submission } = await paidRequest(db, actor, 760, "The Feature");
      for (const index of [1, 2]) {
        await db.query(
          `insert into public.submission_media (submission_id, storage_path, name, mime, bytes, uploaded_at)
           values ($1, $2, $3, 'image/jpeg', 1000, now())`,
          [submission, `${submission}/${String(index)}.jpg`, `${String(index)}.jpg`],
        );
      }
      const first = await activate(db, submission, actor);
      const second = await activate(db, submission, actor);
      return {
        first,
        second,
        jobs: (
          await db.query<{ id: string }>("select id from public.jobs where idempotency_key = $1", [
            `copy_submission_media:${first.property_id}`,
          ])
        ).rows.map(({ id }) => id),
        staged: await count(db, "public.property_media where property_id = $1", [
          first.property_id,
        ]),
      };
    });
    if (seen === undefined) {
      // eslint-disable-next-line vitest/no-disabled-tests -- runs by itself once B7 step 7 puts create_property_from_submission on the database
      ctx.skip("needs B7 step 7's create_property_from_submission on this database");
      return;
    }
    expect(seen.first.copy_job_id).not.toBeNull();
    expect(seen.jobs).toEqual([seen.first.copy_job_id]);
    expect(seen.second.copy_job_id).toBe(seen.first.copy_job_id);
    expect(seen.staged).toBe(2);
  });

  it("concurrent activate and create property leave one property and one campaign (committed)", async (ctx) => {
    const present = await withRollback(hasCreateProperty);
    if (!present) {
      // eslint-disable-next-line vitest/no-disabled-tests -- runs by itself once B7 step 7 puts create_property_from_submission on the database
      ctx.skip("needs B7 step 7's create_property_from_submission on this database");
      return;
    }
    const submission = deterministicUuid("fixtures:submission", 7903);
    const seen = await committed(
      async (a) => {
        await createSubmission(a, { state: "Accepted", n: 7903, base: await dbNow(a) });
        const { payment_id } = await issue(a, submission, null);
        await a.query(
          "select * from public.mark_payment_paid($1, now(), 'wire', null, null, 'human', 'req')",
          [payment_id],
        );
        const b = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
        await b.connect();
        try {
          await a.query("begin");
          await activate(a, submission, null);
          await b.query("begin");
          const mutation = process.env["MOP_MUTATION_SQL"];
          if (mutation !== undefined && mutation !== "") await b.query(mutation);
          const created = b.query(
            "select public.create_property_from_submission($1, null, 'human', 'req') as created",
            [submission],
          );
          await a.query("commit");
          await created;
          const read = await one<{ properties: number; campaigns: number }>(
            b,
            `select (select count(*)::int from public.properties where submission_id = $1) as properties,
               (select count(*)::int from public.campaigns where submission_id = $1) as campaigns`,
            [submission],
          );
          await b.query("rollback");
          return read;
        } finally {
          await b.end();
        }
      },
      async (a) => {
        await a.query("rollback");
        await a.query("begin");
        await a.query("select set_config('mop.retention', 'on', true)");
        const properties = (
          await a.query<{ id: string }>(
            "select id from public.properties where submission_id = $1",
            [submission],
          )
        ).rows.map(({ id }) => id);
        const payments = (
          await a.query<{ id: string }>("select id from public.payments where submission_id = $1", [
            submission,
          ])
        ).rows.map(({ id }) => id);
        const entities = [submission, ...payments, ...properties];
        const keys = [
          ...payments.map((id) => `invoice_pdf:${id}`),
          ...properties.map((id) => `copy_submission_media:${id}`),
        ];
        const jobs = `public.jobs where idempotency_key = any($1::text[])
          or event_id in (select id from public.events where entity_id = any($2::uuid[]))`;
        await a.query(
          `select public.job_queue_delete(heavy, msg_id) from ${jobs} and msg_id is not null`,
          [keys, entities],
        );
        await a.query(`delete from ${jobs}`, [keys, entities]);
        await a.query("delete from public.events where entity_id = any($1::uuid[])", [entities]);
        await a.query("delete from public.campaigns where submission_id = $1", [submission]);
        await a.query("update public.submissions set property_id = null where id = $1", [
          submission,
        ]);
        await a.query("delete from public.payments where submission_id = $1", [submission]);
        await a.query("delete from public.property_media where property_id = any($1::uuid[])", [
          properties,
        ]);
        await a.query("delete from public.properties where id = any($1::uuid[])", [properties]);
        await a.query("delete from public.submissions where id = $1", [submission]);
        await a.query(
          `delete from public.contacts c where c.email = 'fixture+7903@fixtures.invalid'
           and not exists (select 1 from public.submissions s where s.contact_id = c.id)`,
        );
        await a.query("commit");
      },
    );
    expect(seen).toEqual({ properties: 1, campaigns: 1 });
  });
});

describe("settings and reads", () => {
  it("campaign_days names every product but Not sure yet, and package_duration_days reads it", async () => {
    const seen = await withRollback(async (db) =>
      one(
        db,
        `select
           (select array_agg(p::text order by p::text) from unnest(enum_range(null::public.exposure_package)) p
             where p <> 'Not sure yet') as products,
           (select array_agg(k order by k) from public.settings s, jsonb_object_keys(s.value -> 'campaign_days') k
             where s.key = 'invoice') as keys,
           public.package_duration_days('The Campaign') as campaign,
           public.package_duration_days('The Feature') as feature`,
      ),
    );
    expect(seen).toEqual({
      products: ["Five Features", "The Campaign", "The Feature", "The Reach"],
      keys: ["Five Features", "The Campaign", "The Feature", "The Reach"],
      campaign: 14,
      feature: null,
    });
  });

  it("payment_tier gives the tier of every product", async () => {
    const tiers = await withRollback(
      async (db) =>
        (
          await db.query<{ product: string; tier: string | null }>(
            `select p::text as product, public.payment_tier(p) as tier
             from unnest(enum_range(null::public.exposure_package)) p order by p`,
          )
        ).rows,
    );
    expect(tiers).toEqual([
      { product: "The Feature", tier: "Feature" },
      { product: "The Reach", tier: "Reach" },
      { product: "The Campaign", tier: "Campaign" },
      { product: "Five Features", tier: "Feature" },
      { product: "Not sure yet", tier: null },
    ]);
  });

  it("invoice_list reads overdue and days_open from the database clock, and anon reads nothing", async () => {
    const seen = await withRollback(async (db) => {
      const base = await dbNow(db);
      const submission = await createSubmission(db, { state: "Invoice Issued", n: 770, base });
      const id = await createInvoice(db, {
        submission,
        status: "due",
        n: 770,
        issued_at: atFrom(base, -15).toISOString(),
        due_at: atFrom(base, -1).toISOString(),
      });
      const row = await one(
        db,
        "select overdue, days_open, submitter_email from public.invoice_list where id = $1",
        [id],
      );
      await asRole(db, "anon");
      return { row, anon: await attempt(db, "select id from public.invoice_list limit 1") };
    });
    expect(seen).toEqual({
      row: { overdue: true, days_open: 15, submitter_email: "fixture+770@fixtures.invalid" },
      anon: "42501 permission denied for view invoice_list",
    });
  });

  it("settings_put_invoice writes one audit row with before and after and leaves catalog_version alone", async () => {
    const seen = await withRollback(async (db) => {
      const editor = await createStaffUser(db, ["admin"]);
      const read = (key: string) =>
        one<{ value: Record<string, unknown> }>(
          db,
          "select value from public.settings where key = $1",
          [key],
        );
      const version = (await read("catalog_version")).value;
      const current = (await read("invoice")).value;
      const prefix = `${String(current["prefix"])}X`;
      await db.query(
        "select public.settings_put_invoice($1, $2, 'human', 'req-settings', 'payments db test')",
        [JSON.stringify({ ...current, prefix }), editor],
      );
      return {
        current,
        prefix,
        version: (await read("catalog_version")).value === version,
        stored: (await read("invoice")).value["prefix"],
        audit: (
          await db.query(
            `select action, entity, before, after, note from public.audit_log
             where request_id = 'req-settings' and actor_id = $1`,
            [editor],
          )
        ).rows,
      };
    });
    expect(seen.version).toBe(true);
    expect(seen.stored).toBe(seen.prefix);
    expect(seen.audit).toEqual([
      {
        action: "settings.invoice_put",
        entity: "settings.invoice",
        before: { prefix: seen.current["prefix"] },
        after: { prefix: seen.prefix },
        note: "payments db test",
      },
    ]);
  });

  it("keeps the PDFs in B2's private bucket documents (ruling H33)", async () => {
    const bucket = await withRollback(async (db) =>
      one(db, "select id, public from storage.buckets where id = 'documents'"),
    );
    expect(bucket).toEqual({ id: "documents", public: false });
  });
});

// W6 item 8, ruling H142: the credit ledger (`client_credits`), the function that spends a credit, and the four pages
// the client room reads (`account_properties`, `account_invoices`, `account_credits`, `account_reports`). Every case runs
// in one rolled-back transaction.
import pg from "pg";
import { describe, expect, it } from "vitest";
import { creditsInPackage } from "../../src/domain/payments";
import { contact, idsOf, isRecord, person, rowsOf } from "../fixtures/account";
import { createStaffUser, dbNow, withRollback, type Db } from "../fixtures/db";
import {
  createInvoice,
  createSubmission,
  publishedProperty,
  type SubmissionFactoryInput,
} from "../fixtures/factories";

const OWNER = "test-credits-a@example.test";
const OTHER = "test-credits-b@example.test";

interface LedgerRow {
  kind: string;
  quantity: number;
  payment_id: string;
  submission_id: string | null;
}

async function one<T extends object>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row;
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

/** A request of the contact at `email`, in `state`, under `product`; `n` makes its id and address. */
async function request(
  db: Db,
  n: number,
  email: string,
  state: SubmissionFactoryInput["state"],
  product: "The Feature" | "Five Features" = "Five Features",
): Promise<string> {
  return createSubmission(db, {
    state,
    n,
    base: await dbNow(db),
    submitter_email: email,
    package: product,
  });
}

/** The pack: a Five Features request whose invoice is issued and then paid. Returns the request and its payment. */
async function paidPack(
  db: Db,
  n: number,
  email: string,
): Promise<{ submission: string; payment: string }> {
  const submission = await request(db, n, email, "Invoice Issued");
  const payment = await createInvoice(db, {
    submission,
    status: "due",
    n,
    product: "Five Features",
  });
  await db.query("update public.payments set status = 'paid', paid_at = now() where id = $1", [
    payment,
  ]);
  return { submission, payment };
}

const ledger = async (db: Db, email: string): Promise<LedgerRow[]> =>
  (
    await db.query<LedgerRow>(
      `select cc.kind, cc.quantity, cc.payment_id, cc.submission_id
       from public.client_credits cc join public.contacts c on c.id = cc.contact_id
       where lower(c.email) = $1 order by cc.kind desc, cc.created_at, cc.id`,
      [email],
    )
  ).rows;

const balanceOf = async (db: Db, email: string): Promise<number> =>
  (await ledger(db, email)).reduce((sum, row) => sum + row.quantity, 0);

const SPEND =
  "select * from public.spend_client_credit($1, 250, 'Five Features credit', $2, 'human', 'req-credits-db')";

describe("client_credits", () => {
  it("a paid Five Features payment buys five credits and uses one for its own property", async () => {
    const seen = await withRollback(async (db) => {
      const { submission, payment } = await paidPack(db, 901, OWNER);
      return { submission, payment, rows: await ledger(db, OWNER) };
    });
    expect(seen.rows).toEqual([
      { kind: "used", quantity: -1, payment_id: seen.payment, submission_id: seen.submission },
      { kind: "purchased", quantity: 5, payment_id: seen.payment, submission_id: null },
    ]);
  });

  it("a payment inserted already paid buys the pack as well", async () => {
    const seen = await withRollback(async (db) => {
      const submission = await request(db, 902, OWNER, "Invoice Issued");
      await createInvoice(db, { submission, status: "paid", n: 902, product: "Five Features" });
      return balanceOf(db, OWNER);
    });
    expect(seen).toBe(4);
  });

  it("a paid payment of any other product buys nothing", async () => {
    const seen = await withRollback(async (db) => {
      const submission = await request(db, 903, OWNER, "Invoice Issued", "The Feature");
      await createInvoice(db, { submission, status: "paid", n: 903, product: "The Feature" });
      return ledger(db, OWNER);
    });
    expect(seen).toEqual([]);
  });

  it("a payment that is due or waived buys nothing", async () => {
    const seen = await withRollback(async (db) => {
      const due = await request(db, 904, OWNER, "Invoice Issued");
      await createInvoice(db, { submission: due, status: "due", n: 904, product: "Five Features" });
      const waived = await request(db, 905, OTHER, "Invoice Issued");
      await createInvoice(db, {
        submission: waived,
        status: "waived",
        n: 905,
        product: "Five Features",
        invoice_number: null,
      });
      return [await ledger(db, OWNER), await ledger(db, OTHER)];
    });
    expect(seen).toEqual([[], []]);
  });

  it("a payment already paid, touched again, adds no row", async () => {
    const seen = await withRollback(async (db) => {
      const { payment } = await paidPack(db, 906, OWNER);
      await db.query("update public.payments set status = 'paid', notes = 'again' where id = $1", [
        payment,
      ]);
      return balanceOf(db, OWNER);
    });
    expect(seen).toBe(4);
  });

  it("spend_client_credit waives the next accepted request without an invoice and lowers the balance", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      await paidPack(db, 907, OWNER);
      const next = await request(db, 908, OWNER, "Accepted");
      const spent = await one<{ payment_id: string; event_id: string }>(db, SPEND, [next, actor]);
      const payment = await one(
        db,
        `select status::text, invoice_number, product::text, amount::float as amount, notes,
           (select workflow_state::text from public.submissions where id = submission_id) as state
         from public.payments where id = $1`,
        [spent.payment_id],
      );
      const used = await db.query(
        "select quantity, payment_id = $2 as same_payment from public.client_credits where submission_id = $1",
        [next, spent.payment_id],
      );
      return { payment, used: used.rows, balance: await balanceOf(db, OWNER) };
    });
    expect(seen).toEqual({
      payment: {
        status: "waived",
        invoice_number: null,
        product: "Five Features",
        amount: 250,
        notes: "Five Features credit",
        state: "Invoice Issued",
      },
      used: [{ quantity: -1, same_payment: true }],
      balance: 3,
    });
  });

  it("spend_client_credit refuses when the contact holds no credit, and leaves the request as it was", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      const next = await request(db, 909, OWNER, "Accepted");
      const refused = await attempt(db, SPEND, [next, actor]);
      const after = await one<{ state: string; payments: number }>(
        db,
        `select workflow_state::text as state,
           (select count(*)::int from public.payments where submission_id = $1) as payments
         from public.submissions where id = $1`,
        [next],
      );
      return { refused, after };
    });
    expect(seen).toEqual({
      refused: "P0001 no_credit",
      after: { state: "Accepted", payments: 0 },
    });
  });

  it("spend_client_credit never spends a credit of another contact", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      await paidPack(db, 910, OWNER);
      const strangers = await request(db, 911, OTHER, "Accepted");
      return {
        refused: await attempt(db, SPEND, [strangers, actor]),
        balance: await balanceOf(db, OWNER),
      };
    });
    expect(seen).toEqual({ refused: "P0001 no_credit", balance: 4 });
  });

  it("spend_client_credit refuses a request of another package", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      await paidPack(db, 912, OWNER);
      const reach = await request(db, 913, OWNER, "Accepted", "The Feature");
      return {
        refused: await attempt(db, SPEND, [reach, actor]),
        balance: await balanceOf(db, OWNER),
      };
    });
    expect(seen).toEqual({ refused: "P0001 wrong_state", balance: 4 });
  });

  it("the last credit is spent once: the balance never goes below zero", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      const first = await request(db, 914, OWNER, "Accepted");
      const second = await request(db, 915, OWNER, "Accepted");
      // One credit in the ledger, bought by a payment the pack trigger never saw.
      const bought = await request(db, 916, OWNER, "Invoice Issued", "The Feature");
      const payment = await createInvoice(db, { submission: bought, status: "due", n: 916 });
      await db.query(
        `insert into public.client_credits (contact_id, kind, quantity, payment_id)
         select c.id, 'purchased', 1, $1 from public.contacts c where lower(c.email) = $2`,
        [payment, OWNER],
      );
      return {
        first: await attempt(db, SPEND, [first, actor]),
        second: await attempt(db, SPEND, [second, actor]),
        balance: await balanceOf(db, OWNER),
      };
    });
    expect(seen).toEqual({ first: "ok", second: "P0001 no_credit", balance: 0 });
  });

  it("the ledger is append only, even to the service role", async () => {
    const seen = await withRollback(async (db) => {
      const { payment } = await paidPack(db, 917, OWNER);
      return {
        update: await attempt(
          db,
          "update public.client_credits set quantity = 50 where payment_id = $1",
          [payment],
        ),
        remove: await attempt(db, "delete from public.client_credits where payment_id = $1", [
          payment,
        ]),
      };
    });
    expect(seen).toEqual({ update: "P0001 append_only", remove: "P0001 append_only" });
  });

  it("a payment buys its pack once and a request uses one credit once", async () => {
    const seen = await withRollback(async (db) => {
      const { submission, payment } = await paidPack(db, 918, OWNER);
      const insert = (kind: string, quantity: number, withSubmission: boolean) =>
        attempt(
          db,
          `insert into public.client_credits (contact_id, kind, quantity, payment_id, submission_id)
           select c.id, $1, $2, $3, case when $4 then $5::uuid end from public.contacts c where lower(c.email) = $6`,
          [kind, quantity, payment, withSubmission, submission, OWNER],
        );
      return { pack: await insert("purchased", 5, false), use: await insert("used", -1, true) };
    });
    expect(seen.pack).toMatch(/^23505 /);
    expect(seen.use).toMatch(/^23505 /);
  });

  it("a row buys or uses a sensible number: no empty pack, no use of two, no purchase tied to a request", async () => {
    const seen = await withRollback(async (db) => {
      const { submission, payment } = await paidPack(db, 919, OWNER);
      const other = await request(db, 920, OWNER, "Accepted");
      const insert = (kind: string, quantity: number, request: string | null) =>
        attempt(
          db,
          `insert into public.client_credits (contact_id, kind, quantity, payment_id, submission_id)
           select c.id, $1, $2, $3, $4::uuid from public.contacts c where lower(c.email) = $5`,
          [kind, quantity, payment, request, OWNER],
        );
      return {
        empty: await insert("purchased", 0, null),
        two: await insert("used", -2, other),
        tied: await insert("purchased", 5, submission),
        unlinked: await insert("used", -1, null),
      };
    });
    for (const outcome of Object.values(seen)) expect(outcome).toMatch(/^23514 /);
  });

  it("credits_in_package agrees with creditsInPackage for every product that can be invoiced", async () => {
    const seen = await withRollback(async (db) => {
      const { rows } = await db.query<{ product: string; credits: number | null }>(
        `select p::text as product, public.credits_in_package(p) as credits
         from unnest(enum_range(null::public.exposure_package)) p`,
      );
      return Object.fromEntries(rows.map((row) => [row.product, row.credits]));
    });
    expect(seen).toEqual({
      "The Feature": creditsInPackage("The Feature"),
      "The Reach": creditsInPackage("The Reach"),
      "The Campaign": creditsInPackage("The Campaign"),
      "Five Features": creditsInPackage("Five Features"),
      "Not sure yet": null,
    });
  });

  it("staff read the ledger and nobody else does", async () => {
    const seen = await withRollback(async (db) => {
      await paidPack(db, 921, OWNER);
      const client = await person(db, OWNER);
      const staff = await createStaffUser(db, ["admin"]);
      const count = async (user: string): Promise<number> => {
        await db.query("savepoint read");
        await db.query("set local role authenticated");
        await db.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify({ sub: user }),
        ]);
        const { rows } = await db.query<{ n: number }>(
          "select count(*)::int as n from public.client_credits",
        );
        await db.query("rollback to savepoint read");
        return rows[0]?.n ?? -1;
      };
      return { staff: await count(staff), client: await count(client) };
    });
    expect(seen).toEqual({ staff: 2, client: 0 });
  });
});

/** The answer of one of the room's page functions for the person at `email`. */
async function page(db: Db, fn: string, email: string): Promise<unknown> {
  // Times print in the session's zone; PostgREST sessions are UTC, and so is this one.
  await db.query("set local time zone 'UTC'");
  const user = await person(db, email);
  const { rows } = await db.query<{ answer: unknown }>(`select public.${fn}($1) as answer`, [user]);
  return rows[0]?.answer;
}

/** "<name>, <email>" of a page's answer, or null when the answer names no one. */
const whoOf = (answer: unknown): string | null =>
  isRecord(answer) && typeof answer["name"] === "string" && typeof answer["email"] === "string"
    ? `${answer["name"]}, ${answer["email"]}`
    : null;

describe("the room's page functions", () => {
  it("every page says whose room it is, and none answers a session that is no contact's", async () => {
    const seen = await withRollback(async (db) => {
      await contact(db, OWNER);
      const answers: Record<string, unknown> = {};
      for (const fn of [
        "account_properties",
        "account_invoices",
        "account_credits",
        "account_reports",
      ]) {
        const known = await page(db, fn, OWNER);
        const nobody = await page(db, fn, "test-credits-nobody@example.test");
        answers[fn] = {
          who: whoOf(known),
          nobody,
        };
      }
      return answers;
    });
    for (const outcome of Object.values(seen)) {
      expect(outcome).toEqual({ who: `Test Owner, ${OWNER}`, nobody: null });
    }
  });

  it("only the service role calls them", async () => {
    const seen = await withRollback(async (db) => {
      const user = await person(db, OWNER);
      await contact(db, OWNER);
      const codes: Record<string, string> = {};
      for (const fn of [
        "account_properties",
        "account_invoices",
        "account_credits",
        "account_reports",
      ]) {
        for (const role of ["anon", "authenticated"]) {
          await db.query("savepoint call");
          await db.query(`set local role ${role}`);
          codes[`${fn} ${role}`] = await attempt(db, `select public.${fn}($1)`, [user]).then(
            (outcome) => outcome.slice(0, 5),
          );
          await db.query("rollback to savepoint call");
        }
      }
      return codes;
    });
    for (const outcome of Object.values(seen)) expect(outcome).toBe("42501");
  });

  it("account_properties: the client's requests with their dates and the live page, and no staff field", async () => {
    const seen = await withRollback(async (db) => {
      const base = await dbNow(db);
      const submission = await request(db, 930, OWNER, "Published");
      const property = await publishedProperty(db, { n: 930 });
      await db.query("reset role");
      await db.query("update public.submissions set property_id = $2 where id = $1", [
        submission,
        property.id,
      ]);
      const own = await request(db, 931, OWNER, "Under Review");
      const others = await request(db, 932, OTHER, "Accepted");
      const answer = await page(db, "account_properties", OWNER);
      const dates = await one<{
        reviewed: string;
        accepted: string;
        activated: string;
        published: string;
      }>(
        db,
        `select to_jsonb(s.reviewed_at) #>> '{}' as reviewed, to_jsonb(s.accepted_at) #>> '{}' as accepted,
           to_jsonb(s.activated_at) #>> '{}' as activated, to_jsonb(p.published_at) #>> '{}' as published
         from public.submissions s, public.properties p where s.id = $1 and p.id = $2`,
        [submission, property.id],
      );
      return { answer, ids: { submission, own, others }, slug: property.slug, dates, base };
    });
    const properties = rowsOf(seen.answer, "properties");
    expect(idsOf(properties)).toEqual([seen.ids.submission, seen.ids.own].sort());
    const live = properties.find((entry) => entry["id"] === seen.ids.submission);
    expect(live).toMatchObject({
      workflow_state: "Published",
      package: "Five Features",
      live_path: `/property/${seen.slug}`,
      reviewed_at: seen.dates.reviewed,
      accepted_at: seen.dates.accepted,
      activated_at: seen.dates.activated,
      published_at: seen.dates.published,
    });
    // Nothing a staff member wrote reaches the room.
    expect(Object.keys(live ?? {}).sort()).toEqual(
      [
        "accepted_at",
        "activated_at",
        "address",
        "city",
        "id",
        "live_path",
        "package",
        "can_add_photos",
        "photos",
        "published_at",
        "received_at",
        "reviewed_at",
        "state",
        "workflow_state",
      ].sort(),
    );
  });

  it("account_properties: a property that is not published has no live page", async () => {
    const seen = await withRollback(async (db) => {
      const down = await request(db, 933, OWNER, "Published");
      const draft = await request(db, 934, OWNER, "Scheduled");
      const downProperty = await publishedProperty(db, { n: 933 });
      const draftProperty = await publishedProperty(db, {
        n: 934,
        editorial_state: "draft",
        published_at: null,
      });
      await db.query("reset role");
      await db.query("update public.submissions set property_id = $2 where id = $1", [
        down,
        downProperty.id,
      ]);
      await db.query("update public.submissions set property_id = $2 where id = $1", [
        draft,
        draftProperty.id,
      ]);
      // A takedown archives the property and clears its publication; a draft was never published (a scheduled request).
      await db.query(
        `update public.properties
         set editorial_state = 'archived', archived_at = now(), published_at = null, taken_down_at = now(),
           unpublish_reason = 'test'
         where id = $1`,
        [downProperty.id],
      );
      const answer = await page(db, "account_properties", OWNER);
      return rowsOf(answer, "properties").map((entry) => entry["live_path"]);
    });
    expect(seen).toEqual([null, null]);
  });

  it("account_invoices: owed and paid, newest first, a voided invoice and the staff reason left out", async () => {
    const seen = await withRollback(async (db) => {
      const issued = await request(db, 940, OWNER, "Invoice Issued", "The Feature");
      const paid = await request(db, 941, OWNER, "Invoice Issued", "The Feature");
      const voided = await request(db, 942, OWNER, "Accepted", "The Feature");
      const strangers = await request(db, 943, OTHER, "Invoice Issued", "The Feature");
      const due = await createInvoice(db, { submission: issued, status: "due", n: 940 });
      const settled = await createInvoice(db, {
        submission: paid,
        status: "paid",
        n: 941,
        notes: "wired on the 3rd, staff only",
      });
      await createInvoice(db, { submission: voided, status: "due", n: 942 });
      await db.query("update public.payments set status = 'void' where id = $1", [
        (
          await one<{ id: string }>(db, "select id from public.payments where submission_id = $1", [
            voided,
          ])
        ).id,
      ]);
      await createInvoice(db, { submission: strangers, status: "due", n: 943 });
      const answer = await page(db, "account_invoices", OWNER);
      return { answer, due, settled };
    });
    const invoices = rowsOf(seen.answer, "invoices");
    expect(idsOf(invoices)).toEqual([seen.due, seen.settled].sort());
    const paid = invoices.find((entry) => entry["id"] === seen.settled);
    expect(paid).toMatchObject({
      product: "The Feature",
      amount: 295,
      currency: "USD",
      status: "paid",
      credit: false,
    });
    expect(Object.keys(paid ?? {}).sort()).toEqual(
      [
        "address",
        "amount",
        "city",
        "credit",
        "currency",
        "due_at",
        "id",
        "invoice_number",
        "issued_at",
        "paid_at",
        "product",
        "status",
      ].sort(),
    );
  });

  it("account_invoices: a credit that was spent shows as a waiver covered by a credit", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      await paidPack(db, 944, OWNER);
      const next = await request(db, 945, OWNER, "Accepted");
      const spent = await one<{ payment_id: string }>(db, SPEND, [next, actor]);
      const answer = await page(db, "account_invoices", OWNER);
      return { answer, spent: spent.payment_id };
    });
    const waiver = rowsOf(seen.answer, "invoices").find((entry) => entry["id"] === seen.spent);
    expect(waiver).toMatchObject({ status: "waived", invoice_number: null, credit: true });
  });

  it("account_credits: the balance, what was bought and used, and a line for each, newest first", async () => {
    const seen = await withRollback(async (db) => {
      const actor = await createStaffUser(db, ["admin"]);
      await paidPack(db, 946, OWNER);
      const next = await request(db, 947, OWNER, "Accepted");
      await one(db, SPEND, [next, actor]);
      await paidPack(db, 948, OTHER);
      return page(db, "account_credits", OWNER);
    });
    expect(seen).toMatchObject({
      email: OWNER,
      balance: 3,
      purchased: 5,
      used: 2,
    });
    const entries = rowsOf(seen, "entries");
    expect(
      entries.map((entry) => `${String(entry["kind"])}:${String(entry["quantity"])}`).sort(),
    ).toEqual(["purchased:5", "used:-1", "used:-1"]);
    expect(
      entries
        .filter((entry) => entry["kind"] === "used")
        .map((entry) => String(entry["address"]))
        .sort(),
    ).toEqual(["946 Fixture Lane", "947 Fixture Lane"]);
    expect(Object.keys(entries[0] ?? {}).sort()).toEqual(
      ["address", "city", "created_at", "id", "kind", "quantity"].sort(),
    );
  });

  it("account_credits: a contact with no pack has a balance of zero and no lines", async () => {
    const seen = await withRollback(async (db) => {
      await contact(db, OWNER);
      return page(db, "account_credits", OWNER);
    });
    expect(seen).toMatchObject({ balance: 0, purchased: 0, used: 0, entries: [] });
  });

  it("account_reports: page views, inquiry counts and the weekly figures of the property's latest campaign", async () => {
    const seen = await withRollback(async (db) => {
      const submission = await request(db, 950, OWNER, "Distribution Active", "The Reach");
      const property = await publishedProperty(db, { n: 950 });
      await db.query("reset role");
      await db.query("update public.submissions set property_id = $2 where id = $1", [
        submission,
        property.id,
      ]);
      const payment = await createInvoice(db, {
        submission,
        status: "paid",
        n: 950,
        product: "The Reach",
        property_id: property.id,
      });
      const campaign = await one<{ id: string }>(
        db,
        `insert into public.campaigns (property_id, submission_id, payment_id, package, starts_on, ends_on)
         values ($1, $2, $3, 'The Reach', '2026-10-01', '2026-10-14') returning id`,
        [property.id, submission, payment],
      );
      for (const [start, end, impressions] of [
        ["2026-10-01", "2026-10-07", 1200],
        ["2026-10-08", "2026-10-14", 3400],
      ] as const) {
        await db.query(
          `insert into public.campaign_reports
             (campaign_id, period_start, period_end, impressions, reach, clicks, video_views, ctr, media_spend)
           values ($1, $2, $3, $4, 900, 40, 15, 0.0123, 500)`,
          [campaign.id, start, end, impressions],
        );
      }
      // Another client's property, with a campaign of its own: it is not in this client's reports.
      const strangers = await request(db, 951, OTHER, "Distribution Active", "The Reach");
      const strangersProperty = await publishedProperty(db, { n: 951 });
      await db.query("reset role");
      await db.query("update public.submissions set property_id = $2 where id = $1", [
        strangers,
        strangersProperty.id,
      ]);
      const strangersPayment = await createInvoice(db, {
        submission: strangers,
        status: "paid",
        n: 951,
        product: "The Reach",
        property_id: strangersProperty.id,
      });
      await db.query(
        "insert into public.campaigns (property_id, submission_id, payment_id, package) values ($1, $2, $3, 'The Reach')",
        [strangersProperty.id, strangers, strangersPayment],
      );
      const path = `/property/${property.slug}`;
      // Four days rolled up, then two raw events on a later day: a day is counted once.
      await db.query(
        `insert into public.analytics_daily (day, event, path, events)
         values ('2026-10-10', 'property_view', $1, 30), ('2026-10-11', 'property_view', $1, 12)`,
        [path],
      );
      await db.query(
        `insert into public.analytics_events (event, path, occurred_at) values
           ('property_view', $1, '2026-10-11T08:00:00Z'),
           ('property_view', $1, '2026-10-12T08:00:00Z'),
           ('property_view', $1, '2026-10-12T09:00:00Z'),
           ('property_view', '/property/other', '2026-10-12T09:00:00Z')`,
        [path],
      );
      await db.query(
        `insert into public.inquiries (intent, name, email, message, source_path, subject_kind, subject_slug, received_at)
         values ('ask', 'Secret Person', 'secret@example.test', 'Private words', '/x', 'property', $1, now()),
           ('ask', 'Older Person', 'older@example.test', 'Old words', '/x', 'property', $1, now() - interval '90 days'),
           ('ask', 'Other Person', 'other@example.test', 'Other words', '/x', 'property', 'someone-elses', now())`,
        [property.slug],
      );
      return { answer: await page(db, "account_reports", OWNER), id: property.id, path };
    });
    const properties = rowsOf(seen.answer, "properties");
    expect(properties).toHaveLength(1);
    expect(properties[0]).toMatchObject({
      id: seen.id,
      live_path: seen.path,
      package: "The Reach",
      starts_on: "2026-10-01",
      ends_on: "2026-10-14",
      // 30 + 12 rolled up, plus the two raw events after the last rolled day (the raw event of the rolled day is the
      // same traffic and is not added again).
      page_views: 44,
      inquiries: 2,
      inquiries_30d: 1,
    });
    expect(properties[0]?.["weeks"]).toEqual([
      {
        period_start: "2026-10-08",
        period_end: "2026-10-14",
        impressions: 3400,
        reach: 900,
        clicks: 40,
        video_views: 15,
        ctr: 0.0123,
      },
      {
        period_start: "2026-10-01",
        period_end: "2026-10-07",
        impressions: 1200,
        reach: 900,
        clicks: 40,
        video_views: 15,
        ctr: 0.0123,
      },
    ]);
    // An inquirer's details and the media spend never reach the page.
    expect(JSON.stringify(seen.answer)).not.toMatch(/Secret|secret@|Private words|media_spend/);
  });
});

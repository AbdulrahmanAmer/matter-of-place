// Row factories for the database tests and the e2e data set (B4 invariants 8 and 9, GQ-03, T-08). Every timestamp is
// `atFrom(base, days)` from a `base` the caller read once with `dbNow(db)`, every id comes from `deterministicUuid`,
// and every row carries an address on the reserved domain fixtures.invalid, the marker `removeFixtureRows` deletes by.
import { offerings } from "../../src/data/exposure";
import type { TablesInsert } from "../../src/db/types";
import type { WorkflowState } from "../../src/domain/workflow";
import { atFrom, deterministicUuid } from "./clock";
import { asRole, dbNow, type Db } from "./db";

export const FIXTURE_EMAIL_LIKE = "%@fixtures.invalid";

const PLACES = [
  { state: "California", city: "Malibu", zip: "90265" },
  { state: "New York", city: "Sag Harbor", zip: "11963" },
  { state: "Florida", city: "Palm Beach", zip: "33480" },
] as const;

const REVIEWED: readonly WorkflowState[] = [
  "Declined",
  "Awaiting Assets",
  "Accepted",
  "Invoice Issued",
  "Scheduled",
  "Published",
  "Distribution Active",
  "Completed",
  "Withdrawn",
];
const ACCEPTED: readonly WorkflowState[] = [
  "Accepted",
  "Invoice Issued",
  "Scheduled",
  "Published",
  "Distribution Active",
  "Completed",
  "Withdrawn",
];
// B6's activate_submission moves a paid request from Invoice Issued to Scheduled.
const ACTIVATED: readonly WorkflowState[] = [
  "Scheduled",
  "Published",
  "Distribution Active",
  "Completed",
];

type SubmissionInsert = TablesInsert<"submissions">;

export type SubmissionFactoryInput = Omit<Partial<SubmissionInsert>, "state" | "workflow_state"> & {
  state: WorkflowState;
  n: number;
  base: Date;
};

const dated = (when: boolean, base: Date, days: number) =>
  when ? atFrom(base, days).toISOString() : null;

/** The `submissions` row `createSubmission` writes: the same input gives the same row. */
export function submissionRow({ state, n, base, ...overrides }: SubmissionFactoryInput) {
  const place = PLACES[n % PLACES.length] ?? PLACES[0];
  const kind = overrides.submitter_kind ?? "agent";
  return {
    id: deterministicUuid("fixtures:submission", n),
    address: `${String(n)} Fixture Lane`,
    city: place.city,
    state: place.state,
    zip: place.zip,
    property_type: "Residence",
    submitter_kind: kind,
    submitter_name: `Fixture Submitter ${String(n)}`,
    submitter_email: `fixture+${String(n)}@fixtures.invalid`,
    brokerage: kind === "agent" ? "Fixture Brokerage" : null,
    story: "A house kept by one family since it was built.",
    significance: "An early example of the coastal modern house.",
    package: "The Feature",
    source_path: "/submit",
    workflow_state: state,
    received_at: atFrom(base, -30).toISOString(),
    reviewed_at: dated(REVIEWED.includes(state), base, -25),
    accepted_at: dated(ACCEPTED.includes(state), base, -20),
    activated_at: dated(ACTIVATED.includes(state), base, -10),
    turnstile_ok: true,
    rights_version: "2026-10-01",
    rights_confirmed_at: atFrom(base, -30).toISOString(),
    rights_ip_hash: "fixture",
    ...overrides,
  } satisfies SubmissionInsert;
}

/**
 * Upserts one submission by its deterministic id, and first its submitter's `contacts` row on `lower(email)` exactly
 * as B3's `create_submission` does (B2 invariant 22, S55). Returns the submission id.
 */
export async function createSubmission(db: Db, input: SubmissionFactoryInput): Promise<string> {
  const row = submissionRow(input);
  const contact = await db.query<{ id: string }>(
    `insert into public.contacts as c (kind, name, email, phone, brokerage)
     values ($1, $2, lower($3), $4, $5)
     on conflict ((lower(email))) do update
     set name = excluded.name,
       phone = coalesce(excluded.phone, c.phone),
       brokerage = coalesce(excluded.brokerage, c.brokerage)
     returning c.id`,
    [
      row.submitter_kind,
      row.submitter_name,
      row.submitter_email,
      row.submitter_phone ?? null,
      row.brokerage,
    ],
  );
  const entries = Object.entries({ ...row, contact_id: contact.rows[0]?.id });
  const columns = entries.map(([column]) => column);
  const inserted = await db.query<{ id: string }>(
    `insert into public.submissions (${columns.join(", ")})
     values (${columns.map((_, index) => `$${String(index + 1)}`).join(", ")})
     on conflict (id) do update
     set ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}
     returning id`,
    entries.map(([, value]) => value),
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error(`createSubmission ${String(input.n)} returned no row`);
  return id;
}

type PaymentInsert = TablesInsert<"payments">;

export type InvoiceFactoryInput = Omit<Partial<PaymentInsert>, "submission_id" | "status"> & {
  submission: string;
  status: "due" | "paid" | "waived";
  n: number;
};

/** The amount of `product` from the one price source, `src/data/exposure.ts` (S3). */
function priceOf(product: PaymentInsert["product"]): number {
  const price = offerings.find((offering) => offering.name === product)?.price;
  if (price === undefined) throw new Error(`no offering is named ${product}`);
  return Number(price.replace(/[$,]/g, ""));
}

/**
 * Upserts one `payments` row by its deterministic id (G24: B6 owns it, `due_at` is its column). The number
 * `MOP-2026-9NNN` sits above the real counter, which the factory never calls; the dates are from `dbNow(db)` (T-08).
 * Returns the payment id.
 */
export async function createInvoice(
  db: Db,
  { submission, status, n, ...overrides }: InvoiceFactoryInput,
): Promise<string> {
  const base = await dbNow(db);
  const product = overrides.product ?? "The Feature";
  const row = {
    id: deterministicUuid("fixtures:payment", n),
    submission_id: submission,
    product,
    amount: priceOf(product),
    invoice_number: `MOP-2026-${String(9000 + n)}`,
    preferred_method: "bank_transfer",
    status,
    issued_at: atFrom(base, 0).toISOString(),
    due_at: atFrom(base, 14).toISOString(),
    paid_at: status === "paid" ? atFrom(base, 0).toISOString() : null,
    ...overrides,
  } satisfies PaymentInsert;
  const entries = Object.entries(row);
  const columns = entries.map(([column]) => column);
  const inserted = await db.query<{ id: string }>(
    `insert into public.payments (${columns.join(", ")})
     values (${columns.map((_, index) => `$${String(index + 1)}`).join(", ")})
     on conflict (id) do update
     set ${columns.map((column) => `${column} = excluded.${column}`).join(", ")}
     returning id`,
    entries.map(([, value]) => value),
  );
  const id = inserted.rows[0]?.id;
  if (id === undefined) throw new Error(`createInvoice ${String(n)} returned no row`);
  return id;
}

export interface FixtureCounts {
  payments: number;
  submissions: number;
  contacts: number;
  inquiries: number;
  subscribers: number;
  jobs: number;
}

/**
 * Deletes the rows marked by `emailLike` inside the caller's transaction, after allowing the hard delete for that
 * transaction only (GD-04). Jobs carry no email: their marker is `fixtures:` in the idempotency key, and they go only
 * with the default pattern, so the live specs' `e2e+%` cleanup never touches the data set.
 */
export async function removeFixtureRows(
  db: Db,
  { emailLike = FIXTURE_EMAIL_LIKE }: { emailLike?: string } = {},
): Promise<FixtureCounts> {
  await db.query("select set_config('mop.retention', 'on', true)");
  const remove = async (sql: string, params: string[] = [emailLike]) =>
    (await db.query(sql, params)).rowCount ?? 0;
  const payments = await remove(
    "delete from public.payments where submission_id in (select id from public.submissions where submitter_email like $1)",
  );
  const submissions = await remove("delete from public.submissions where submitter_email like $1");
  // submissions.contact_id is on delete restrict: a contact another run's submission still uses stays.
  const contacts = await remove(
    `delete from public.contacts c where c.email like $1
     and not exists (select 1 from public.submissions s where s.contact_id = c.id)`,
  );
  const inquiries = await remove("delete from public.inquiries where email like $1");
  const subscribers = await remove("delete from public.subscribers where email like $1");
  const jobs =
    emailLike === FIXTURE_EMAIL_LIKE
      ? await remove("delete from public.jobs where idempotency_key like 'fixtures:%'", [])
      : 0;
  return { payments, submissions, contacts, inquiries, subscribers, jobs };
}

type PropertyInsert = TablesInsert<"properties">;

export type PublishedPropertyInput = Omit<Partial<PropertyInsert>, "id" | "slug"> & { n: number };

/**
 * The `properties` row of a published property: a value for every not-null column and for every column that
 * `enforce_publish_gate` requires of a published row (G62). The city and the style are of its own, so a fixture
 * never joins an archive facet unless the caller gives it one.
 */
export function publishedPropertyRow({ n, ...overrides }: PublishedPropertyInput) {
  return {
    id: deterministicUuid("fixtures:property", n),
    slug: `fixture-property-${String(n)}`,
    title: `Fixture Property ${String(n)}`,
    market_slug: "california",
    region_slug: "bay-area",
    city: `Fixture City ${String(n)}`,
    neighborhood: "Fixture Quarter",
    state: "California",
    country: "United States",
    address: `${String(n)} Fixture Lane`,
    price: 2_500_000,
    beds: 4,
    baths: 3.5,
    interior_sq_ft: 3200,
    lot_acres: 0.4,
    year_built: 1962,
    type: "Residence",
    style: `Fixture Style ${String(n)}`,
    status: "Active",
    hero_image: `fixtures/property-${String(n)}/hero.webp`,
    story: ["A fixture paragraph."],
    place: "A quiet street.",
    editorial_state: "published",
    ...overrides,
  } satisfies PropertyInsert;
}

/**
 * Inserts one published property as the service role, which `enforce_publish_gate` lets publish, and returns the row.
 * It needs a transaction: `asRole` is `set local`. The market `california` and its region `bay-area` are created when the
 * database has none, so a fixture works on an empty schema and leaves a seeded one alone.
 */
export async function publishedProperty(db: Db, input: PublishedPropertyInput) {
  await asRole(db, "service_role");
  await db.query(
    `insert into public.markets (slug, name, country, intro) values ('california', 'California', 'United States', 'x')
     on conflict (slug) do nothing`,
  );
  await db.query(
    `insert into public.regions (slug, market_slug, name, intro) values ('bay-area', 'california', 'Bay Area', 'x')
     on conflict (slug) do nothing`,
  );
  const row = publishedPropertyRow({ published_at: (await dbNow(db)).toISOString(), ...input });
  const entries = Object.entries(row);
  const inserted = await db.query<{ id: string; slug: string } & Record<string, unknown>>(
    `insert into public.properties (${entries.map(([column]) => column).join(", ")})
     values (${entries.map((_, index) => `$${String(index + 1)}`).join(", ")})
     returning *`,
    entries.map(([, value]) => value),
  );
  await db.query("reset role");
  const property = inserted.rows[0];
  if (property === undefined)
    throw new Error(`publishedProperty ${String(input.n)} returned no row`);
  return property;
}

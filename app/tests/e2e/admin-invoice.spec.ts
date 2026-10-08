import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { z } from "zod";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { createSubmission } from "../fixtures/factories";
import { dbNow } from "../fixtures/db";
import { holdDevLock } from "../fixtures/dev-lock";
import { checkpoint } from "./fixtures/a11y";
import { adminClient, signInAs } from "./helpers/session";

// B6 step 9, the observed exit of the slice: an admin issues an invoice and activates a test submission. It commits
// rows and rewrites `settings.site` and `settings.invoice`, so it holds the writer lock of G34 from `beforeAll` to
// the end of `afterAll`, and puts back what it found. A full-stack rehearsal (ruling H70): it needs the job runner and B7
// step 7's `create_property_from_submission`, which CI's admin step lacks, so it skips unless `E2E_FULL_STACK=1`, and
// runs by hand against mop-dev (ruling H35). The email assertion needs `EMAIL_LIVE=1` on the runner: `E2E_RESEND=1`.

const MANAGING_EDITOR = "staff+managing@matterofplace.com";
const ADMIN = "staff+ceo@matterofplace.com";
const POLL_MS = 5000;
const POLL_LIMIT_MS = 180_000;

const RUN = Math.floor(Date.now() / 1000);
const FIXTURE_DOMAIN = "fixtures.invalid";
const LIVE_INBOX = "delivered@resend.dev";

type Role = "invoiced" | "waived" | "voided" | "unaccepted";
const emailOf = (role: Role) =>
  role === "invoiced" && process.env["E2E_RESEND"] === "1"
    ? LIVE_INBOX
    : `e2e+invoice-${role}-${String(RUN)}@${FIXTURE_DOMAIN}`;

interface Fixture {
  id: string;
  address: string;
  email: string;
}

const fixtures = new Map<Role, Fixture>();
const issuedNumbers: string[] = [];
let paymentId = "";
let before: { site: unknown; invoice: unknown; counter: number; year: number } | null = null;
let release: () => Promise<void> = () => Promise.resolve();

function fixture(role: Role): Fixture {
  const found = fixtures.get(role);
  if (found === undefined) throw new Error(`admin-invoice: no ${role} fixture`);
  return found;
}

function dbUrl(): string {
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("admin-invoice: DEV_DB_URL is not set");
  return url;
}

/** One short connection per call, so a long wait never holds a socket the pooler may drop. */
async function sql<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    return (await client.query<Row>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function one<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const [row] = await sql<Row>(text, params);
  if (row === undefined) throw new Error(`admin-invoice: no row for ${text}`);
  return row;
}

const utcYear = async () =>
  (await one<{ year: number }>("select extract(year from timezone('utc', now()))::int as year"))
    .year;

async function counterLast(year: number): Promise<number> {
  const rows = await sql<{ last: number }>(
    "select last from public.invoice_counters where year = $1",
    [year],
  );
  return rows[0]?.last ?? 0;
}

/** The database clock (R51): `mark_payment_paid` compares the date it is given with its own `now()`. */
const databaseNow = async () => (await one<{ now: Date }>("select now() as now")).now;

/** The state pill of the invoice page header; the Void trigger and other buttons carry the same words. */
const statusPill = (page: Page, label: string) =>
  page.locator(".admin-invoice-page__state").getByText(label, { exact: true });

const numberAfter = (last: number, year: number) =>
  `MOP-${String(year)}-${String(last + 1).padStart(4, "0")}`;

async function putSetting(key: "site" | "invoice", value: unknown): Promise<void> {
  await sql(
    `select public.settings_put_${key}($1::jsonb, null, 'human'::public.actor_kind, $2, 'e2e: admin-invoice')`,
    [JSON.stringify(value), `admin-invoice:${key}:${String(Date.now())}`],
  );
}

async function settingValue(key: string): Promise<unknown> {
  return (await one<{ value: unknown }>("select value from public.settings where key = $1", [key]))
    .value;
}

async function createRequests(): Promise<void> {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    const base = await dbNow(client);
    const roles: [Role, "Accepted" | "Under Review"][] = [
      ["invoiced", "Accepted"],
      ["waived", "Accepted"],
      ["voided", "Accepted"],
      ["unaccepted", "Under Review"],
    ];
    for (const [index, [role, state]] of roles.entries()) {
      const n = RUN + index;
      const email = emailOf(role);
      const id = await createSubmission(client, {
        state,
        n,
        base,
        submitter_kind: "owner",
        submitter_email: email,
      });
      fixtures.set(role, { id, address: `${String(n)} Fixture Lane`, email });
    }
  } finally {
    await client.end();
  }
}

/** Events about the run's requests, their payments or their properties; `$1` is the array of request ids. */
const OWNED_EVENTS = `(
  select e.id from public.events e
  where e.entity_id = any($1::uuid[])
    or e.entity_id in (select p.id from public.payments p where p.submission_id = any($1::uuid[]))
    or e.entity_id in (select pr.id from public.properties pr where pr.submission_id = any($1::uuid[]))
)`;

/** Removes what the run made, in the order the foreign keys allow, and puts the counter back when it is still ours. */
async function removeRequests(): Promise<void> {
  const ids = [...fixtures.values()].map((entry) => entry.id);
  const emails = [...fixtures.values()].map((entry) => entry.email);
  if (ids.length === 0) return;
  // A job that is running would upload after the cleanup and the rewound counter would reuse its key.
  await expect
    .poll(
      async () =>
        (
          await one<{ running: number }>(
            `select count(*)::int as running from public.jobs where status = 'running' and event_id in ${OWNED_EVENTS}`,
            [ids],
          )
        ).running,
      { intervals: [2000], timeout: 60_000, message: "a job of this run is still running" },
    )
    .toBe(0);
  const keys = await sql<{ invoice_file_key: string | null }>(
    "select invoice_file_key from public.payments where submission_id = any($1::uuid[])",
    [ids],
  );
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('mop.retention', 'on', true)");
    // What the run caused, found by name: the mail, the jobs of its events, then the events (G16: only under retention).
    await client.query(
      "delete from public.email_messages where entity = 'submission' and entity_id = any($1::uuid[])",
      [ids],
    );
    await client.query(`delete from public.jobs where event_id in ${OWNED_EVENTS}`, [ids]);
    await client.query(`delete from public.events where id in ${OWNED_EVENTS}`, [ids]);
    await client.query(
      "delete from public.campaigns where payment_id in (select id from public.payments where submission_id = any($1::uuid[]))",
      [ids],
    );
    await client.query("delete from public.properties where submission_id = any($1::uuid[])", [
      ids,
    ]);
    await client.query("delete from public.payments where submission_id = any($1::uuid[])", [ids]);
    await client.query("delete from public.submissions where id = any($1::uuid[])", [ids]);
    await client.query(
      `delete from public.contacts c where lower(c.email) = any($1::text[])
       and not exists (select 1 from public.submissions s where s.contact_id = c.id)`,
      [emails.map((email) => email.toLowerCase())],
    );
    await client.query("commit");
  } catch (failure) {
    await client.query("rollback");
    throw failure;
  } finally {
    await client.end();
  }
  const stored = keys.flatMap((row) =>
    row.invoice_file_key === null ? [] : [row.invoice_file_key],
  );
  if (stored.length > 0) {
    const removed = await adminClient().storage.from("documents").remove(stored);
    expect(removed.error).toBeNull();
  }
  // The number is rewound only while it is still the highest this run issued: someone else's number is never undone.
  if (before !== null && issuedNumbers.length > 0) {
    const highest = Math.max(...issuedNumbers.map((issued) => Number(issued.split("-")[2])));
    await sql("update public.invoice_counters set last = $1 where year = $2 and last = $3", [
      before.counter,
      before.year,
      highest,
    ]);
  }
}

/** The draft screen to the recorded invoice: product kept, method typed, both confirmations. Answers the payment id. */
async function issueThroughUi(page: Page, role: Role, label: string): Promise<string> {
  const { id } = fixture(role);
  await page.goto(`/admin/invoices/new?submission_id=${id}`);
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await checkpoint(page, `${label} draft`);
  await page.getByLabel("Preferred payment method").fill("bank_transfer");
  await page.getByRole("button", { name: "Issue and email" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Issue and email this invoice" })).toBeVisible();
  await checkpoint(page, `${label} issue dialog`);
  await dialog.getByRole("button", { name: "Issue and email" }).click();
  const recorded = page.getByRole("region", { name: "Recorded" });
  await expect(recorded.getByText("Invoice issued.")).toBeVisible();
  const row = await one<{ id: string; invoice_number: string }>(
    "select id, invoice_number from public.payments where submission_id = $1 and status <> 'void'",
    [id],
  );
  issuedNumbers.push(row.invoice_number);
  const planned = await sql<{ type: string }>(
    `select j.type from public.jobs j join public.events e on e.id = j.event_id
     where e.type = 'invoice.issued' and e.entity_id = $1 order by j.type`,
    [row.id],
  );
  expect(planned.map((job) => job.type)).toEqual(expect.arrayContaining(["invoice_pdf"]));
  const watcher = recorded.getByRole("list", { name: "Jobs started" });
  await expect(watcher.getByRole("listitem")).toHaveCount(planned.length);
  for (const type of new Set(planned.map((job) => job.type))) {
    await expect(
      watcher.getByRole("listitem").filter({ hasText: type.replaceAll("_", " ") }),
    ).toHaveCount(planned.filter((job) => job.type === type).length);
  }
  return row.id;
}

test.skip(!process.env["E2E_FULL_STACK"], "needs the job runner and B7's activation");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertNotProduction();
  release = await holdDevLock();
  const year = await utcYear();
  before = {
    site: await settingValue("site"),
    invoice: await settingValue("invoice"),
    counter: await counterLast(year),
    year,
  };
  const site = z.record(z.string(), z.unknown()).parse(before.site);
  await putSetting("site", {
    ...site,
    legal: { entity: "Example Media LLC", address: "100 Example Street, New York, NY 10001" },
  });
  await putSetting(
    "invoice",
    JSON.parse(
      readFileSync(new URL("../../scripts/fixtures/invoice.example.json", import.meta.url), "utf8"),
    ),
  );
  await createRequests();
});

test.afterAll(async () => {
  try {
    await removeRequests();
  } finally {
    try {
      if (before !== null) {
        await putSetting("site", before.site);
        await putSetting("invoice", before.invoice);
      }
    } finally {
      await release();
    }
  }
});

test("the managing editor issues the next invoice number and its PDF is served by a signed link", async ({
  browser,
}) => {
  test.setTimeout(POLL_LIMIT_MS + 120_000);
  if (before === null) throw new Error("admin-invoice: beforeAll did not run");
  const expected = numberAfter(await counterLast(before.year), before.year);
  const { context, page } = await signInAs(browser, MANAGING_EDITOR);
  try {
    await page.goto("/admin/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
    await checkpoint(page, "/admin/invoices");
    await page.goto("/admin/invoices/new");
    await expect(page.getByRole("list", { name: "Accepted requests" })).toBeVisible();
    await checkpoint(page, "/admin/invoices/new");

    paymentId = await issueThroughUi(page, "invoiced", "managing editor");
    const number = await one<{ invoice_number: string; status: string }>(
      "select invoice_number, status from public.payments where id = $1",
      [paymentId],
    );
    expect(number).toEqual({ invoice_number: expected, status: "due" });
    await page.getByRole("link", { name: "Open it" }).click();
    await expect(page.getByRole("heading", { level: 1, name: expected })).toBeVisible();
    await expect(page.getByRole("article", { name: "Invoice preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Void" })).toHaveCount(0);
    await checkpoint(page, "/admin/invoices/:id");

    await expect
      .poll(
        async () =>
          (
            await one<{ invoice_file_key: string | null }>(
              "select invoice_file_key from public.payments where id = $1",
              [paymentId],
            )
          ).invoice_file_key,
        {
          intervals: [POLL_MS],
          timeout: POLL_LIMIT_MS,
          message: "the invoice_pdf job did not set invoice_file_key",
        },
      )
      .toBe(`${String(before.year)}/${expected}.pdf`);

    await page.reload();
    const link = page.getByRole("link", { name: "Open the PDF" });
    await expect(link).toBeVisible();
    const cookie = (await context.cookies())
      .map((entry) => `${entry.name}=${entry.value}`)
      .join("; ");
    const answer = await context.request.get(
      new URL(`/api/admin/payments/${paymentId}/pdf`, page.url()).href,
      {
        maxRedirects: 0,
        headers: { cookie },
      },
    );
    expect(answer.status()).toBe(302);
    const location = answer.headers()["location"] ?? "";
    expect(location).toContain("/storage/v1/object/sign/documents/");
    const stored = await fetch(location);
    expect(stored.status).toBe(200);
    expect(new TextDecoder().decode((await stored.arrayBuffer()).slice(0, 4))).toBe("%PDF");
  } finally {
    await context.close();
  }
});

test("print: the invoice page hides the admin navigation, shows the preview and fits one Letter page", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, MANAGING_EDITOR);
  try {
    await page.setViewportSize({ width: 816, height: 1056 });
    await page.goto(`/admin/invoices/${paymentId}`);
    await expect(page.getByRole("article", { name: "Invoice preview" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("navigation", { name: "Admin" })).toBeHidden();
    await expect(page.getByRole("article", { name: "Invoice preview" })).toBeVisible();
    mkdirSync("out", { recursive: true });
    await page.screenshot({ path: "out/invoice-print.png" });
    const pdf = await page.pdf({ format: "Letter" });
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? [];
    expect(pages).toHaveLength(1);
  } finally {
    await context.close();
  }
});

test("mark paid, then activate: the request is Scheduled with a property draft, one campaign and the copy job", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, MANAGING_EDITOR);
  try {
    await page.goto(`/admin/invoices/${paymentId}`);
    await page.getByRole("button", { name: "Mark paid" }).click();
    const paid = page.getByRole("dialog");
    await expect(paid.getByRole("heading", { name: "Mark this invoice paid" })).toBeVisible();
    await checkpoint(page, "mark paid dialog");
    const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
      new Date((await databaseNow()).getTime() - 36 * 3_600_000),
    );
    await paid.getByLabel("Date received").fill(yesterday);
    await paid.getByLabel("Method").fill("Bank transfer");
    await paid.getByRole("button", { name: "Mark paid" }).click();
    await expect(statusPill(page, "Paid")).toBeVisible();

    await page.getByRole("button", { name: "Activate" }).click();
    const activate = page.getByRole("dialog");
    await expect(activate.getByRole("heading", { name: "Activate this request" })).toBeVisible();
    await checkpoint(page, "activate dialog");
    await activate.getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Activated", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Jobs started" }).getByText("copy submission media"),
    ).toBeVisible();

    const { id } = fixture("invoiced");
    const state = await one<{ workflow_state: string; property_id: string }>(
      "select workflow_state, property_id from public.submissions where id = $1",
      [id],
    );
    expect(state.workflow_state).toBe("Scheduled");
    const property = await one<{ editorial_state: string }>(
      "select editorial_state from public.properties where id = $1",
      [state.property_id],
    );
    expect(property.editorial_state).toBe("draft");
    const campaigns = await one<{ count: string }>(
      "select count(*) from public.campaigns where payment_id = $1",
      [paymentId],
    );
    expect(campaigns.count).toBe("1");
    const copy = await one<{ count: string }>(
      "select count(*) from public.jobs where idempotency_key = $1",
      [`copy_submission_media:${state.property_id}`],
    );
    expect(copy.count).toBe("1");
  } finally {
    await context.close();
  }
});

test("a second accepted request is waived without an invoice and then activates", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, MANAGING_EDITOR);
  try {
    const { id } = fixture("waived");
    await page.goto(`/admin/invoices/new?submission_id=${id}`);
    await page.getByRole("button", { name: "Waive without invoice" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Waive without an invoice" })).toBeVisible();
    await checkpoint(page, "waive without invoice dialog");
    await dialog.getByLabel("Reason").fill("Five Features credit");
    await dialog.getByRole("button", { name: "Waive without invoice" }).click();
    await expect(
      page.getByRole("region", { name: "Recorded" }).getByText("Waiver recorded."),
    ).toBeVisible();

    const waived = await one<{
      id: string;
      status: string;
      invoice_number: string | null;
      notes: string | null;
    }>("select id, status, invoice_number, notes from public.payments where submission_id = $1", [
      id,
    ]);
    expect(waived).toMatchObject({
      status: "waived",
      invoice_number: null,
      notes: "Five Features credit",
    });

    await page.getByRole("link", { name: "Open it" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "No invoice" })).toBeVisible();
    await page.getByRole("button", { name: "Activate" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Activate" }).click();
    await expect(page.getByText("Activated", { exact: true })).toBeVisible();
    const state = await one<{ workflow_state: string }>(
      "select workflow_state from public.submissions where id = $1",
      [id],
    );
    expect(state.workflow_state).toBe("Scheduled");
  } finally {
    await context.close();
  }
});

test("the admin voids a second test invoice with a reason", async ({ browser }) => {
  const { context, page } = await signInAs(browser, ADMIN);
  try {
    const voidedId = await issueThroughUi(page, "voided", "admin");
    await page.getByRole("link", { name: "Open it" }).click();
    await page.getByRole("button", { name: "Void" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Void this invoice" })).toBeVisible();
    await checkpoint(page, "void dialog");
    await dialog.getByLabel("Reason").fill("Issued for the end-to-end run");
    await dialog.getByRole("button", { name: "Void invoice" }).click();
    await expect(statusPill(page, "Void")).toBeVisible();
    const row = await one<{ status: string }>("select status from public.payments where id = $1", [
      voidedId,
    ]);
    expect(row.status).toBe("void");
  } finally {
    await context.close();
  }
});

test("a request that is not accepted cannot be invoiced from the screen, the API or SQL", async ({
  browser,
}) => {
  const { id } = fixture("unaccepted");
  const { context, page } = await signInAs(browser, MANAGING_EDITOR);
  try {
    await page.goto(`/admin/invoices/new?submission_id=${id}`);
    await expect(page.getByText("Accept this request before issuing an invoice.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Issue and email" })).toBeDisabled();

    const refused = z.object({ error: z.object({ code: z.string() }) });
    const answer = await page.evaluate(
      async ({ submissionId }) => {
        const csrf = document.cookie
          .split("; ")
          .find((entry) => entry.startsWith("mop_csrf="))
          ?.slice("mop_csrf=".length);
        const response = await fetch("/api/admin/payments/issue-invoice", {
          method: "POST",
          headers: { "content-type": "application/json", "x-mop-csrf": csrf ?? "" },
          body: JSON.stringify({
            submissionId,
            product: "The Feature",
            preferredMethod: "bank_transfer",
          }),
        });
        return { status: response.status, body: (await response.json()) as unknown };
      },
      { submissionId: id },
    );
    expect(answer.status).toBe(409);
    expect(refused.parse(answer.body).error.code).toBe("not_accepted");
  } finally {
    await context.close();
  }

  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    await client.query("begin");
    await expect(
      client.query(
        "select * from public.issue_invoice($1, 'The Feature', 695, 'bank_transfer', '{}'::jsonb, null, 'human', 'admin-invoice:sql')",
        [id],
      ),
    ).rejects.toThrow("wrong_state");
  } finally {
    await client.query("rollback");
    await client.end();
  }
  const payments = await one<{ count: string }>(
    "select count(*) from public.payments where submission_id = $1",
    [id],
  );
  expect(payments.count).toBe("0");
});

test("the invoice email reaches the submitter once its PDF is stored (E2E_RESEND=1, after EMAIL_LIVE=1)", async () => {
  test.skip(process.env["E2E_RESEND"] !== "1", "needs EMAIL_LIVE=1 on the runner and E2E_RESEND=1");
  test.setTimeout(POLL_LIMIT_MS + 30_000);
  if (before === null) throw new Error("admin-invoice: beforeAll did not run");
  // `send_email` writes the recipient's entity: the invoice goes to the submitter, so the row is about the request.
  const { id } = fixture("invoiced");
  const mailOf = () =>
    sql<{ status: string; resend_id: string | null; to_email: string | null }>(
      "select status, resend_id, to_email from public.email_messages where template_key = 'invoice' and entity = 'submission' and entity_id = $1",
      [id],
    );
  await expect
    .poll(async () => (await mailOf())[0]?.status ?? "none", {
      intervals: [POLL_MS],
      timeout: POLL_LIMIT_MS,
    })
    .toMatch(/^(sent|delivered)$/);
  const [mail] = await mailOf();
  expect(mail?.resend_id?.startsWith("dry_")).toBe(false);
  expect(mail?.to_email).toBe(LIVE_INBOX);
  // The attachment resolver reads this object before the send, so the mail carried `<number>.pdf` from here.
  const payment = await one<{ invoice_file_key: string | null; invoice_number: string }>(
    "select invoice_file_key, invoice_number from public.payments where id = $1",
    [paymentId],
  );
  expect(payment.invoice_file_key).toBe(`${String(before.year)}/${payment.invoice_number}.pdf`);
  const stored = await adminClient()
    .storage.from("documents")
    .download(payment.invoice_file_key ?? "");
  expect(stored.error).toBeNull();
  expect(new TextDecoder().decode((await stored.data?.arrayBuffer())?.slice(0, 4))).toBe("%PDF");
});

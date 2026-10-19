import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { committed, dbNow, type Db } from "../fixtures/db";
import { createInvoice, createSubmission, publishedProperty } from "../fixtures/factories";
import { adminClient, tokenHashFor } from "./helpers/session";

// W6 item 8: a seeded client walks the room's four pages in a real browser, against the stack of the admin specs. The
// client is a contact with a paid Five Features pack (so four credits are left), a request waiting at Accepted, a
// request whose property is live with a campaign, an inquiry and page views; a second client's rows sit beside them and
// must appear nowhere. The sign-in uses the token hash of `auth.admin.generateLink`, as the admin specs do, so no mail
// is sent. Not proven by CI's admin step alone: the photographs go to the real `submissions` bucket (UNPROVEN until run).

const RUN = Math.floor(Date.now() / 1000);
const OWNER = `e2e+room-${String(RUN)}@fixtures.invalid`;
const STRANGER = `e2e+room-other-${String(RUN)}@fixtures.invalid`;
const NUMBERS = [9801, 9802, 9803, 9804] as const;
const [PACK, NEXT, LIVE, OTHERS] = NUMBERS;
const ADDRESS = (n: number) => `${String(n)} Fixture Lane`;
const PHOTO = readFileSync(new URL("../fixtures/photo.jpg", import.meta.url));

interface Seeded {
  slug: string;
  propertyId: string;
}

/** Everything this spec made, by the numbers it used, in one transaction that allows the hard delete. */
async function clear(db: Db): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    "select id from public.submissions where address = any($1::text[])",
    [NUMBERS.map(ADDRESS)],
  );
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return;
  const { rows: files } = await db.query<{ storage_path: string }>(
    "select storage_path from public.submission_media where submission_id = any($1::uuid[])",
    [ids],
  );
  if (files.length > 0) {
    await adminClient()
      .storage.from("submissions")
      .remove(files.map((file) => file.storage_path));
  }
  await db.query("begin");
  try {
    await db.query("select set_config('mop.retention', 'on', true)");
    // The ledger is append-only for everyone; a cleanup of fixtures is the one thing that may empty it.
    await db.query("alter table public.client_credits disable trigger client_credits_immutable");
    await db.query(
      "delete from public.client_credits where payment_id in (select id from public.payments where submission_id = any($1::uuid[]))",
      [ids],
    );
    await db.query("alter table public.client_credits enable trigger client_credits_immutable");
    await db.query(
      "delete from public.campaign_reports where campaign_id in (select id from public.campaigns where submission_id = any($1::uuid[]))",
      [ids],
    );
    await db.query("delete from public.campaigns where submission_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.payments where submission_id = any($1::uuid[])", [ids]);
    await db.query("delete from public.submission_media where submission_id = any($1::uuid[])", [
      ids,
    ]);
    const { rows: properties } = await db.query<{ property_id: string }>(
      "select property_id from public.submissions where id = any($1::uuid[]) and property_id is not null",
      [ids],
    );
    await db.query("delete from public.submissions where id = any($1::uuid[])", [ids]);
    for (const { property_id } of properties) {
      await db.query(
        "update public.properties set editorial_state = 'archived', archived_at = now(), published_at = null where id = $1 and editorial_state = 'published'",
        [property_id],
      );
      await db.query("delete from public.properties where id = $1", [property_id]);
    }
    await db.query("delete from public.inquiries where email like 'e2e+room-%@fixtures.invalid'");
    await db.query(
      "delete from public.analytics_events where path like '/property/fixture-property-980%'",
    );
    await db.query(
      "delete from public.analytics_daily where path like '/property/fixture-property-980%'",
    );
    await db.query("delete from public.contacts where email like 'e2e+room-%@fixtures.invalid'");
    await db.query("commit");
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

async function seed(db: Db): Promise<Seeded> {
  await clear(db);
  const base = await dbNow(db);
  await db.query("begin");
  try {
    // The pack: a Five Features request whose invoice is paid, which buys five credits and uses one.
    const pack = await createSubmission(db, {
      state: "Invoice Issued",
      n: PACK,
      base,
      submitter_email: OWNER,
      package: "Five Features",
    });
    await createInvoice(db, { submission: pack, status: "due", n: PACK, product: "Five Features" });
    await db.query(
      "update public.payments set status = 'paid', paid_at = now() where submission_id = $1",
      [pack],
    );
    await createSubmission(db, {
      state: "Accepted",
      n: NEXT,
      base,
      submitter_email: OWNER,
      package: "Five Features",
    });
    const live = await createSubmission(db, {
      state: "Published",
      n: LIVE,
      base,
      submitter_email: OWNER,
      package: "The Reach",
    });
    const property = await publishedProperty(db, { n: LIVE });
    await db.query("reset role");
    await db.query("update public.submissions set property_id = $2 where id = $1", [
      live,
      property.id,
    ]);
    const payment = await createInvoice(db, {
      submission: live,
      status: "paid",
      n: LIVE,
      product: "The Reach",
      property_id: property.id,
    });
    const { rows: campaign } = await db.query<{ id: string }>(
      `insert into public.campaigns (property_id, submission_id, payment_id, package, starts_on, ends_on)
       values ($1, $2, $3, 'The Reach', current_date - 14, current_date) returning id`,
      [property.id, live, payment],
    );
    await db.query(
      `insert into public.campaign_reports (campaign_id, period_start, period_end, impressions, reach, clicks)
       values ($1, current_date - 7, current_date - 1, 1200, 900, 40)`,
      [campaign[0]?.id],
    );
    const path = `/property/${property.slug}`;
    await db.query(
      `insert into public.analytics_events (event, path, occurred_at) values
         ('property_view', $1, now()), ('property_view', $1, now())`,
      [path],
    );
    await db.query(
      `insert into public.inquiries (intent, name, email, message, source_path, subject_kind, subject_slug)
       values ('ask', 'Room Inquirer', 'e2e+room-inquirer-${String(RUN)}@fixtures.invalid', 'A private message', '/x', 'property', $1)`,
      [property.slug],
    );
    // Another client's request, which must appear nowhere in this client's room.
    await createSubmission(db, {
      state: "Accepted",
      n: OTHERS,
      base,
      submitter_email: STRANGER,
      package: "The Feature",
    });
    await db.query("commit");
    return { slug: property.slug, propertyId: property.id };
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

/** Opens the sign-in link the way the confirm page does, presses its button, and lands in the room. */
async function signIn(page: Page, tokenHash: string): Promise<void> {
  await page.goto(`/account/confirm#token_hash=${encodeURIComponent(tokenHash)}`);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(`Signed in as`)).toBeVisible();
}

test("a seeded client walks the room: properties, invoices, credits, reports, and sees no one else's", async ({
  browser,
}) => {
  const { tokenHash, userId } = await tokenHashFor(OWNER, "magiclink");
  try {
    await committed(async (db) => {
      const seeded = await seed(db);
      const context = await browser.newContext();
      const page = await context.newPage();
      await signIn(page, tokenHash);

      // My properties: three requests, a timeline each, the live page linked, photographs offered where still open.
      await page.getByRole("link", { name: "My properties" }).click();
      await expect(page.getByRole("heading", { name: "Your properties" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
      const live = page.getByRole("list", { name: `Where ${ADDRESS(LIVE)} stands` });
      await expect(
        live.getByRole("listitem").filter({ hasText: "Live on the site" }),
      ).toHaveAttribute("aria-current", "step");
      await expect(page.getByRole("link", { name: "See the live page" })).toHaveAttribute(
        "href",
        `/property/${seeded.slug}`,
      );
      await expect(page.getByLabel("Add photographs")).toHaveCount(2);

      // Adding a photograph to the request waiting at Accepted.
      await page.getByLabel("Add photographs").last().setInputFiles({
        name: "front.jpg",
        mimeType: "image/jpeg",
        buffer: PHOTO,
      });
      await expect(page.getByText(/1 photograph sent/)).toBeVisible();

      // Invoices: the pack, paid, and the Reach, paid.
      await page.getByRole("link", { name: "Invoices" }).click();
      await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();
      await expect(page.getByRole("row").filter({ hasText: "Paid" })).toHaveCount(2);

      // Credits: four left, and the next property opens the form with Five Features chosen.
      await page.getByRole("link", { name: "Credits" }).click();
      await expect(page.getByText("4 credits left.")).toBeVisible();
      await page.getByRole("link", { name: "Submit my next property" }).click();
      await expect(page).toHaveURL(/\/submit\?package=five-features$/);
      await expect(page.getByRole("heading", { name: "Submit a Property" })).toBeVisible();
      await page.goBack();

      // Reports: two page views, one inquiry and the week's figures, and nothing of who wrote.
      await page.getByRole("link", { name: "Reports" }).click();
      await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
      await expect(
        page.locator(".account-figures > div").filter({ hasText: "Page views" }),
      ).toContainText("2");
      await expect(
        page.locator(".account-figures > div").filter({ hasText: /^Inquiries\d/ }),
      ).toContainText("1");
      await expect(page.getByRole("cell", { name: "1,200" })).toBeVisible();
      await expect(page.getByText("Room Inquirer")).toHaveCount(0);

      // No page shows the other client's request.
      for (const name of ["My properties", "Invoices", "Credits", "Reports"]) {
        await page.getByRole("link", { name }).click();
        await expect(
          page.getByRole("heading", { name: name === "My properties" ? "Your properties" : name }),
        ).toBeVisible();
        await expect(page.getByText(ADDRESS(OTHERS))).toHaveCount(0);
      }

      // Signing out returns the sign-in form.
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
      await context.close();
    }, clear);
  } finally {
    await adminClient().auth.admin.deleteUser(userId);
  }
});

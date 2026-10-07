import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { committed, dbNow, type Db } from "../fixtures/db";
import { holdDevLock } from "../fixtures/dev-lock";
import { checkpoint } from "./fixtures/a11y";
import { signInAs } from "./helpers/session";

// B11 step 7, screen 13 (Place Notes). Signed in as the seeded managing editor, it opens the one draft or builds it
// with the Build button, then reorders blocks with the keyboard, looks at the phone preview, finds Approve off with
// no blocks, approves for 30 days ahead and takes it back, and reads the subscriber counts. It leaves the issue a
// draft and deletes nothing. It commits rows (a build, an approval, an unapproval, one export audit row), so it
// refuses a production database and holds the one-writer lock of mop-dev from the start of beforeAll to the end of
// afterAll (ASSUMED H35 (5), G34).

const MANAGING_EDITOR = "staff+managing@matterofplace.com";
const DAY = 30;

test.describe.configure({ mode: "serial" });

let release: () => Promise<void> = () => Promise.resolve();
let context: BrowserContext;
let page: Page;
let issuePath = "";

const read = <T>(fn: (db: Db) => Promise<T>): Promise<T> => committed(fn, () => Promise.resolve());

const blockList = () => page.getByRole("list", { name: "Blocks, in reading order" });
const blockNames = () => blockList().getByRole("heading", { level: 3 }).allTextContents();

async function openIssuesList(): Promise<void> {
  await page.goto("/admin/newsletter");
  await expect(page.getByRole("heading", { name: "Newsletter", level: 1 })).toBeVisible();
  await expect(page.getByRole("table", { name: "Place Notes issues" })).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  await assertNotProduction();
  release = await holdDevLock();
  // `committed` takes the same lock on its own connection unless told the run holds it.
  process.env["MOP_DEV_LOCK_HELD"] = "1";
  ({ context, page } = await signInAs(browser, MANAGING_EDITOR));
});

test.afterAll(async () => {
  await context.close();
  delete process.env["MOP_DEV_LOCK_HELD"];
  await release();
});

test("the issues list opens the one draft, or the Build button makes it from the published stories", async () => {
  await openIssuesList();
  await checkpoint(page, "/admin/newsletter");
  const draft = page.getByRole("row", { name: /Draft/ });
  if ((await draft.count()) === 0) {
    await page.getByRole("button", { name: "Build the next issue" }).click();
    await expect(draft).toHaveCount(1);
  }
  await draft.getByRole("link", { name: /^No\. \d+$/ }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: /^Place Notes No\. \d+$/ }),
  ).toBeVisible();
  issuePath = new URL(page.url()).pathname;
  expect(issuePath).toMatch(/^\/admin\/newsletter\/[0-9a-f-]{36}$/);
  expect((await blockNames()).length).toBeGreaterThanOrEqual(2);
  await checkpoint(page, "/admin/newsletter/:id");
});

test("a block moved with the keyboard stays moved after a reload", async () => {
  const before = await blockNames();
  const [first, second, ...rest] = before;
  if (first === undefined || second === undefined)
    throw new Error("the draft holds fewer than two blocks");
  await page.getByRole("button", { name: `Move down: ${first}` }).focus();
  await page.keyboard.press("Enter");
  expect(await blockNames()).toEqual([second, first, ...rest]);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(blockList()).toBeVisible();
  expect(await blockNames()).toEqual([second, first, ...rest]);
});

test("the phone preview draws the saved issue in a frame 390 pixels wide", async () => {
  const [title] = await blockNames();
  await page.getByRole("button", { name: "Phone" }).click();
  const frame = page.locator('iframe[title="Issue preview"]');
  await expect(frame).toHaveAttribute("width", "390");
  await expect(page.frameLocator('iframe[title="Issue preview"]').locator("body")).toContainText(
    title ?? "",
  );
});

test("Approve is off while the editor holds no blocks, though none of that is saved", async () => {
  const names = await blockNames();
  expect(names.length).toBeGreaterThan(0);
  await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
  for (const name of names) await page.getByRole("button", { name: `Remove: ${name}` }).click();
  await expect(page.getByRole("button", { name: "Approve" })).toBeDisabled();
  await expect(page.getByText("Add a block before approving.")).toBeVisible();
  await page.reload();
  expect(await blockNames()).toEqual(names);
});

test("approving for 30 days ahead queues the send and its preview, and unapproving cancels both", async () => {
  const id = issuePath.split("/").at(-1) ?? "";
  const local = await read(async (db) => {
    const now = await dbNow(db);
    const result = await db.query<{ local: string }>(
      `select to_char(($1::timestamptz + make_interval(days => $2)) at time zone 'America/New_York', 'YYYY-MM-DD"T"HH24:MI') as local`,
      [now, DAY],
    );
    return result.rows[0]?.local ?? "";
  });
  expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

  await page.getByRole("button", { name: "Approve" }).click();
  const approving = page.getByRole("dialog", { name: "Approve this issue" });
  await checkpoint(page, "/admin/newsletter/:id approve");
  await approving.getByLabel("Send at (Eastern time)").fill(local);
  await approving.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved. The send and its preview are queued.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Unapprove" })).toBeVisible();

  const queued = await read(async (db) => {
    const result = await db.query<{ key: string; type: string; status: string; days: number }>(
      `select j.idempotency_key as key, j.type, j.status, extract(epoch from (j.run_after - now())) / 86400 as days
       from public.jobs j join public.newsletter_issues i
         on j.idempotency_key in ('newsletter_send:' || i.id || ':' || i.approval_count,
                                  'newsletter_preview:' || i.id || ':' || i.approval_count)
       where i.id = $1 order by j.type`,
      [id],
    );
    return result.rows;
  });
  expect(queued.map(({ type, status }) => [type, status])).toEqual([
    ["newsletter_preview", "queued"],
    ["newsletter_send", "queued"],
  ]);
  expect(Number(queued[1]?.days)).toBeGreaterThan(DAY - 1);

  await page.getByRole("button", { name: "Unapprove" }).click();
  await page
    .getByRole("dialog", { name: "Take this issue back to draft" })
    .getByRole("button", { name: "Unapprove" })
    .click();
  await expect(
    page.getByText("Back to draft. The queued send and preview are cancelled."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();

  const after = await read(async (db) => {
    const issue = await db.query<{ status: string }>(
      "select status from public.newsletter_issues where id = $1",
      [id],
    );
    const jobs = await db.query<{ type: string; status: string }>(
      "select type, status from public.jobs where idempotency_key = any($1) order by type",
      [queued.map(({ key }) => key)],
    );
    return { status: issue.rows[0]?.status, jobs: jobs.rows };
  });
  expect(after).toEqual({
    status: "draft",
    jobs: [
      { type: "newsletter_preview", status: "cancelled" },
      { type: "newsletter_send", status: "cancelled" },
    ],
  });
});

test("the subscribers tab counts each market as the database counts its audience", async () => {
  await openIssuesList();
  await page.getByRole("tab", { name: "Subscribers" }).click();
  expect(new URL(page.url()).searchParams.get("tab")).toBe("subscribers");
  const audiences = page.getByRole("table", { name: "Who a send reaches" });
  await expect(audiences).toBeVisible();
  await checkpoint(page, "/admin/newsletter subscribers");
  const expected = await read(async (db) => {
    const counts: Record<string, number> = {};
    for (const audience of ["market-ca", "market-ny", "market-fl"]) {
      const result = await db.query<{ count: number }>(
        "select public.newsletter_recipient_count($1) as count",
        [audience],
      );
      counts[audience] = Number(result.rows[0]?.count);
    }
    return counts;
  });
  const grouped = new Intl.NumberFormat("en-US");
  for (const [audience, market] of [
    ["market-ca", "California"],
    ["market-ny", "New York"],
    ["market-fl", "Florida"],
  ] as const) {
    await expect(audiences.getByRole("row", { name: market }).getByRole("cell")).toHaveText(
      grouped.format(expected[audience] ?? -1),
    );
  }
});

test("the subscriber export is a CSV download that no cache may keep", async () => {
  const answer = await page.evaluate(async () => {
    const response = await fetch("/api/admin/newsletter/subscribers/export");
    return {
      status: response.status,
      type: response.headers.get("content-type"),
      disposition: response.headers.get("content-disposition"),
      cache: response.headers.get("cache-control"),
      head: (await response.text()).split("\r\n")[0],
    };
  });
  expect(answer).toEqual({
    status: 200,
    type: "text/csv; charset=utf-8",
    disposition: expect.stringMatching(/^attachment; filename=subscribers-\d{4}-\d{2}-\d{2}\.csv$/),
    cache: "no-store",
    head: "email,markets,source,status,confirmed_at,unsubscribed_at",
  });
});

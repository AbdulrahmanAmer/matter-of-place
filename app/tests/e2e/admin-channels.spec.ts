import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { deterministicUuid } from "../fixtures/clock";
import { holdDevLock } from "../fixtures/dev-lock";
import { publishedProperty } from "../fixtures/factories";
import { checkpoint } from "./fixtures/a11y";
import { signInAs } from "./helpers/session";

// B10 step 8 (screen 12). The failed and the posted row are seeded through the social.sql functions the posting steps
// use, so no platform is called (invariant 1). It commits rows to mop-dev, so it runs before the launch switch only:
// `assertNotProduction` refuses once `settings.environment` is `production` (ruling H35 (5)), and the writer lock is held
// from the start of `beforeAll` to the end of `afterAll` (G34). Rows are never deleted: the scheduled row the retry
// leaves is failed again with error `test`, and the property stays a draft so no public page lists it. The one
// exception to "ends by failing its own rows" is the posted Instagram row: `fail_social_post` only changes a scheduled
// row, so it stays posted (permalink `.../p/e2e-channels/`) and shows as Instagram's last post on screens 2 and 12
// until the launch switch's `db:reset` clears it (ASSUMED H35 (4)).

const MEDIA_OPS = "staff+mediaops@matterofplace.com";
const COMMERCIAL = "staff+commercial@matterofplace.com";
const PROPERTY_N = 9120;

test.describe.configure({ mode: "serial" });

let release: () => Promise<void> = () => Promise.resolve();
let db: pg.Client;
let failedId = "";
let postedId = "";

async function id(sql: string, params: unknown[]): Promise<string> {
  const row = (await db.query<{ id: string }>(sql, params)).rows[0];
  if (row === undefined) throw new Error(`no row from: ${sql}`);
  return row.id;
}

async function seed(): Promise<void> {
  const propertyId = deterministicUuid("fixtures:property", PROPERTY_N);
  const known = await db.query("select 1 from public.properties where id = $1", [propertyId]);
  if (known.rowCount === 0) {
    await db.query("begin");
    await publishedProperty(db, {
      n: PROPERTY_N,
      editorial_state: "draft",
      published_at: null,
      submission_id: null,
    });
    await db.query("commit");
  }
  // A new asset revision each run gives each run its own two posts, so the retry's job key is always `:1`.
  const assetId = await id(
    `select (public.upsert_asset_stub(
       $1, 'carousel'::public.asset_kind,
       (select coalesce(max(revision), 0) + 1 from public.assets where property_id = $1 and kind = 'carousel'),
       null)).id as id`,
    [propertyId],
  );
  const schedule = "select (public.schedule_social_post($1, $2, now())).id as id";
  failedId = await id(schedule, [assetId, "x"]);
  await db.query("select public.fail_social_post($1, 'test')", [failedId]);
  postedId = await id(schedule, [assetId, "instagram"]);
  await db.query("select public.mark_social_post_posted($1, 'e2e-1', $2, array['instagram'])", [
    postedId,
    "https://www.instagram.com/p/e2e-channels/",
  ]);
}

test.beforeAll(async () => {
  await assertNotProduction();
  release = await holdDevLock();
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  db = new pg.Client({ connectionString: url });
  await db.connect();
  await seed();
});

test.afterAll(async () => {
  try {
    await db.query("select public.fail_social_post($1, 'test')", [failedId]);
  } finally {
    await db.end();
    await release();
  }
});

const postsTable = (page: Page) => page.getByRole("table", { name: "Posts", exact: true });

test("commercial sees the failed row and no Retry", async ({ browser }) => {
  const { context, page } = await signInAs(browser, COMMERCIAL);
  await page.goto(`/admin/channels?post=${failedId}`);
  await expect(postsTable(page).getByText("test", { exact: true })).toBeVisible();
  await expect(postsTable(page).getByText("Failed")).toBeVisible();
  await checkpoint(page, "/admin/channels (commercial)");
  await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "Account ids" })).toHaveCount(0);
  await context.close();
});

test("the failed row is red and Retry enqueues one post_x job for it", async ({ browser }) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  await page.goto(`/admin/channels?post=${failedId}`);
  await expect(postsTable(page).getByText("Failed")).toHaveAttribute("data-tone", "danger");
  await expect(postsTable(page).getByRole("row")).toHaveCount(2);
  const answered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/admin/channels/posts/${failedId}/retry`,
  );
  await page.getByRole("button", { name: "Retry" }).click();
  const dialog = page.getByRole("dialog", { name: "Retry the X post" });
  await expect(dialog).toBeVisible();
  await checkpoint(page, "/admin/channels (retry dialog)");
  await dialog.getByRole("button", { name: "Retry" }).click();
  expect((await answered).status()).toBe(200);
  const keys = await db.query<{ idempotency_key: string }>(
    "select idempotency_key from public.jobs where idempotency_key like $1",
    [`post_x:${failedId}:%`],
  );
  expect(keys.rows.map((row) => row.idempotency_key)).toEqual([`post_x:${failedId}:1`]);
  await context.close();
});

test("the posted row links to its post, and Facebook and YouTube are not enabled yet", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  await page.goto(`/admin/channels?post=${postedId}`);
  await expect(postsTable(page).getByRole("link", { name: "View post" })).toHaveAttribute(
    "href",
    "https://www.instagram.com/p/e2e-channels/",
  );
  for (const name of ["Facebook", "YouTube"]) {
    const card = page.getByRole("article", { name });
    await expect(card.getByText("Not enabled yet")).toBeVisible();
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("checkbox")).toHaveCount(0);
    await expect(card.getByRole("switch")).toHaveCount(0);
  }
  await expect(page.getByRole("form", { name: "Account ids" })).toHaveCount(3);
  await checkpoint(page, "/admin/channels");
  await context.close();
});

test("the posts list answers no-store", async ({ browser }) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  const header = await page.evaluate(async () => {
    const response = await fetch("/api/admin/channels/posts");
    return { status: response.status, cache: response.headers.get("cache-control") };
  });
  expect(header.status).toBe(200);
  expect(header.cache).toBe("no-store");
  await context.close();
});

import { expect, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { z } from "zod";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { pgClientConfig } from "../../scripts/lib/pg-connect.mjs";
import { formatPrice } from "../../src/domain/exposure";
import { holdDevLock } from "../fixtures/dev-lock";
import { checkpoint } from "./fixtures/a11y";
import { signInAs } from "./helpers/session";

// B18 step 3, the observed exit of the slice: an admin raises The Feature by 30 dollars in `/admin › Settings ›
// Products`, previews and saves it, and the site read, `/exposure` and `/` show the new price with no deploy. It
// commits a write to `settings.products`, so it holds the writer lock of G34 from `beforeAll` to the end of
// `afterAll` and puts the stored value back through `settings_put_products`, which audits it as the save was.

const ADMIN = "staff+ceo@matterofplace.com";
const RAISE = 30;
const POLL_MS = 2000;
const POLL_LIMIT_MS = 40_000;

const siteBody = z.object({
  products: z.array(z.object({ id: z.string(), name: z.string(), price: z.number() })),
});

let before: unknown = null;
let release: () => Promise<void> = () => Promise.resolve();

function dbUrl(): string {
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("exposure-products: DEV_DB_URL is not set");
  return url;
}

async function sql<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const client = new pg.Client(pgClientConfig(dbUrl()));
  await client.connect();
  try {
    return (await client.query<Row>(text, params)).rows;
  } finally {
    await client.end();
  }
}

/** The Feature as `GET /api/public/site` serves it, and the catalog version the answer was stored under. */
async function servedFeature(request: APIRequestContext) {
  const response = await request.get("/api/public/site");
  expect(response.status()).toBe(200);
  const feature = siteBody
    .parse(await response.json())
    .products.find((plan) => plan.id === "feature");
  if (feature === undefined) throw new Error("exposure-products: the site serves no feature plan");
  return { feature, version: Number(response.headers()["x-catalog-version"]) };
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  await assertNotProduction();
  release = await holdDevLock();
  const [row] = await sql<{ value: unknown }>(
    "select value from public.settings where key = 'products'",
  );
  if (row === undefined) throw new Error("exposure-products: settings.products is not seeded");
  before = row.value;
});

test.afterAll(async () => {
  try {
    if (before !== null) {
      await sql(
        "select public.settings_put_products($1::jsonb, null, 'human'::public.actor_kind, $2, 'e2e: exposure-products restore')",
        [JSON.stringify(before), `exposure-products:restore:${String(Date.now())}`],
      );
    }
  } finally {
    await release();
  }
});

test("a price saved in Settings reaches the site read, /exposure and / without a deploy", async ({
  browser,
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const start = await servedFeature(request);
  const raised = start.feature.price + RAISE;

  const { context, page: admin } = await signInAs(browser, ADMIN);
  try {
    await admin.goto("/admin/settings");
    const feature = admin.getByRole("group", { name: start.feature.name });
    await feature.getByLabel("Price", { exact: true }).fill(String(raised));
    await admin.getByRole("button", { name: "Preview", exact: true }).click();
    const preview = admin.getByRole("region", { name: "Preview" });
    await expect(preview.getByRole("list", { name: "Cards" })).toContainText(formatPrice(raised));
    await checkpoint(admin, "/admin/settings products preview");
    await admin.getByRole("button", { name: "Save plans" }).click();
    await admin.getByRole("button", { name: "Save the new prices" }).click();
    await expect(admin.getByText("Plans saved.")).toBeVisible();
  } finally {
    await context.close();
  }

  let served = start;
  const deadline = Date.now() + POLL_LIMIT_MS;
  while (served.feature.price !== raised && Date.now() < deadline) {
    await page.waitForTimeout(POLL_MS);
    served = await servedFeature(request);
  }
  expect(served.feature.price).toBe(raised);
  expect(served.version).toBeGreaterThan(start.version);

  for (const path of ["/exposure", "/"]) {
    await page.goto(path);
    const text = await page.locator("main").innerText();
    expect(text).toContain(formatPrice(raised));
    expect(text).not.toContain(formatPrice(start.feature.price));
    await request.get(path);
    expect((await request.get(path)).headers()["x-mop-cache"]).toBe("hit");
  }
});

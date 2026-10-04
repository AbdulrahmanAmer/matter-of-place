import { randomInt } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { z } from "zod";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { hashKey } from "../../src/server/lib/ids";
import { fill, t } from "../../src/lib/strings";
import { holdDevLock } from "../fixtures/dev-lock";
import { collect, expectNoOverflow } from "./fixtures/page";
import { runAxe } from "./fixtures/a11y";

// B3b step 8: the empty states of the launch site, read from the live build while `coming_soon_global` is on.
// `bun run test:e2e:coming-soon` sets the flag, runs this file in `coming-soon-desktop` and `coming-soon-phone`,
// and puts the flag back.

const stories = z.array(z.object({ slug: z.string() }));
const subscriberRow = z.object({ source: z.string(), markets: z.array(z.string()) });
// Each signup arrives from its own address: without `cf-connecting-ip` every call of the laptop shares one limit bucket
// of five an hour (`clientIp`), which a second run would exhaust.
const created: { email: string; ip: string }[] = [];

test.beforeAll(async ({ request }) => {
  const response = await request.get("/api/public/properties");
  expect(
    await response.json(),
    "the global flag is off: run `bun run test:e2e:coming-soon`, which turns it on",
  ).toEqual([]);
});

test.afterAll(async () => {
  if (created.length === 0) return;
  await assertNotProduction();
  const release = await holdDevLock();
  const salt = process.env["RATE_LIMIT_SALT"] ?? process.env["PREVIEW_RATE_LIMIT_SALT"] ?? "";
  const emails = created.map(({ email }) => email);
  const keys = await Promise.all(
    created.flatMap(({ email, ip }) => [hashKey(salt, ip), hashKey(salt, email)]),
  );
  const client = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
  try {
    await client.connect();
    await client.query("begin");
    await client.query("select set_config('mop.retention', 'on', true)");
    await client.query(
      "delete from subscribers where email = any($1) and source like 'interest:%'",
      [emails],
    );
    await client.query("delete from rate_limits where key_hash = any($1)", [keys]);
    const left = await client.query<{ n: number }>(
      "select count(*)::int as n from subscribers where email = any($1)",
      [emails],
    );
    await client.query("commit");
    expect(left.rows[0]?.n, "signup rows left behind").toBe(0);
  } finally {
    await client.end();
    await release();
  }
});

async function open(page: Page, path: string): Promise<void> {
  const seen = await collect(page);
  const response = await page.goto(path, { waitUntil: "networkidle" });
  expect(response?.status()).toBe(200);
  expect(seen.pageErrors).toEqual([]);
}

/**
 * No `img` inside `main` apart from story cards: stories stay visible under the global flag (rule 5) with their own
 * photographs, while a market, region or guide shows type only (S43). A failure prints the markup of each image.
 */
async function expectNoImages(page: Page): Promise<void> {
  const images = await page
    .locator("main img:not(.story-card img)")
    .evaluateAll((all) => all.map((img) => img.outerHTML));
  expect(images).toEqual([]);
}

test("home shows three market cards with the badge and no photograph", async ({ page }) => {
  await open(page, "/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".hero, .hero-image")).toHaveCount(0);
  await expect(page.locator(".property-card")).toHaveCount(0);
  const cards = page.locator(".market-card");
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) {
    await expect(card).toContainText(t.comingSoon.badge);
    await expect(card.locator("img")).toHaveCount(0);
  }
});

test("properties shows its title and no filter bar", async ({ page }) => {
  await open(page, "/properties");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("Properties");
  await expect(page.locator(".filter-bar")).toHaveCount(0);
  await expect(page.locator(".property-card")).toHaveCount(0);
});

test("california shows its empty state with the form and no image", async ({ page }) => {
  await open(page, "/california");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".coming-soon h2")).toHaveText(
    fill(t.comingSoon.market.title, { market: "California" }),
  );
  await expect(page.locator(".coming-soon .interest-form")).toBeVisible();
  await expectNoImages(page);
});

test("a region shows its empty state with the form and no image", async ({ page }) => {
  await open(page, "/california/bay-area");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".coming-soon h2")).toHaveText(
    fill(t.comingSoon.region.title, { region: "Bay Area" }),
  );
  await expect(page.locator(".coming-soon .interest-form")).toBeVisible();
  await expectNoImages(page);
});

test("the market guide has no image and one h1 reading California", async ({ page }) => {
  await open(page, "/california/guide");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1")).toHaveText("California");
  await expectNoImages(page);
});

test("stories lists the seeded stories under the global flag", async ({ page, request }) => {
  const seeded = stories.parse(await (await request.get("/api/public/stories")).json());
  expect(seeded.length, "the seed holds stories").toBeGreaterThan(0);
  await open(page, "/stories");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator(".story-card")).toHaveCount(seeded.length);
  await expect(page.locator(".coming-soon")).toHaveCount(0);
});

test("an interest signup creates one subscriber row for its market", async ({ page }) => {
  const email = `test+${Date.now().toString()}${randomInt(1000).toString()}@fixtures.invalid`;
  const ip = `10.${randomInt(256).toString()}.${randomInt(256).toString()}.${(randomInt(254) + 1).toString()}`;
  created.push({ email, ip });
  await page.route("**/api/public/subscribers", (route) =>
    route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": ip } }),
  );
  await open(page, "/california");
  await page.locator(".interest-email").fill(email);
  const reply = page.waitForResponse((response) =>
    response.url().endsWith("/api/public/subscribers"),
  );
  await page.locator(".interest-submit").click();
  const answer = await reply;
  expect(answer.status(), await answer.text()).toBeLessThan(300);
  await expect(page.locator(".interest-sent")).toBeVisible();

  await assertNotProduction();
  const client = new pg.Client({ connectionString: process.env["DEV_DB_URL"] });
  await client.connect();
  try {
    const rows = await client.query(
      "select source, markets::text[] as markets from subscribers where email = $1",
      [email],
    );
    expect(rows.rows).toHaveLength(1);
    expect(subscriberRow.parse(rows.rows[0])).toEqual({
      source: "interest:california",
      markets: ["california"],
    });
  } finally {
    await client.end();
  }
});

test("an unknown property is the 404 page", async ({ page }) => {
  const response = await page.goto("/property/anything", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText(/not on our map/);
});

const scanned = [
  "/",
  "/properties",
  "/california",
  "/california/bay-area",
  "/california/guide",
  "/stories",
];
for (const path of scanned) {
  test(`${path} has no serious axe violation and no horizontal overflow`, async ({ page }) => {
    await open(page, path);
    await runAxe(page, path);
    await expectNoOverflow(page);
  });
}

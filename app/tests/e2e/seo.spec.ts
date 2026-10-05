import { expect, test } from "@playwright/test";
import { z } from "zod";
import { committed, type Db } from "../fixtures/db";
import { publishedProperty } from "../fixtures/factories";

// B13 step 4: an archive page exists while three published properties share an architect and the `archive_pages`
// flag is on, and not after one of them is unpublished. Run on the live build, where the Worker reads the database:
// `E2E_TARGET=built E2E_MODE=live bunx playwright test --project=seo tests/e2e/seo.spec.ts`. The fixtures are committed
// because the Worker is another connection; the cleanup puts the flag back and deletes them.

const FIXTURE_SLUGS = [9101, 9102, 9103].map((n) => `fixture-property-${String(n)}`);
const ARCHIVE_PATH = "/archive/architect/fixture-architect";
const beacon = z.array(z.object({ event: z.string() }));
const flagsRow = z.object({ value: z.record(z.string(), z.unknown()) });

async function setUp(db: Db): Promise<unknown> {
  const state = await db.query<{ closed: boolean }>(
    `select coalesce((s ->> 'coming_soon_global')::boolean, false)
        or coalesce((s -> 'coming_soon_markets' ->> 'california')::boolean, false) as closed
     from (select public.public_state() as s) state`,
  );
  expect(
    state.rows[0]?.closed,
    "the market california is closed: its fixtures would be hidden",
  ).toBe(false);
  const original = flagsRow.parse(
    (await db.query("select value from public.settings where key = 'flags'")).rows[0],
  );
  await db.query("begin");
  await db.query(
    "update public.settings set value = jsonb_set(value, '{archive_pages}', 'true') where key = 'flags'",
  );
  for (const n of [9101, 9102, 9103]) {
    await publishedProperty(db, { n, architect: "Fixture Architect" });
  }
  await db.query("commit");
  return original.value;
}

async function cleanUp(db: Db, original: unknown): Promise<void> {
  await db.query("rollback");
  await db.query("begin");
  await db.query("select set_config('mop.retention', 'on', true)");
  if (original !== undefined) {
    await db.query("update public.settings set value = $1::jsonb where key = 'flags'", [
      JSON.stringify(original),
    ]);
  }
  await db.query("delete from public.properties where slug = any($1)", [FIXTURE_SLUGS]);
  await db.query("commit");
}

test("an archive page lists three published properties and is gone once one is unpublished", async ({
  page,
}) => {
  expect(process.env["E2E_MODE"], "run on the live build: E2E_MODE=live").toBe("live");
  let original: unknown;
  await committed(
    async (db) => {
      original = await setUp(db);
      const events: string[] = [];
      await page.route("**/api/public/events", async (route) => {
        const sent = beacon.safeParse(JSON.parse(route.request().postData() ?? "[]"));
        if (sent.success) events.push(...sent.data.map(({ event }) => event));
        await route.fulfill({ status: 204 });
      });

      const response = await page.goto(ARCHIVE_PATH, { waitUntil: "networkidle" });
      expect(response?.status()).toBe(200);
      const listed = await page
        .locator(".property-card")
        .evaluateAll((cards) => cards.map((card) => card.getAttribute("href")));
      expect(listed.sort()).toEqual(FIXTURE_SLUGS.map((slug) => `/property/${slug}`));
      // The queue leaves when the page is hidden (B3). Closing the page did not deliver the beacon to the route in this
      // browser, so the page is made hidden the way the browser reports it.
      await page.evaluate(() => {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect.poll(() => events.filter((event) => event === "archive_view").length).toBe(1);

      const property = await page.context().newPage();
      await property.goto(`/property/${FIXTURE_SLUGS[1] ?? ""}`, { waitUntil: "networkidle" });
      await expect(property.locator(`a[href="${ARCHIVE_PATH}"]`)).toHaveCount(1);

      await db.query("begin");
      await db.query("set local role service_role");
      await db.query(
        "update public.properties set editorial_state = 'archived', published_at = null, archived_at = now() where slug = $1",
        [FIXTURE_SLUGS[0]],
      );
      await db.query("commit");

      const gone = await page.context().request.get(ARCHIVE_PATH);
      expect(gone.status()).toBe(404);
      await property.reload({ waitUntil: "networkidle" });
      await expect(property.getByText("Fixture Architect")).toBeVisible();
      await expect(property.locator(`a[href="${ARCHIVE_PATH}"]`)).toHaveCount(0);
    },
    (db) => cleanUp(db, original),
  );
});

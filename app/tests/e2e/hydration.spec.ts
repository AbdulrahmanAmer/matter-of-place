import { expect, test } from "@playwright/test";
import { z } from "zod";
import { bumpCatalogVersion } from "../fixtures/catalog-version";
import { collect } from "./fixtures/page";
import { getDynamicRoutes } from "./fixtures/routes";

// B4 step 9 (F25 f, PERF-06): the server render dehydrates the catalog queries, so the browser makes no second fetch of
// the catalog on load; and the home document stays within its byte budget with the seeded catalog and carries list
// rows, not galleries. B3 owns the wiring in `src/router.tsx`; this is its proof, on the live artifact.

const DOCUMENT_BUDGET_BYTES = 122_880;

const dynamic = await getDynamicRoutes();
const firstMarket = dynamic.find((route) => route.routeClass === "market");
const firstProperty = dynamic.find((route) => route.routeClass === "property");
if (firstMarket === undefined || firstProperty === undefined) {
  throw new Error("the live API lists no market or property to open");
}

const pages = [
  { path: "/properties", expect: "property cards" },
  { path: firstMarket.path, expect: "a heading" },
  { path: firstProperty.path, expect: "a heading" },
];

// A Worker keeps the pages it stored across builds under the same release and version, so a page made by another
// build would be answered here: a new version makes every page of this run come from the build under test.
test.beforeAll(bumpCatalogVersion);

for (const { path, expect: content } of pages) {
  test(`${path} makes no catalog fetch on load and shows ${content}`, async ({ page }) => {
    await collect(page);
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (request.method() === "GET" && pathname.startsWith("/api/public/")) reads.push(pathname);
    });
    await page.goto(path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    expect(reads, "GET requests under /api/public/ after the server render").toEqual([]);
    await expect(page.locator("h1")).toHaveCount(1);
    if (path === "/properties") {
      expect(await page.locator(".property-card").count()).toBeGreaterThan(0);
    }
  });
}

test("the home document is within its byte budget and carries list rows, not galleries", async ({
  request,
}) => {
  const cards = z
    .array(z.object({ slug: z.string() }))
    .parse(await (await request.get("/api/public/properties")).json());
  const html = (await (await request.get("/")).body()).toString("utf8");
  expect(Buffer.byteLength(html), "bytes of the / document").toBeLessThanOrEqual(
    DOCUMENT_BUDGET_BYTES,
  );
  expect(html).toContain(`slug:"${cards[0]?.slug ?? ""}"`);
  expect(html).not.toContain("gallery:");
});

test("a client navigation from /properties reads only the property it opens", async ({ page }) => {
  await collect(page);
  await page.goto("/properties", { waitUntil: "networkidle" });
  const reads = new Set<string>();
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === "GET" && pathname.startsWith("/api/public/")) reads.add(pathname);
  });
  await page.locator(`a[href="${firstProperty.path}"]`).first().click();
  await expect(page).toHaveURL(firstProperty.path);
  await expect(page.locator("h1")).toHaveCount(1);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  expect([...reads], "GET requests under /api/public/ after the navigation").toEqual([
    `/api/public/properties/${firstProperty.path.replace("/property/", "")}`,
  ]);
});

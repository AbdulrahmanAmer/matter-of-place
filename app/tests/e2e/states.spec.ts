import { expect, test, type Page, type Route } from "@playwright/test";
import { t } from "../../src/lib/strings";

// H1-23: the states a visitor meets when something is missing, slow or broken. Run it against a live build
// (`E2E_MODE=live`): a local-mode build makes no API request, so the failing and slow reads cannot be forced.
// The page opened first is the home page; `/stories` reads a query the home page does not put in the hydrated
// cache, so clicking its footer link is a client navigation that makes the `/api/public/*` request the cases answer.

const notFoundHeading = "This place is not on our map.";
const errorHeading = "This page did not open as it should.";

async function openHome(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body"), "the build must be live (E2E_MODE=live)").toHaveAttribute(
    "data-services",
    "live",
  );
}

async function openStories(page: Page): Promise<void> {
  await page.locator("footer").getByRole("link", { name: t.nav.stories }).click();
}

const failedRead = (headers: Record<string, string>) => (route: Route) =>
  route.fulfill({
    status: 500,
    headers,
    contentType: "application/json",
    body: JSON.stringify({ error: { code: "server", requestId: "h1-states-body" } }),
  });

test("states: an unknown route answers HTTP 404 and shows the not-found page", async ({ page }) => {
  const response = await page.goto("/no-such-page-h1", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: notFoundHeading })).toBeVisible();
});

test("states: an unknown property slug answers HTTP 404 through notFound()", async ({ page }) => {
  const response = await page.goto("/property/no-such-property-h1", { waitUntil: "networkidle" });
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: notFoundHeading })).toBeVisible();
});

test("states: a failed read shows the request id of the response header, not the body's", async ({
  page,
}) => {
  await openHome(page);
  await page.route("**/api/public/**", failedRead({ "x-request-id": "h1-states-id" }));
  await openStories(page);
  await expect(page.getByRole("heading", { name: errorHeading })).toBeVisible();
  await expect(page.getByText("h1-states-body")).toHaveCount(0);
  await expect(page.getByText(`${t.errors.reference} h1-states-id`)).toBeVisible();
});

test("states: a failed read without the header shows the request id of the body", async ({
  page,
}) => {
  await openHome(page);
  await page.route("**/api/public/**", failedRead({}));
  await openStories(page);
  await expect(page.getByRole("heading", { name: errorHeading })).toBeVisible();
  await expect(page.getByText(`${t.errors.reference} h1-states-body`)).toBeVisible();
});

test("states: a read that takes two seconds shows the loading skeleton, then the page", async ({
  page,
}) => {
  await openHome(page);
  await page.route("**/api/public/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await openStories(page);
  await expect(page.locator("[data-pending]")).toBeVisible({ timeout: 1900 });
  await expect(page.getByRole("heading", { name: "Stories", level: 1 })).toBeVisible();
  await expect(page.locator("[data-pending]")).toHaveCount(0);
});

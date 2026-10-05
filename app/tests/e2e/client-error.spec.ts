import { expect, test } from "@playwright/test";
import { z } from "zod";
import { collect } from "./fixtures/page";
import { getDynamicRoutes } from "./fixtures/routes";

// B4 step 9 (FE-09): a page that fails to load in the browser is reported once per page load. The property read answers
// malformed JSON during a client navigation from the list; the error page reports it with the property path as its
// route; a second identical failure on the same page load sends nothing (the dedupe of `reportClientError`).

const firstProperty = (await getDynamicRoutes()).find((route) => route.routeClass === "property");
if (firstProperty === undefined) throw new Error("the live API lists no property to open");
const slug = firstProperty.path.replace("/property/", "");

const report = z.object({ message: z.string(), route: z.string() });

test("a failed client navigation is reported once per page load", async ({ page }) => {
  await collect(page);
  const reports: z.infer<typeof report>[] = [];
  let failedReads = 0;
  await page.route("**/api/public/client-error", async (route) => {
    reports.push(report.parse(route.request().postDataJSON()));
    await route.fulfill({ status: 204 });
  });
  await page.route(`**/api/public/properties/${slug}`, async (route) => {
    failedReads += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: "{" });
  });

  await page.goto("/properties", { waitUntil: "networkidle" });
  await page.locator(`a[href="${firstProperty.path}"]`).first().click();
  await expect(
    page.getByRole("heading", { name: "This page did not open as it should." }),
  ).toBeVisible();
  await expect.poll(() => reports.length).toBe(1);
  expect(reports[0]?.route).toBe(firstProperty.path);

  const readsBefore = failedReads;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => failedReads).toBeGreaterThan(readsBefore);
  await expect(
    page.getByRole("heading", { name: "This page did not open as it should." }),
  ).toBeVisible();
  await page.waitForTimeout(1000);
  expect(reports).toHaveLength(1);
});

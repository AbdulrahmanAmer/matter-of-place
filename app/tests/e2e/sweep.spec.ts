import { expect, test } from "@playwright/test";
import { runAxe } from "./fixtures/a11y";
import { expectJsonLd } from "./fixtures/jsonld";
import { collect, expectNoOverflow } from "./fixtures/page";
import {
  getDynamicRoutes,
  notFoundRoute,
  seoFileRoutes,
  sitemapRoute,
  staticRoutes,
} from "./fixtures/routes";

// B4 step 5: every page route at 1440x900 (project desktop) and 390x844 (project phone).
const pageRoutes = [...staticRoutes, ...(await getDynamicRoutes()), notFoundRoute];

for (const route of pageRoutes) {
  test(route.path, async ({ page }) => {
    const seen = await collect(page);
    const response = await page.goto(route.path, { waitUntil: "networkidle" });
    expect(response?.status()).toBe(route.routeClass === "notFound" ? 404 : 200);

    // Soft: one run reports every structural problem of the route, and the scans below still run.
    await expect.soft(page.locator("html")).toHaveAttribute("lang", "en");
    await expect.soft(page.locator("main")).toHaveCount(1);
    await expect.soft(page.locator("h1")).toHaveCount(1);
    expect
      .soft((await page.title()).match(/Matter of Place/g), "the brand appears once in the title")
      .toHaveLength(1);
    await expect.soft(page.locator('meta[name="description"]')).toHaveAttribute("content", /\S/);
    await expect
      .soft(page.locator('link[rel="canonical"]'))
      .toHaveAttribute("href", /^https?:\/\//);
    await expect.soft(page.locator("img:not([alt])")).toHaveCount(0);
    expect.soft(seen.consoleErrors).toEqual([]);
    expect.soft(seen.pageErrors).toEqual([]);
    expect.soft(seen.failedResponses).toEqual([]);

    await expectNoOverflow(page);
    await runAxe(page, route.path);
    await expectJsonLd(page, route.routeClass);
    process.stdout.write("jsonld ok [" + test.info().project.name + "] " + route.path + "\n");
  });

  test(`overflow ${route.path} @overflow`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: "networkidle" });
    await expectNoOverflow(page);
  });
}

test(sitemapRoute, async ({ request }) => {
  const response = await request.get(sitemapRoute);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");
});

for (const path of seoFileRoutes) {
  test(path, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/plain");
  });
}

for (const path of seoFileRoutes.filter((item) => item.startsWith("/llms"))) {
  test(`${path} format`, async ({ request }) => {
    const text = await (await request.get(path)).text();
    expect(text).toMatch(/^# \S/);
    const links = [...text.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
    expect(links.filter((link) => !link?.startsWith("https://"))).toEqual([]);
  });
}

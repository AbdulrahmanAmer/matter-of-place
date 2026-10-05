import { expect, test } from "@playwright/test";

// B17: the essentials slice in a real browser. Each title starts with the `-g` name the plan's steps use.

test.describe("fonts", () => {
  test("fonts: the home page asks no third party for a font and draws Jost from its own files", async ({
    page,
  }) => {
    const requested: string[] = [];
    page.on("request", (request) => requested.push(request.url()));
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    const origin = new URL(page.url()).origin;
    const faces = requested.filter((url) => /\.woff2(\?|$)/.test(url));
    expect(faces.length).toBeGreaterThan(0);
    for (const url of faces) expect(new URL(url).origin).toBe(origin);
    expect(requested.filter((url) => /fonts\.(googleapis|gstatic)\.com/.test(url))).toEqual([]);
    expect(await page.evaluate(() => document.fonts.check('16px "Jost"'))).toBe(true);
  });
});

test.describe("meta", () => {
  test("meta-theme-color: the home page names the browser chrome colour", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      "content",
      /^#[0-9A-Fa-f]{6}$/,
    );
  });

  test("meta: the home page carries a canonical link, Open Graph and a Twitter card", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
    await expect(page.locator('meta[property="og:title"]')).toHaveCount(1);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      "content",
      "summary_large_image",
    );
  });
});

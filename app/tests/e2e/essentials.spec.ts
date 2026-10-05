import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { t } from "../../src/lib/strings";

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

// Invariants 7 to 9: the analytics choice with and without JavaScript, Global Privacy Control, one cached page.
const GOOGLE_HOST = /(^|\.)(googletagmanager|google-analytics)\.com$/;
const choice = z.object({ version: z.number(), analytics: z.boolean() });

const notice = (page: Page) => page.getByRole("region", { name: t.consent.label });

async function storedChoice(page: Page) {
  const raw = await page.evaluate(() => localStorage.getItem("mop_consent"));
  return raw === null ? undefined : choice.parse(JSON.parse(raw));
}

/** Records the host of every request the page makes from now on. */
function hostsOf(page: Page): string[] {
  const hosts: string[] = [];
  page.on("request", (request) => hosts.push(new URL(request.url()).hostname));
  return hosts;
}

test.describe("consent", () => {
  test("consent-gpc: with Global Privacy Control on, no Google request follows Allow or a reload", async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "Sec-GPC": "1" });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true });
    });
    const hosts = hostsOf(page);
    await page.goto("/", { waitUntil: "networkidle" });
    await notice(page).getByRole("button", { name: t.consent.accept }).click();
    await page.reload({ waitUntil: "networkidle" });
    expect(await storedChoice(page)).toMatchObject({ analytics: true });
    expect(hosts.filter((host) => GOOGLE_HOST.test(host))).toEqual([]);
  });

  test("consent-gpc-header: /api/consent turns accept into decline for Sec-GPC: 1 and says no-store", async ({
    request,
    baseURL,
  }) => {
    const referer = `${baseURL ?? ""}/properties`;
    const gpc = await request.get("/api/consent?set=accept", {
      headers: { "Sec-GPC": "1", Referer: referer },
      maxRedirects: 0,
    });
    expect(gpc.status()).toBe(303);
    expect(gpc.headers()["location"]).toBe("/properties");
    expect(gpc.headers()["set-cookie"]).toContain("mop_consent=1.0;");
    expect(gpc.headers()["cache-control"]).toContain("no-store");
    const plain = await request.get("/api/consent?set=accept", { maxRedirects: 0 });
    expect(plain.headers()["set-cookie"]).toContain("mop_consent=1.1;");
    expect((await request.get("/api/consent?set=maybe", { maxRedirects: 0 })).status()).toBe(400);
  });

  test("consent-reopen: Cookie settings shows the notice again without leaving the page", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await notice(page).getByRole("button", { name: t.consent.decline }).click();
    await expect(notice(page)).toHaveCount(0);
    const navigations: string[] = [];
    page.on("framenavigated", (frame) => navigations.push(frame.url()));
    await page.locator("#consent-change").click();
    await expect(notice(page)).toBeVisible();
    expect(navigations).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("consent-privacy-choices: No, thank you after Allow leaves analytics off, says so, and a reload asks Google for nothing", async ({
    page,
    context,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await notice(page).getByRole("button", { name: t.consent.accept }).click();
    expect(await storedChoice(page)).toMatchObject({ analytics: true });
    await page.goto("/privacy-choices", { waitUntil: "networkidle" });
    await expect(page.getByRole("status")).toHaveText(t.privacyChoices.on);
    await page.getByRole("link", { name: t.consent.decline }).click();
    await expect(page.getByRole("status")).toHaveText(t.privacyChoices.off);
    expect(await storedChoice(page)).toMatchObject({ analytics: false });
    expect(new URL(page.url()).pathname).toBe("/privacy-choices");
    const cookie = (await context.cookies()).find((entry) => entry.name === "mop_consent");
    expect(cookie?.value).toBe("1.0");
    const hosts = hostsOf(page);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("status")).toHaveText(t.privacyChoices.off);
    expect(hosts.filter((host) => GOOGLE_HOST.test(host))).toEqual([]);
  });

  test("consent-html: / is byte-identical with and without a mop_consent cookie and Sec-GPC", async ({
    request,
  }) => {
    const plain = await (await request.get("/")).text();
    for (const cookie of ["mop_consent=1.1", "mop_consent=1.0"]) {
      const other = await request.get("/", { headers: { Cookie: cookie, "Sec-GPC": "1" } });
      expect(await other.text()).toBe(plain);
    }
  });
});

test.describe("consent without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("consent-noscript: the notice's No, thank you link sets the cookie and its answer is no-store", async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const answer = page.waitForResponse((response) => response.url().includes("/api/consent"));
    await page.getByRole("link", { name: t.consent.decline }).click();
    const response = await answer;
    expect(response.status()).toBe(303);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const cookie = (await context.cookies()).find((entry) => entry.name === "mop_consent");
    expect(cookie?.value).toBe("1.0");
    expect(new URL(page.url()).pathname).toBe("/");
  });
});

test.describe("footer-links", () => {
  test("footer-links: the footer links the legal pages and Cookie settings on every page", async ({
    page,
  }) => {
    test.fixme(true, "BLOCKED until B16");
    await page.goto("/");
    for (const href of ["/privacy", "/terms", "/accessibility", "/privacy#do-not-sell"]) {
      await expect(page.locator(`footer a[href="${href}"]`)).toHaveCount(1);
    }
    await expect(page.locator('footer a#consent-change[href="/privacy-choices"]')).toHaveCount(1);
  });
});

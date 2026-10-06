import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { t } from "../../src/lib/strings";
import { getDynamicRoutes } from "./fixtures/routes";

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

  test("consent-link-beats-record: a decline made by the plain link after an Allow is the choice the page shows", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await notice(page).getByRole("button", { name: t.consent.accept }).click();
    expect(await storedChoice(page)).toMatchObject({ analytics: true });
    await page.goto("/api/consent?set=decline", {
      referer: new URL("/privacy-choices", page.url()).href,
    });
    await expect(page.getByRole("status")).toHaveText(t.privacyChoices.off);
    expect(await storedChoice(page)).toMatchObject({ analytics: true });
  });

  // `?preview=` is never cached (neverCached), so every response below is a render the server just made. A stored
  // copy would answer all three alike whatever a render did with the cookie. Millisecond timestamps (the router's
  // `u:`, the query cache's `dehydratedAt`) differ per render and are zeroed.
  test("consent-html: a fresh render of / is byte-identical with and without a mop_consent cookie and Sec-GPC", async ({
    request,
  }) => {
    const render = async (headers: Record<string, string>) => {
      const response = await request.get("/?preview=consent", { headers });
      expect(response.headers()["x-mop-cache"]).toBeUndefined();
      expect(response.headers()["cache-control"]).toBe("no-store");
      return (await response.text()).replace(/\b\d{13}\b/g, "0");
    };
    const plain = await render({});
    expect(plain).toContain("<footer");
    for (const cookie of ["mop_consent=1.1", "mop_consent=1.0"]) {
      expect(await render({ Cookie: cookie, "Sec-GPC": "1" })).toBe(plain);
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

// Invariant 12: the keyboard reaches and leaves every overlay, and a field error is described.
const propertyRoutes = (await getDynamicRoutes()).filter(
  (route) => route.routeClass === "property",
);
const propertyPath = propertyRoutes[0]?.path ?? "";
/** The illustrative property that carries a film, when the build has it. */
const filmPaths = propertyRoutes
  .map((route) => route.path)
  .filter((path) => path.endsWith("/tiburon-waterline"));

/** What the focused element shows: `drawn` when it has an outline of 2 px or more or a box shadow; null on the page itself. */
const focusState = (page: Page) =>
  page.evaluate(() => {
    const node = document.activeElement;
    if (!node || node === document.body) return null;
    const style = getComputedStyle(node);
    return {
      drawn:
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2) ||
        style.boxShadow !== "none",
      name: `${node.tagName.toLowerCase()}.${node.className}`,
      opensFilters: node.getAttribute("aria-controls") === "property-filters",
    };
  });

/** Tabs through an open dialog once and a half, so the wrap from the last stop to the first is crossed. */
async function expectTabStaysIn(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const stops = await dialog.locator("a[href], button, input, textarea, select").count();
  for (let press = 0; press < stops + 2; press += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    expect((await focusState(page))?.drawn, "the focused control shows a ring").toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
}

async function expectEscapeReturns(page: Page, opener: ReturnType<Page["getByRole"]>) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
}

/** The longest time any running animation of the page will last, in milliseconds (Infinity for a loop). */
const longestAnimation = (page: Page) =>
  page.evaluate(() =>
    Math.max(
      0,
      ...document
        .getAnimations()
        .map((animation) => Number(animation.effect?.getComputedTiming().activeDuration ?? 0)),
    ),
  );

test.describe("a11y-reduced-motion", () => {
  test("a11y-reduced-motion: a property page's scroll cue drifts for ever by default, and not when the visitor asks for less motion", async ({
    page,
  }) => {
    await page.goto(propertyPath, { waitUntil: "networkidle" });
    expect(await longestAnimation(page)).toBeGreaterThan(1000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(propertyPath, { waitUntil: "networkidle" });
    expect(await longestAnimation(page)).toBeLessThan(1);
  });
});

test.describe("a11y-keyboard", () => {
  test("a11y-keyboard: the skip link is the first Tab stop and moves focus below the header", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: t.header.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("#content")).toBeFocused();
    expect(new URL(page.url()).hash).toBe("#content");
  });

  test("a11y-keyboard: Tab stays inside the open menu panel, Escape closes it and focus returns to the menu button", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const opener = page.getByRole("button", { name: t.header.openMenu });
    test.skip(!(await opener.isVisible()), "the menu button shows only on narrow screens");
    await opener.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: "Menu" });
    await expect(panel).toBeVisible();
    await expectTabStaysIn(page, panel);
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole("button", { name: t.header.openMenu })).toBeFocused();
  });

  test("a11y-keyboard: Tab stays inside the open search overlay, Escape closes it and focus returns to the search button", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const opener = page.getByRole("button", { name: t.header.search });
    await opener.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("dialog", { name: t.header.search });
    await expect(panel).toBeVisible();
    await expectTabStaysIn(page, panel);
    await expectEscapeReturns(page, opener);
  });

  test("a11y-keyboard: Tab stays inside the open inquiry dialog, Escape closes it and focus returns to the button that opened it", async ({
    page,
  }) => {
    await page.goto(propertyPath, { waitUntil: "networkidle" });
    const opener = page
      .getByRole("button", { name: "Request a private showing", exact: true })
      .first();
    await opener.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expectTabStaysIn(page, dialog);
    await expectEscapeReturns(page, opener);
  });

  test("a11y-keyboard: an inquiry dialog opened again shows no error from the last time", async ({
    page,
  }) => {
    await page.goto(propertyPath, { waitUntil: "networkidle" });
    const opener = page
      .getByRole("button", { name: "Request a private showing", exact: true })
      .first();
    await opener.focus();
    await page.keyboard.press("Enter");
    const name = page.locator('.inquiry-dialog input[name="name"]');
    await page
      .locator(".inquiry-dialog")
      .getByRole("button", { name: t.common.send, exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(name).toBeVisible();
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
  });

  test("a11y-keyboard: the gallery is one Tab stop and ArrowRight moves to the next image", async ({
    page,
  }) => {
    await page.goto(propertyPath, { waitUntil: "networkidle" });
    const gallery = page.getByRole("region", { name: /^Photography of the/ });
    await gallery.focus();
    await expect(gallery).toBeFocused();
    const before = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => page.evaluate(() => window.scrollY)).not.toBe(before);
  });

  test("a11y-keyboard: the filter button on /properties opens with Enter and closes with Space", async ({
    page,
  }) => {
    await page.goto("/properties", { waitUntil: "networkidle" });
    const toggle = page.getByRole("button", { name: /^Filter/ });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  test("a11y-keyboard: every Tab stop of the home page, /properties with its filters open, /stories and two property pages draws a focus ring", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const unringed: string[] = [];
    for (const path of ["/", "/properties", "/stories", propertyPath, ...filmPaths]) {
      await page.goto(path, { waitUntil: "networkidle" });
      await page.evaluate(() => {
        document.documentElement.style.scrollBehavior = "auto";
      });
      for (let press = 0; press < 250; press += 1) {
        await page.keyboard.press("Tab");
        const stop = await focusState(page);
        if (stop === null) break;
        if (stop.opensFilters) await page.keyboard.press("Enter");
        if (!stop.drawn) unringed.push(`${path} ${stop.name}`);
      }
    }
    expect(unringed).toEqual([]);
  });

  test("a11y-keyboard: the ring is Obsidian on the page and Bone over the home photograph", async ({
    page,
  }) => {
    const ringOfBrand = async (path: string) => {
      await page.goto(path, { waitUntil: "networkidle" });
      for (let press = 0; press < 20; press += 1) {
        await page.keyboard.press("Tab");
        if (await page.evaluate(() => document.activeElement?.classList.contains("header-brand"))) {
          break;
        }
      }
      return page.evaluate(
        () => getComputedStyle(document.activeElement ?? document.body).outlineColor,
      );
    };
    expect(await ringOfBrand("/")).toBe("rgb(245, 242, 235)");
    expect(await ringOfBrand("/contact")).toBe("rgb(17, 17, 15)");
  });

  test("a11y-keyboard: a submitted empty required field is invalid and described by visible error text", async ({
    page,
  }) => {
    await page.goto("/contact", { waitUntil: "networkidle" });
    const send = page.getByRole("button", { name: t.common.send, exact: true });
    await send.focus();
    await page.keyboard.press("Enter");
    const name = page.locator('input[name="name"]');
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    const describedBy = await name.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const error = page.locator(`[id="${describedBy ?? ""}"]`);
    await expect(error).toBeVisible();
    await expect(error).toHaveText(t.forms.fieldRequired);
    await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
    await name.fill("Ada");
    await expect(name).not.toHaveAttribute("aria-invalid", "true");
  });
});

test.describe("not-found", () => {
  test("not-found: an unknown path answers 404 with a GET search of /properties through one labelled q field", async ({
    page,
  }) => {
    expect((await page.goto("/nope"))?.status()).toBe(404);
    const form = page.locator('form[action="/properties"]');
    await expect(form).toHaveAttribute("method", "get");
    await expect(form.locator('[name="q"]')).toHaveCount(1);
    await expect(form.getByRole("searchbox", { name: t.notFound.searchLabel })).toHaveAttribute(
      "name",
      "q",
    );
  });
});

// Invariant 19: a failed read on a client navigation names its request id; the offline worker keeps the shell only.
test.describe("error-id", () => {
  test("error-id: a failed API read on a client navigation shows the request id as its reference", async ({
    page,
  }) => {
    test.skip(process.env["E2E_MODE"] !== "live", "a local-mode build makes no API request");
    await page.goto("/", { waitUntil: "networkidle" });
    // /stories reads the stories query, which the home page does not put in the hydrated cache.
    await page.route("**/api/public/**", (route) =>
      route.fulfill({
        status: 500,
        headers: { "x-request-id": "b17-id" },
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "server", requestId: "b17-id" } }),
      }),
    );
    await page.locator("footer").getByRole("link", { name: t.nav.stories }).click();
    await expect(page.getByText(`${t.errors.reference} b17-id`)).toBeVisible();
  });
});

/** Opens `/` and says whether it is served from the host its build names (the canonical link's), where the worker registers. */
async function onOwnHost(page: Page): Promise<boolean> {
  await page.goto("/", { waitUntil: "networkidle" });
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  return new URL(canonical ?? "/", page.url()).hostname === new URL(page.url()).hostname;
}

/** Every cache name and the path of every entry the page's origin holds. */
const cacheContents = (page: Page) =>
  page.evaluate(async () => {
    const names = await caches.keys();
    const paths: string[] = [];
    for (const name of names) {
      const entries = await (await caches.open(name)).keys();
      paths.push(...entries.map((entry) => new URL(entry.url).pathname));
    }
    return { names, paths };
  });

test.describe("service-worker", () => {
  test("service-worker: registers once on the site's own host, keeps only the shell, and shows /offline.html offline", async ({
    page,
    context,
  }) => {
    test.skip(!(await onOwnHost(page)), "this build names another host (VITE_SITE_URL)");
    await page.evaluate(() => navigator.serviceWorker.ready);
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(1);
    const { names, paths } = await cacheContents(page);
    expect(names).toEqual(["mop-shell-v1"]);
    expect(paths).toContain("/offline.html");
    expect(paths.filter((path) => path.startsWith("/api/") || path.startsWith("/admin"))).toEqual(
      [],
    );
    await page.goto("/nope");
    await context.setOffline(true);
    try {
      await page.reload();
      await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    } finally {
      await context.setOffline(false);
    }
  });

  test("service-worker: registers nothing on a host other than the one the build names", async ({
    page,
  }) => {
    test.skip(await onOwnHost(page), "this build names this host (VITE_SITE_URL)");
    expect(
      await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
    ).toBe(0);
    expect((await cacheContents(page)).names).toEqual([]);
  });
});

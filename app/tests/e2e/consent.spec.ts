import { expect, test, type Locator, type Page } from "@playwright/test";
import { z } from "zod";
import { CONSENT_VERSION } from "../../src/lib/consent";
import { t } from "../../src/lib/strings";

// B3b step 8: the analytics choice (GP-02) in a real browser, against the live build with the flag off.
// Loading Google Analytics after consent is B13's test.

const GOOGLE_HOST = /(^|\.)(googletagmanager|google-analytics)\.com$/;
const record = z.object({ version: z.number(), analytics: z.boolean() });
const batch = z.array(z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) }));
const landing = "/?utm_source=instagram&utm_medium=social&utm_campaign=s";

const notice = (page: Page) => page.getByRole("region", { name: t.consent.label });
const allow = (page: Page) => notice(page).getByRole("button", { name: t.consent.accept });
const decline = (page: Page) => notice(page).getByRole("button", { name: t.consent.decline });

async function stored(page: Page): Promise<z.infer<typeof record> | undefined> {
  const raw = await page.evaluate(() => localStorage.getItem("mop_consent"));
  return raw === null ? undefined : record.parse(JSON.parse(raw));
}

/** The `getBoundingClientRect()` box of an element, in viewport coordinates. */
function box(locator: Locator) {
  return locator.evaluate((element) => {
    const { top, bottom, left, right } = element.getBoundingClientRect();
    return { top, bottom, left, right };
  });
}

/** Tells the page it is hidden: the analytics queue flushes on `visibilitychange`. */
async function hide(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function scrollThrough(page: Page): Promise<void> {
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let top = 0; top <= height; top += 400) {
    await page.evaluate((y) => {
      window.scrollTo(0, y);
    }, top);
  }
  await page.waitForLoadState("networkidle");
}

/**
 * Copies every beacon body to `window.__beacons` (Playwright reports a beacon request without its body). Install it
 * before `goto`; `events` then reads the first-party envelopes the page has sent.
 */
async function recordBeacons(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const bodies: string[] = [];
    Object.defineProperty(window, "__beacons", { value: bodies });
    const send = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      if (data instanceof Blob) void data.text().then((text) => bodies.push(text));
      return send(url, data);
    };
  });
}

async function events(page: Page): Promise<z.infer<typeof batch>> {
  const bodies = await page.evaluate((): unknown => Reflect.get(window, "__beacons"));
  return z
    .array(z.string())
    .parse(bodies)
    .flatMap((body) => batch.parse(JSON.parse(body)));
}

test("a first visit makes no request to a Google host", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).hostname));
  await page.goto("/", { waitUntil: "networkidle" });
  await scrollThrough(page);
  await expect(notice(page)).toBeVisible();
  expect([...hosts].filter((host) => GOOGLE_HOST.test(host))).toEqual([]);
  const scripts = await page.evaluate(() =>
    [...document.scripts].map((script) => `${script.src} ${script.textContent}`),
  );
  expect(scripts.filter((script) => /googletagmanager|google-analytics/.test(script))).toEqual([]);
});

test("the notice sits in the footer and is not fixed", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("footer").getByRole("region", { name: t.consent.label })).toBeVisible();
  const position = await notice(page).evaluate((element) => getComputedStyle(element).position);
  expect(["fixed", "sticky"]).not.toContain(position);
});

test("Allow stores the choice and a reload keeps it", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await allow(page).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: true });
  await page.reload({ waitUntil: "networkidle" });
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: true });
  await expect(notice(page)).toHaveCount(0);
});

test("No thank you stores analytics false", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await decline(page).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: false });
});

test("an allowed choice sends the campaign attribution", async ({ page }) => {
  await recordBeacons(page);
  await page.goto(landing, { waitUntil: "networkidle" });
  await allow(page).click();
  await hide(page);
  await expect
    .poll(
      async () =>
        (await events(page)).find((envelope) => envelope.event === "consent_set")?.data["utm"],
    )
    .toEqual({ utm_source: "instagram", utm_medium: "social", utm_campaign: "s" });
});

test("with Global Privacy Control on, Allow is stored and consent is still not granted", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true });
  });
  await recordBeacons(page);
  await page.goto(landing, { waitUntil: "networkidle" });
  await allow(page).click();
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: true });
  await hide(page);
  await expect
    .poll(async () => (await events(page)).some((envelope) => envelope.event === "consent_set"))
    .toBe(true);
  expect((await events(page)).filter((envelope) => "utm" in envelope.data)).toEqual([]);
});

test("the focused Allow has a visible outline that differs from the footer, and focus moves on", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await notice(page).getByRole("link").focus();
  await page.keyboard.press("Tab");
  await expect(allow(page)).toBeFocused();
  const measured = await allow(page).evaluate((button) => {
    const style = getComputedStyle(button);
    const footer = button.closest("footer");
    return {
      focusVisible: button.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      footerBackground: footer === null ? "" : getComputedStyle(footer).backgroundColor,
    };
  });
  expect(measured.focusVisible).toBe(true);
  expect(measured.outlineStyle).not.toBe("none");
  expect(measured.outlineWidth).not.toBe("0px");
  expect(measured.outlineColor).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  expect(measured.footerBackground).not.toBe("");
  expect(measured.outlineColor).not.toBe(measured.footerBackground);

  await page.keyboard.press("Enter");
  await expect(notice(page)).toHaveCount(0);
  const landed = await page.evaluate(() => document.activeElement?.id ?? "");
  testInfo.annotations.push({ type: "focus after Allow by keyboard", description: landed });
  expect(landed).toBe("consent-change");
});

test("on a property page the notice and the sticky action bar do not overlap", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the action bar is a phone control");
  await page.goto("/properties", { waitUntil: "networkidle" });
  const href = await page.locator("a.property-card").first().getAttribute("href");
  expect(href, "the full seed lists a property").not.toBeNull();
  await page.goto(href ?? "", { waitUntil: "networkidle" });
  await expect(page.locator(".sticky-actions")).toBeVisible();
  await expect(notice(page)).toBeAttached();
  await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const bar = await box(page.locator(".sticky-actions"));
  const cookie = await box(notice(page));
  const apart =
    bar.bottom <= cookie.top ||
    cookie.bottom <= bar.top ||
    bar.right <= cookie.left ||
    cookie.right <= bar.left;
  expect(apart, `bar ${JSON.stringify(bar)} against notice ${JSON.stringify(cookie)}`).toBe(true);
});

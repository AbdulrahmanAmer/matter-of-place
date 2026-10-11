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

// Ruling H85: the notice is a slim bar fixed to the bottom of the screen on every page but a property page. These
// run once per project, at the width the operator named: the phone project is 390px, the desktop project is set to 1280px.
const sizes = [
  { project: "phone", width: 390, height: 844, lines: 2, tallest: 120 },
  { project: "desktop", width: 1280, height: 800, lines: 1, tallest: 72 },
] as const;

function only(project: string): void {
  test.skip(test.info().project.name !== project, `this case runs in the ${project} project`);
}

/** Waits until the page has stopped scrolling: the site scrolls smoothly, so a focus move lands later. */
async function still(page: Page): Promise<void> {
  let last = -1;
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => window.scrollY);
        const same = y === last;
        last = y;
        return same;
      },
      { intervals: [150] },
    )
    .toBe(true);
}

/** The focused element, and whether it shows below the top of the bar; undefined when nothing is focused. */
async function focusedUnderBar(
  page: Page,
): Promise<{ label: string; covered: boolean } | undefined> {
  return page.evaluate(() => {
    const element = document.activeElement;
    const bar = document.querySelector(".consent-bar");
    if (element === null || bar === null || element === document.body) return undefined;
    const rect = element.getBoundingClientRect();
    const barTop = bar.getBoundingClientRect().top;
    const showing =
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top < innerHeight &&
      rect.bottom > 0 &&
      rect.left < innerWidth &&
      rect.right > 0;
    return {
      label: `${element.tagName} ${element.textContent.trim().slice(0, 30)}: bottom ${String(rect.bottom)} under bar top ${String(barTop)}`,
      covered: !bar.contains(element) && showing && rect.bottom > barTop + 0.5,
    };
  });
}

for (const { project, width, height, lines, tallest } of sizes) {
  test.describe(`at ${String(width)}px`, () => {
    test.use({ viewport: { width, height } });

    test(`${String(width)}px: the notice is a cookie popup inside the first viewport`, async ({
      page,
    }) => {
      only(project);
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(notice(page)).toBeVisible();
      await expect(notice(page)).toBeInViewport({ ratio: 1 });
      const bar = await notice(page).evaluate((element) => {
        const style = getComputedStyle(element);
        const text = element.querySelector(".consent-text");
        const { top, bottom, height: tall } = element.getBoundingClientRect();
        return {
          position: style.position,
          top,
          bottom,
          tall,
          lines: Math.round(
            (text?.getBoundingClientRect().height ?? 0) /
              parseFloat(text === null ? "1" : getComputedStyle(text).lineHeight),
          ),
          background: style.backgroundColor,
          color: style.color,
          shadow: style.boxShadow,
          image: style.backgroundImage,
          borderTop: style.borderTopWidth,
          buttons: [...element.querySelectorAll("button")].map(
            (button) => button.getBoundingClientRect().height,
          ),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(bar.position).toBe("fixed");
      // The popup (operator 2026-10-11): a card 24px above the bottom on a wide screen, flush on a phone; a title,
      // up to three lines of text and the two buttons.
      expect(Math.round(bar.bottom)).toBeGreaterThanOrEqual(height - 24);
      expect(bar.lines).toBeLessThanOrEqual(lines + 2);
      expect(bar.tall).toBeLessThanOrEqual(tallest + 240);
      expect({
        background: bar.background,
        color: bar.color,
        shadow: bar.shadow,
        image: bar.image,
        borderTop: bar.borderTop,
      }).toEqual({
        background: "rgb(245, 242, 235)",
        color: "rgb(17, 17, 15)",
        shadow: "none",
        image: "none",
        borderTop: "1px",
      });
      expect(bar.buttons).toHaveLength(2);
      expect(Math.min(...bar.buttons)).toBeGreaterThanOrEqual(44);
      expect(bar.overflow).toBeLessThanOrEqual(0);
      await expect(notice(page).getByRole("link", { name: t.consent.link })).toBeVisible();
    });

    test(`${String(width)}px: a choice moves nothing on the page`, async ({ page }) => {
      only(project);
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(notice(page)).toBeVisible();
      const heading = page.locator("h1").first();
      const before = await heading.boundingBox();
      await decline(page).click();
      await expect(notice(page)).toHaveCount(0);
      const after = await heading.boundingBox();
      expect(after?.y).toBe(before?.y);
    });

    test(`${String(width)}px: the bar does not cover the skip link`, async ({ page }) => {
      only(project);
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(notice(page)).toBeVisible();
      await page.keyboard.press("Tab");
      const skip = page.getByRole("link", { name: t.header.skipToContent });
      await expect(skip).toBeFocused();
      const link = await box(skip);
      const bar = await box(notice(page));
      expect(link.bottom).toBeGreaterThan(link.top);
      expect(link.bottom).toBeLessThanOrEqual(bar.top);
    });

    test(`${String(width)}px: tabbing through the page never leaves a focused element under the bar`, async ({
      page,
    }) => {
      only(project);
      // 45 Tab presses, each waiting for the smooth scroll to end: long on a machine shared with other lanes.
      test.setTimeout(120_000);
      await page.goto("/", { waitUntil: "networkidle" });
      await expect(notice(page)).toBeVisible();
      const covered: string[] = [];
      let focusedSomething = 0;
      for (let step = 0; step < 45; step += 1) {
        await page.keyboard.press("Tab");
        await still(page);
        let seen = await focusedUnderBar(page);
        // A smooth scroll can pause for a frame on a loaded machine: look again before calling it covered.
        for (let again = 0; again < 10 && seen?.covered === true; again += 1) {
          await page.waitForTimeout(200);
          seen = await focusedUnderBar(page);
        }
        if (seen === undefined) continue;
        focusedSomething += 1;
        if (seen.covered) covered.push(seen.label);
      }
      expect(focusedSomething).toBeGreaterThan(30);
      expect(covered).toEqual([]);
    });

    test(`${String(width)}px: on a property page the same popup shows in the first viewport`, async ({
      page,
    }) => {
      only(project);
      await page.goto("/properties", { waitUntil: "networkidle" });
      const href = await page.locator("a.property-card").first().getAttribute("href");
      expect(href, "the full seed lists a property").not.toBeNull();
      await page.goto(href ?? "", { waitUntil: "networkidle" });
      await expect(notice(page)).toBeVisible();
      await expect(notice(page)).toBeInViewport();
      const position = await notice(page).evaluate((element) => getComputedStyle(element).position);
      expect(position).toBe("fixed");
    });
  });
}

test("Allow stores the choice, a reload keeps it and the bar never returns on another page", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await allow(page).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: true });
  await page.reload({ waitUntil: "networkidle" });
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: true });
  await expect(notice(page)).toHaveCount(0);
  await page.goto("/about", { waitUntil: "networkidle" });
  await expect(notice(page)).toHaveCount(0);
});

test("No thank you stores analytics false, and the bar never returns on another page", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await decline(page).click();
  await expect(notice(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ version: CONSENT_VERSION, analytics: false });
  await page.reload({ waitUntil: "networkidle" });
  await expect(notice(page)).toHaveCount(0);
  await page.goto("/about", { waitUntil: "networkidle" });
  await expect(notice(page)).toHaveCount(0);
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

// The ring sits on the popup card, not on the footer behind it (the card is light, the footer dark since 2026-10-11).
test("the focused Allow has a visible outline that differs from the card, and focus moves on", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await notice(page).getByRole("link").focus();
  await page.keyboard.press("Tab");
  await expect(allow(page)).toBeFocused();
  const measured = await allow(page).evaluate((button) => {
    const style = getComputedStyle(button);
    const card = button.closest(".consent-bar");
    return {
      focusVisible: button.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      cardBackground: card === null ? "" : getComputedStyle(card).backgroundColor,
    };
  });
  expect(measured.focusVisible).toBe(true);
  expect(measured.outlineStyle).not.toBe("none");
  expect(measured.outlineWidth).not.toBe("0px");
  expect(measured.outlineColor).not.toMatch(/^(transparent|rgba\(0, 0, 0, 0\))$/);
  expect(measured.cardBackground).not.toBe("");
  expect(measured.outlineColor).not.toBe(measured.cardBackground);

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

import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import { CONSENT_VERSION } from "../../src/lib/consent";
import { t } from "../../src/lib/strings";

// B13 step 10: Google Analytics loads only after the visitor allows it (GP-02), in a real browser. The measurement id
// is inlined at build time, so run this against a live build made with the same variable:
// `VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA VITE_GA4_MEASUREMENT_ID=G-TEST000000 bun run build`
// then `VITE_GA4_MEASUREMENT_ID=G-TEST000000 E2E_TARGET=built E2E_MODE=live bunx playwright test --project=seo tests/e2e/ga4.spec.ts`.
// Every request to a Google host is fulfilled here with an empty script, so none reaches Google.

const measurementId = process.env["VITE_GA4_MEASUREMENT_ID"] ?? "";
const GOOGLE_URL = /^https:\/\/([^/]*\.)?(googletagmanager|google-analytics)\.com\//;
const GTAG_URL = /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?/;
const KEY = "mop_consent";

const notice = (page: Page) => page.getByRole("region", { name: t.consent.label });
const allow = (page: Page) => notice(page).getByRole("button", { name: t.consent.accept });
const decline = (page: Page) => notice(page).getByRole("button", { name: t.consent.decline });

test.skip(
  measurementId === "",
  "VITE_GA4_MEASUREMENT_ID is not set: build with it and run with it in the environment (see the top of this file)",
);

/** Records every request to a Google host and answers it with an empty script. */
async function watchGoogle(page: Page): Promise<string[]> {
  const urls: string[] = [];
  await page.route(GOOGLE_URL, async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: "" });
  });
  page.on("request", (request) => {
    if (GOOGLE_URL.test(request.url())) urls.push(request.url());
  });
  return urls;
}

/** Waits for the browser to be idle twice, so a loader that waits for idle has had its turn. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  for (let turn = 0; turn < 2; turn += 1) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.requestIdleCallback(
            () => {
              resolve();
            },
            { timeout: 3000 },
          );
        }),
    );
  }
}

/** The commands gtag pushed to `window.dataLayer`; `track()` pushes plain objects there too, which are left out. */
async function gtagCommands(page: Page): Promise<unknown[][]> {
  const layer = await page.evaluate((): unknown[][] =>
    (window.dataLayer ?? []).map((entry): unknown[] =>
      typeof entry === "object" && entry !== null && !("event" in entry)
        ? Object.values(entry)
        : [],
    ),
  );
  return z.array(z.array(z.unknown())).parse(layer);
}

test("the server-rendered page never names Google Tag Manager", async ({ request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain("googletagmanager");
});

test("a fresh context makes no request to a Google host", async ({ page }) => {
  const urls = await watchGoogle(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await settle(page);
  await expect(notice(page)).toBeVisible();
  expect(urls).toEqual([]);
});

test("No thank you still makes none, and a reload keeps the choice", async ({ page }) => {
  const urls = await watchGoogle(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await decline(page).click();
  await settle(page);
  await page.reload({ waitUntil: "networkidle" });
  await settle(page);
  await expect(notice(page)).toHaveCount(0);
  expect(urls).toEqual([]);
});

test("Allow loads the script once, with signals and ad personalization off, and a reload keeps the choice", async ({
  page,
}) => {
  const urls = await watchGoogle(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await allow(page).click();
  await expect.poll(() => urls.length).toBe(1);
  await settle(page);
  expect(urls).toEqual([`https://www.googletagmanager.com/gtag/js?id=${measurementId}`]);
  const config = (await gtagCommands(page)).find((command) => command[0] === "config");
  expect(config).toEqual([
    "config",
    measurementId,
    { allow_google_signals: false, allow_ad_personalization_signals: false },
  ]);

  await page.reload({ waitUntil: "networkidle" });
  await expect(notice(page)).toHaveCount(0);
  await expect.poll(() => urls.filter((url) => GTAG_URL.test(url)).length).toBe(2);
});

test("a raised consent version asks again and loads nothing", async ({ page }) => {
  const urls = await watchGoogle(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(
    ([key, version]) => {
      localStorage.setItem(key, JSON.stringify({ version, analytics: true }));
    },
    [KEY, CONSENT_VERSION - 1] as const,
  );
  await page.reload({ waitUntil: "networkidle" });
  await settle(page);
  await expect(notice(page)).toBeVisible();
  expect(urls).toEqual([]);
});

test("with Global Privacy Control on, Allow loads none, before or after a reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true });
  });
  const urls = await watchGoogle(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await allow(page).click();
  await settle(page);
  await page.reload({ waitUntil: "networkidle" });
  await settle(page);
  const stored = await page.evaluate((key) => localStorage.getItem(key), KEY);
  expect(stored).toContain('"analytics":true');
  expect(urls).toEqual([]);
});

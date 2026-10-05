import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";
import { z } from "zod";
import { t } from "../../src/lib/strings";
import { collect } from "./fixtures/page";
import { getDynamicRoutes } from "./fixtures/routes";

// B4 step 6 (T-04): the forms of the live artifact, at 1440x900 (project desktop) and 390x844 (project phone).
// The contact, newsletter, inquiry and submission writes are answered by `page.route`, so no row and no Storage
// object is left; `live-forms.spec.ts` writes the real rows. Turnstile is a stub: the script is not fetched.

const TINY = readFileSync(new URL("../fixtures/tiny.jpg", import.meta.url));
const LARGE = readFileSync(new URL("../fixtures/large.jpg", import.meta.url));
const RECEIPT = {
  id: "11111111-1111-4111-8111-111111111111",
  receivedAt: "2026-01-01T00:00:00.000Z",
};
const WIZARD_EMAIL = "e2e+wizard@fixtures.invalid";
const STORAGE = "https://storage.fixtures.invalid";
const MAX_THUMB_BYTES = 81_920;
const MAX_UPLOAD_EDGE = 2560;

const firstProperty = (await getDynamicRoutes()).find((route) => route.routeClass === "property");
if (firstProperty === undefined) throw new Error("the live API lists no property to open");

// Cold pages, five wizard steps and a decode take more than the 30 s default on a busy runner.
test.describe.configure({ timeout: 60_000 });

const dataLayerSchema = z.array(z.object({ event: z.string() }));
const mediaSchema = z.object({
  media: z.array(z.object({ name: z.string(), size: z.number(), type: z.string() })),
});

test.beforeEach(async ({ page }) => {
  // Answers the font hosts offline, as the sweep does, so a slow font request never holds `networkidle`.
  await collect(page);
  await page.addInitScript({
    content: `window.turnstile = {
      render: (_host, options) => { window.__turnstileOptions = options; return "stub"; },
      execute: () => { window.__turnstileOptions.callback("e2e-token"); },
      remove: () => undefined,
    };`,
  });
});

async function trackedEvents(page: Page): Promise<string[]> {
  const raw = await page.evaluate(() => JSON.stringify(window.dataLayer ?? []));
  return dataLayerSchema.parse(JSON.parse(raw)).map((entry) => entry.event);
}

/** Answers every POST to `pattern` with the receipt and returns the bodies it was sent. */
async function answerWrites(page: Page, pattern: string): Promise<unknown[]> {
  const bodies: unknown[] = [];
  await page.route(pattern, async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, contentType: "application/json", json: RECEIPT });
  });
  return bodies;
}

test("contact: a missing field keeps the form, a sent form tracks contact_inquiry", async ({
  page,
}) => {
  const bodies = await answerWrites(page, "**/api/public/inquiries**");
  await page.goto("/contact", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: t.common.send, exact: true }).click();
  await expect(page.locator("form.contact-form")).toBeVisible();
  expect(bodies).toHaveLength(0);
  expect(await trackedEvents(page)).not.toContain("contact_inquiry");

  await page.getByLabel("Your name", { exact: true }).fill("E2E Contact");
  await page.getByLabel("Email", { exact: true }).fill("e2e+contact@fixtures.invalid");
  await page.getByLabel("Message", { exact: true }).fill("A question from the contact form.");
  await page.getByRole("button", { name: t.common.send, exact: true }).click();

  await expect(page.getByText(t.forms.liveSent)).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(await trackedEvents(page)).toContain("contact_inquiry");
});

test("newsletter: a missing address keeps the form, a sent form tracks newsletter_signup", async ({
  page,
}) => {
  const bodies = await answerWrites(page, "**/api/public/subscribers**");
  await page.goto("/stories", { waitUntil: "networkidle" });

  await page.getByRole("button", { name: t.common.subscribe }).click();
  await expect(page.locator("form.newsletter-form")).toBeVisible();
  expect(bodies).toHaveLength(0);

  await page.getByLabel(t.common.emailAddress).fill("e2e+newsletter@fixtures.invalid");
  await page.getByRole("button", { name: t.common.subscribe }).click();

  await expect(page.getByText(t.newsletter.liveSent)).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(await trackedEvents(page)).toContain("newsletter_signup");
});

test("inquiry dialog: a missing field keeps it open, a sent one tracks property_inquiry", async ({
  page,
}) => {
  const bodies = await answerWrites(page, "**/api/public/inquiries**");
  await page.goto(firstProperty.path, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "Ask about this property" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: t.common.send, exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(bodies).toHaveLength(0);

  await dialog.getByLabel("Your name", { exact: true }).fill("E2E Inquiry");
  await dialog.getByLabel("Email", { exact: true }).fill("e2e+inquiry@fixtures.invalid");
  await dialog.getByLabel("Message", { exact: true }).fill("Is it still available?");
  await dialog.getByRole("button", { name: t.common.send, exact: true }).click();

  await expect(dialog.getByText(t.forms.liveSent)).toBeVisible();
  expect(bodies).toHaveLength(1);
  expect(await trackedEvents(page)).toContain("property_inquiry");
});

/** The header's search button of the project's layout: the other one is hidden by the stylesheet. */
const searchButton = (page: Page) =>
  page.locator(
    test.info().project.name === "phone"
      ? ".header-search-mobile"
      : ".header-search:not(.header-search-mobile)",
  );

// Ruling H38 (7): the behaviour of the two overlays B1b step 2b changed.
test.describe("overlays", () => {
  const search = {
    name: "search overlay",
    path: "/",
    overlay: ".search-overlay",
    open: (page: Page) => searchButton(page).click(),
    opener: searchButton,
    first: (page: Page) => page.getByLabel(t.header.searchLabel),
  };
  const inquiry = {
    name: "inquiry dialog",
    path: firstProperty.path,
    overlay: ".inquiry-overlay",
    open: (page: Page) => page.getByRole("button", { name: "Ask about this property" }).click(),
    opener: (page: Page) => page.getByRole("button", { name: "Ask about this property" }),
    first: (page: Page) => page.getByRole("dialog").getByLabel("Your name", { exact: true }),
  };

  for (const overlay of [search, inquiry]) {
    test(`${overlay.name}: focus moves in on open and returns to the opener on close`, async ({
      page,
    }) => {
      await page.goto(overlay.path, { waitUntil: "networkidle" });
      await overlay.open(page);
      await expect(overlay.first(page)).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.locator(overlay.overlay)).toHaveCount(0);
      await expect(overlay.opener(page)).toBeFocused();
    });

    test(`${overlay.name}: Escape closes it`, async ({ page }) => {
      await page.goto(overlay.path, { waitUntil: "networkidle" });
      await overlay.open(page);
      await expect(page.locator(overlay.overlay)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator(overlay.overlay)).toHaveCount(0);
    });

    test(`${overlay.name}: a click on the backdrop closes it`, async ({ page }) => {
      await page.goto(overlay.path, { waitUntil: "networkidle" });
      await overlay.open(page);
      // The search panel fills the top of its backdrop, so the click goes to the bottom left corner.
      const height = await page.evaluate(() => window.innerHeight);
      await page.locator(overlay.overlay).click({ position: { x: 2, y: height - 4 } });
      await expect(page.locator(overlay.overlay)).toHaveCount(0);
    });
  }
});

/** What the page PUT to a signed URL: the URL, the bytes and the answer the route gave. */
type Put = { url: string; body: Buffer };

type Stubbed = { posts: unknown[]; puts: Put[]; failPuts: { on: boolean } };

/** Answers the submission POST with one signed entry per photograph, and every PUT to the storage host. */
async function stubSubmission(page: Page): Promise<Stubbed> {
  const stubbed: Stubbed = { posts: [], puts: [], failPuts: { on: false } };
  await page.route("**/api/public/submissions**", async (route: Route) => {
    const body: unknown = route.request().postDataJSON();
    stubbed.posts.push(body);
    const { media } = mediaSchema.parse(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      json: {
        ...RECEIPT,
        upload_token: "e2e-upload-token",
        uploads: media.map((_, index) => ({
          media_id: `media-${index.toString()}`,
          index,
          url: `${STORAGE}/${index.toString()}/original`,
          thumb_url: `${STORAGE}/${index.toString()}/thumb`,
        })),
      },
    });
  });
  await page.route(`${STORAGE}/**`, async (route) => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    const request = route.request();
    if (request.method() !== "PUT") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    stubbed.puts.push({ url: request.url(), body: request.postDataBuffer() ?? Buffer.alloc(0) });
    await route.fulfill({ status: stubbed.failPuts.on ? 500 : 200, headers });
  });
  return stubbed;
}

type Photo = { name: string; mimeType: string; buffer: Buffer };

/** The five steps as a real estate agent; `files` goes to the file input of step 2. */
async function fillWizard(page: Page, files: Photo[]): Promise<void> {
  await page.goto("/submit", { waitUntil: "networkidle" });
  const next = page.getByRole("button", { name: t.common.continue, exact: true });

  await page.getByLabel("Property address", { exact: true }).fill("1 Fixture Way");
  await page.getByLabel("City", { exact: true }).fill("Ojai");
  // A select's accessible name carries its options, so these two match by their leading word.
  await page.getByLabel(/^State/).selectOption("California");
  await page.getByLabel("ZIP", { exact: true }).fill("93023");
  await page.getByLabel(/^Property type/).selectOption({ index: 1 });
  await next.click();

  await page.getByLabel("The property story", { exact: true }).fill("A house built for the light.");
  await page
    .getByLabel("What makes this property significant?", { exact: true })
    .fill("Its plan follows the sun.");
  await page.locator('input[type="file"]').setInputFiles(files);
  await next.click();

  await page.getByLabel(/^I am/).selectOption({ label: "Real estate agent" });
  await page.getByLabel("Your name", { exact: true }).fill("E2E Agent");
  await page.getByLabel("Brokerage", { exact: true }).fill("Fixture Realty");
  await page.getByLabel("Email", { exact: true }).fill(WIZARD_EMAIL);
  await next.click();

  await page.getByRole("radio", { name: "The Feature" }).click();
  await page.getByRole("checkbox", { name: /I confirm I have the rights/ }).check();
  await next.click();

  await page.getByRole("button", { name: "Send for review" }).click();
}

const jpeg = (name: string, buffer: Buffer): Photo => ({ name, mimeType: "image/jpeg", buffer });
const received = (page: Page) => page.getByText("Received. Editorial review comes next.");

test.describe("submission wizard", () => {
  test("five steps as an agent: one POST, the photograph PUT, submit_property tracked", async ({
    page,
  }) => {
    const stubbed = await stubSubmission(page);
    await fillWizard(page, [jpeg("tiny.jpg", TINY)]);

    await expect(received(page)).toBeVisible();
    await expect(page.getByText(t.forms.uploadDone)).toBeVisible();
    expect(stubbed.posts).toHaveLength(1);
    expect(JSON.stringify(stubbed.posts[0])).toContain(WIZARD_EMAIL);
    expect(stubbed.puts.map((put) => put.url).sort()).toEqual([
      `${STORAGE}/0/original`,
      `${STORAGE}/0/thumb`,
    ]);
    expect(await trackedEvents(page)).toContain("submit_property");
  });

  // FE-04: a failed PUT never turns a received submission into a failed one, and Retry never posts again.
  test("a PUT answered 500 leaves the submission received, and Retry sends only the photograph", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const stubbed = await stubSubmission(page);
    stubbed.failPuts.on = true;
    await fillWizard(page, [jpeg("tiny.jpg", TINY)]);

    await expect(received(page)).toBeVisible();
    await expect(page.getByText(t.forms.uploadFailed(1))).toBeVisible({ timeout: 45_000 });
    expect(stubbed.posts).toHaveLength(1);

    stubbed.failPuts.on = false;
    await page.getByRole("button", { name: t.forms.uploadRetry }).click();
    await expect(page.getByText(t.forms.uploadDone)).toBeVisible();
    expect(stubbed.posts).toHaveLength(1);
  });

  test("two files both named image.jpg go to two different URLs", async ({ page }) => {
    const stubbed = await stubSubmission(page);
    // A second size, so the file list's key (name and size) is not repeated.
    const second = Buffer.concat([TINY, Buffer.from([0])]);
    await fillWizard(page, [jpeg("image.jpg", TINY), jpeg("image.jpg", second)]);

    await expect(page.getByText(t.forms.uploadDone)).toBeVisible();
    const originals = stubbed.puts
      .filter((put) => put.url.endsWith("/original"))
      .sort((a, b) => a.url.localeCompare(b.url));
    expect(originals.map((put) => put.url)).toEqual([
      `${STORAGE}/0/original`,
      `${STORAGE}/1/original`,
    ]);
    expect(originals.map((put) => put.body.byteLength)).toEqual([
      TINY.byteLength,
      second.byteLength,
    ]);
  });

  // PERF-08: the browser prepares the photograph, so a 6000x4000 file never goes out whole.
  test("a 6000x4000 photograph goes as a 2560 px original and a thumbnail of at most 80 KB", async ({
    page,
  }) => {
    const stubbed = await stubSubmission(page);
    await fillWizard(page, [jpeg("large.jpg", LARGE)]);

    await expect(page.getByText(t.forms.uploadDone)).toBeVisible();
    const thumb = stubbed.puts.find((put) => put.url.endsWith("/thumb"));
    const original = stubbed.puts.find((put) => put.url.endsWith("/original"));
    expect(thumb?.body.byteLength).toBeGreaterThan(0);
    expect(thumb?.body.byteLength).toBeLessThanOrEqual(MAX_THUMB_BYTES);
    const edge = await page.evaluate(
      async (base64) => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
        return Math.max(bitmap.width, bitmap.height);
      },
      original?.body.toString("base64") ?? "",
    );
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThanOrEqual(MAX_UPLOAD_EDGE);
  });
});

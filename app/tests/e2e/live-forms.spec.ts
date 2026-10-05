import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { t } from "../../src/lib/strings";
import { deterministicUuid } from "../fixtures/clock";
import { holdDevLock } from "../fixtures/dev-lock";
import { removeFixtureRows } from "../fixtures/factories";
import { collect } from "./fixtures/page";
import { getDynamicRoutes } from "./fixtures/routes";

// B4 step 9 (T-04, invariant 4): the three public writes through the real forms and the real Worker, on the live
// artifact. Each row is read back by its address (a select over `DEV_DB_URL`, the tables are not on the data API) and removed in `afterAll`. The Turnstile script is a stub that hands the
// widget Cloudflare's dummy token, which the always-pass secret of `.dev.vars` accepts. The submission write is not
// driven here: it would leave Storage objects that SQL cannot remove (B3's submissions.api.test.ts covers it).

const ADDRESS_LIKE = "e2e+%@fixtures.invalid";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const runTag = process.env["GITHUB_RUN_ID"] ?? "local";
const address = (n: number): string =>
  `e2e+${runTag}-${deterministicUuid("e2e", n).slice(0, 8)}@fixtures.invalid`;

const firstProperty = (await getDynamicRoutes()).find((route) => route.routeClass === "property");
if (firstProperty === undefined) throw new Error("the live API lists no property to open");

test.describe.configure({ mode: "serial", timeout: 60_000 });

let release: () => Promise<void> = () => Promise.resolve();
let db: pg.Client;

test.beforeAll(async () => {
  await assertNotProduction();
  release = await holdDevLock();
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  db = new pg.Client({ connectionString: url });
  await db.connect();
});

test.afterAll(async () => {
  try {
    await db.query("begin");
    const removed = await removeFixtureRows(db, { emailLike: ADDRESS_LIKE });
    await db.query("commit");
    expect(removed.inquiries, "inquiries removed").toBe(2);
    expect(removed.subscribers, "subscribers removed").toBe(1);
  } finally {
    await db.end();
    await release();
  }
});

test.beforeEach(async ({ page }) => {
  await collect(page);
  await page.addInitScript({
    content: `window.turnstile = {
      render: (_host, options) => { window.__turnstileOptions = options; return "stub"; },
      execute: () => { window.__turnstileOptions.callback("${DUMMY_TOKEN}"); },
      remove: () => undefined,
    };`,
  });
});

// The tables are not exposed to the data API, so the read-back is a select over the same connection as the cleanup.
async function rowsWith(table: "inquiries" | "subscribers", email: string): Promise<number> {
  const result = await db.query(`select 1 from public.${table} where email = $1`, [email]);
  return result.rowCount ?? 0;
}

/** Waits for the POST the form makes to `path` and returns its status. */
function written(page: Page, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === path,
  );
}

test("the artifact is the live one", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(await page.evaluate(() => document.body.dataset["services"])).toBe("live");
});

test("contact: the form writes one inquiry", async ({ page }) => {
  const email = address(1);
  await page.goto("/contact", { waitUntil: "networkidle" });
  await page.getByLabel("Your name", { exact: true }).fill("E2E Contact");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Message", { exact: true }).fill("A question from the contact form.");
  const posted = written(page, "/api/public/inquiries");
  await page.getByRole("button", { name: t.common.send, exact: true }).click();
  expect((await posted).status()).toBe(201);
  await expect(page.getByText(t.forms.liveSent)).toBeVisible();
  expect(await rowsWith("inquiries", email)).toBe(1);
});

test("inquiry dialog: the form writes one inquiry", async ({ page }) => {
  const email = address(2);
  await page.goto(firstProperty.path, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Ask about this property" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Your name", { exact: true }).fill("E2E Inquiry");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByLabel("Message", { exact: true }).fill("Is it still available?");
  const posted = written(page, "/api/public/inquiries");
  await dialog.getByRole("button", { name: t.common.send, exact: true }).click();
  expect((await posted).status()).toBe(201);
  await expect(dialog.getByText(t.forms.liveSent)).toBeVisible();
  expect(await rowsWith("inquiries", email)).toBe(1);
});

test("newsletter: the form writes one subscriber", async ({ page }) => {
  const email = address(3);
  await page.goto("/stories", { waitUntil: "networkidle" });
  await page.getByLabel(t.common.emailAddress).fill(email);
  const posted = written(page, "/api/public/subscribers");
  await page.getByRole("button", { name: t.common.subscribe }).click();
  expect((await posted).status()).toBe(201);
  await expect(page.getByText(t.newsletter.liveSent)).toBeVisible();
  expect(await rowsWith("subscribers", email)).toBe(1);
});

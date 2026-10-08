import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { holdDevLock } from "../fixtures/dev-lock";
import { checkpoint } from "./fixtures/a11y";
import { adminClient, signInAs } from "./helpers/session";

// B8 step 10 (screen 16). One dead job is committed through the service role; its payload names a random property, so
// the entity link and `?entity=` filter are checked against PostgREST on the database the Worker reads (the
// `entityJobsFilter` text). Rows are never deleted: the delete of a job cascades into `job_events`, which is
// append-only (`append_only`). The job carries the marker `e2e-jobs` and this run's id in its key and error: the banner
// assertions find it by that error text, the row assertions by its entity label. The last test ends it through the admin
// cancel action, so it stays as a cancelled row until the launch switch's `db:reset` clears it (ASSUMED H35 (4)). A run
// in which an earlier test fails leaves the job `dead` or `queued`, and nothing cancels it. It writes rows, so
// `assertNotProduction` refuses once `settings.environment` is `production` (ruling H35 (5)) and the writer lock is
// held from the start of `beforeAll` to the end of `afterAll` (G34). Its type, `e2e_jobs`, names no step in
// `src/server/jobs/steps`, so a runner has no code for it.

const MEDIA_OPS = "staff+mediaops@matterofplace.com";
const ID_PREFIX = 8;

const runId = randomUUID();
const propertyId = randomUUID();
const entityLabel = `property ${propertyId.slice(0, ID_PREFIX)}`;
const CANCEL_WAIT_MS = 15_000;
const MARKER = "e2e-jobs";
const error = `${MARKER} dead job ${runId}`;
const key = `${MARKER}:${runId}`;

test.describe.configure({ mode: "serial" });

let release: () => Promise<void> = () => Promise.resolve();
let jobId = "";

test.beforeAll(async () => {
  await assertNotProduction({ dbUrl: process.env["DEV_DB_URL"] });
  release = await holdDevLock();
  const { data, error: failure } = await adminClient()
    .from("jobs")
    .insert({
      type: "e2e_jobs",
      idempotency_key: key,
      status: "dead",
      attempts: 5,
      max_attempts: 5,
      error,
      payload: { params: {}, data: { property_id: propertyId } },
    })
    .select("id")
    .single();
  if (failure !== null) throw new Error(`could not insert the dead job: ${failure.message}`);
  jobId = data.id;
});

test.afterAll(async () => {
  await release();
});

const jobsTable = (page: Page) => page.getByRole("table", { name: "Jobs", exact: true });
const rowOf = (page: Page) => jobsTable(page).getByRole("row").filter({ hasText: entityLabel });

test("System, Jobs lands on screen 16 with the dead job pinned in red, and Retry queues it", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  await page
    .getByRole("navigation", { name: "Admin" })
    .getByRole("link", { name: "Jobs", exact: true })
    .click();
  await page.waitForURL((url) => url.pathname === "/admin/jobs");
  await expect(jobsTable(page)).toBeVisible();
  const banner = page.getByRole("region", { name: "Dead jobs" });
  await expect(banner).toHaveAttribute("data-tone", "danger");
  const dead = banner.getByRole("listitem").filter({ hasText: error });
  await expect(dead.getByText("Dead", { exact: true })).toHaveAttribute("data-tone", "danger");
  await checkpoint(page, "/admin/jobs");
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/admin/jobs/${jobId}/retry`,
  );
  await dead.getByRole("button", { name: "Retry" }).click();
  expect((await answered).status()).toBe(200);
  await expect(rowOf(page).getByText("Queued", { exact: true })).toBeVisible();
  await expect(banner.getByRole("listitem").filter({ hasText: error })).toHaveCount(0);
  await context.close();
});

test("the entity filter lists the job of its property and no other", async ({ browser }) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  await page.goto(`/admin/jobs?entity=${propertyId}`);
  await expect(rowOf(page)).toHaveCount(1);
  await expect(rowOf(page).getByRole("link", { name: entityLabel })).toHaveAttribute(
    "href",
    `/admin/jobs?entity=${propertyId}`,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await checkpoint(page, "/admin/jobs (one entity)");
  await page.goto(`/admin/jobs?entity=${randomUUID()}`);
  await expect(page.getByText("No jobs match")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(rowOf(page)).toHaveCount(0);
  await context.close();
});

test("a row opens the job in a drawer with its payload and history", async ({ browser }) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  await page.goto(`/admin/jobs?entity=${propertyId}`);
  await rowOf(page).getByText("e2e jobs").click();
  const drawer = page.getByRole("dialog", { name: "e2e jobs" });
  await expect(drawer.getByText(propertyId, { exact: false }).first()).toBeVisible();
  await expect(drawer.getByRole("heading", { name: "History" })).toBeVisible();
  await checkpoint(page, "/admin/jobs (job drawer)");
  await context.close();
});

test("Cancel job ends the retried job as cancelled", async ({ browser }) => {
  const { context, page } = await signInAs(browser, MEDIA_OPS);
  await page.goto(`/admin/jobs?entity=${propertyId}`);
  await rowOf(page).getByText("e2e jobs").click();
  const drawer = page.getByRole("dialog", { name: "e2e jobs" });
  await drawer.getByRole("button", { name: "Cancel job" }).click();
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/api/admin/jobs/${jobId}/cancel`,
    { timeout: CANCEL_WAIT_MS },
  );
  await page
    .getByRole("dialog", { name: "Cancel this job" })
    .getByRole("button", { name: "Cancel job" })
    .click();
  expect((await answered).status()).toBe(200);
  await expect(rowOf(page).getByText("Cancelled", { exact: true })).toBeVisible();
  await context.close();
});

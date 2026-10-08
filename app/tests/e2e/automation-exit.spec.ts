import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import pg from "pg";
import { z } from "zod";
import { assertNotProduction } from "../../scripts/lib/assert-not-production.mjs";
import { generateKey, hashAgentKey } from "../../src/server/lib/agent-keys";
import { holdDevLock } from "../fixtures/dev-lock";
import { removeFixtureRows } from "../fixtures/factories";
import { adminClient, signInAs } from "./helpers/session";

// B8b step 10, part 2 of the exit: "an admin switches a step off, publishes, and the dry-run and the real run both
// skip it". The switch is made twice, once from screen 17 by a session and once through the API by an agent key; the
// session's switch is checked by the dry-run panel and by a real submission from /submit, and screen 21 undoes each.
// It commits rows to mop-dev, so it runs before the launch switch only: `assertNotProduction` refuses once
// `settings.environment` is `production` (ruling H35 (5)), and the writer lock is held from the start of `beforeAll`
// to the end of `afterAll` (G34). The step is on again at the end. `removeFixtureRows` deletes the submission and its
// contact; its `events` row stays, because `events` is append-only (B2 invariant 3).
// Screen 16 shows the same jobs by `/admin/jobs?entity=<submission id>`.
// Needs the live build with the Turnstile test key (`VITE_API_BASE_URL=/api/public VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA`,
// G-1151) so /submit posts to the Worker, a deployed job runner on mop-dev to plan the event, and `.dev.vars` with
// Cloudflare's always-pass Turnstile secret (E10). The plan has B7's team service (step 14) create and revoke the agent
// key; it is not on main yet, so the key is inserted into `agent_keys` the way `scripts/seed-admin-users.ts` does it and
// revoked in `afterAll`. Replace both when step 14 lands.

const TRIGGER = "submission.received";
const STEP = "notify_admin_received";
const CHIEF = "staff+chief@matterofplace.com";
const AGENT_EMAIL = "e2e-automation-agent@matterofplace.invalid";
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const runTag = process.env["GITHUB_RUN_ID"] ?? "local";
// The submission route allows 3 writes an hour per address and 5 a day per email (stored in the database), so each run uses its own email and address.
const SUBMITTER = `e2e+${runTag}-${randomUUID().slice(0, 8)}-exit@fixtures.invalid`;
const TINY = readFileSync(new URL("../fixtures/tiny.jpg", import.meta.url));

const recipeList = z.object({
  items: z.array(
    z.object({
      trigger: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      steps: z.array(z.object({ id: z.string() }).passthrough()),
    }),
  ),
});

test.describe.configure({ mode: "serial", timeout: 150_000 });

let release: () => Promise<void> = () => Promise.resolve();
let db: pg.Client;
let keyId = "";
let agent: APIRequestContext;
let seededSteps = "";

async function stepOn(): Promise<boolean> {
  const { rows } = await db.query<{ on: boolean }>(
    `select (step->>'enabled')::boolean as on
     from public.automation_recipes r, jsonb_array_elements(r.steps) step
     where r.trigger = $1 and step->>'id' = $2`,
    [TRIGGER, STEP],
  );
  const row = rows[0];
  if (row === undefined) throw new Error(`the recipe ${TRIGGER} has no step ${STEP}`);
  return row.on;
}

async function agentUser(): Promise<string> {
  const found = await db.query<{ id: string }>(
    "select id from auth.users where lower(email) = lower($1)",
    [AGENT_EMAIL],
  );
  const existing = found.rows[0]?.id;
  if (existing !== undefined) return existing;
  const { data, error } = await adminClient().auth.admin.createUser({
    email: AGENT_EMAIL,
    email_confirm: true,
  });
  if (error !== null) throw new Error(`creating ${AGENT_EMAIL} failed: ${error.message}`);
  return data.user.id;
}

test.beforeAll(async ({ playwright }) => {
  await assertNotProduction();
  release = await holdDevLock();
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("refusing: DEV_DB_URL is not set");
  db = new pg.Client({ connectionString: url });
  await db.connect();
  expect(await stepOn(), `${STEP} starts on`).toBe(true);
  seededSteps =
    (
      await db.query<{ steps: string }>(
        "select steps::text as steps from public.automation_recipes where trigger = $1",
        [TRIGGER],
      )
    ).rows[0]?.steps ?? "";

  const userId = await agentUser();
  await db.query(
    `insert into public.user_roles (user_id, role, actor_kind, display_name)
     values ($1, 'media_ops', 'agent', 'E2E automation agent')
     on conflict (user_id, role) do update set disabled_at = null`,
    [userId],
  );
  const key = generateKey("dev");
  keyId =
    (
      await db.query<{ id: string }>(
        `insert into public.agent_keys (user_id, key_hash, label, scopes)
       values ($1, $2, $3, array['automation']) returning id`,
        [userId, await hashAgentKey(key), `e2e automation exit ${runTag}`],
      )
    ).rows[0]?.id ?? "";
  agent = await playwright.request.newContext({
    baseURL: process.env["E2E_BASE_URL"] ?? "",
    extraHTTPHeaders: { authorization: `Bearer ${key}` },
  });
});

test.afterAll(async () => {
  try {
    await agent.dispose();
    if (keyId !== "") {
      await db.query("update public.agent_keys set revoked_at = now() where id = $1", [keyId]);
    }
    if (!(await stepOn())) {
      await db.query(
        `select public.automation_put_recipe($1, jsonb_build_object('steps', $2::jsonb), $3::uuid, 'human', 'e2e-exit', 'e2e cleanup')`,
        [TRIGGER, seededSteps, null],
      );
    }
    await db.query("begin");
    await removeFixtureRows(db, { emailLike: SUBMITTER });
    await db.query("commit");
  } finally {
    await db.end();
    await release();
  }
});

const isPath = (url: string, path: string) => new URL(url).pathname === path;

/** The first row of screen 21, which is the newest change. */
const newestRevision = (page: Page) => page.getByRole("row").nth(1);

async function openRecipe(page: Page): Promise<void> {
  await page
    .getByRole("navigation", { name: "Events" })
    .getByRole("button", { name: /submission\.received/ })
    .click();
  await expect(page.getByRole("article", { name: "Submission received" })).toBeVisible();
}

async function restoreNewest(page: Page): Promise<void> {
  await page.goto("/admin/automation/revisions");
  await expect(newestRevision(page)).toContainText("Recipe · submission.received");
  await newestRevision(page).click();
  await page.getByRole("button", { name: "Restore the values before this change" }).click();
  const restored = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && /\/revisions\/[^/]+\/restore$/.test(response.url()),
  );
  await page
    .getByRole("dialog", { name: "Restore the earlier values" })
    .getByRole("button", { name: "Restore" })
    .click();
  expect((await restored).status()).toBe(200);
}

async function closing(context: BrowserContext, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } finally {
    await context.close();
  }
}

test("a session switches the step off on screen 17 and the dry run lists it skipped", async ({
  browser,
}) => {
  const { context, page } = await signInAs(browser, CHIEF);
  await closing(context, async () => {
    const listed = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        isPath(response.url(), "/api/admin/automation/recipes"),
    );
    const document = await page.goto("/admin/automation/recipes");
    expect(document?.headers()["cache-control"]).toBe("no-store");
    expect((await listed).headers()["cache-control"]).toBe("no-store");

    await openRecipe(page);
    await page
      .locator("li.admin-step")
      .filter({ hasText: STEP })
      .getByRole("checkbox", { name: /: on$/ })
      .uncheck();
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && response.url().endsWith(`/recipes/${TRIGGER}`),
    );
    // A save refetches the recipes and the editor draws again: the dry-run form is filled after that.
    const refetched = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        isPath(response.url(), "/api/admin/automation/recipes"),
    );
    await page.getByRole("button", { name: "Save recipe" }).click();
    expect((await saved).status()).toBe(200);
    await refetched;
    expect(await stepOn()).toBe(false);

    const planned = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        isPath(response.url(), "/api/admin/automation/dry-run"),
    );
    // The planner builds this event's sample from a submission: the server refuses a dry run that names none.
    const sample = await db.query<{ id: string }>(
      "select id from public.submissions order by received_at desc limit 1",
    );
    await page.getByLabel("Record id").fill(sample.rows[0]?.id ?? "");
    await page.getByRole("button", { name: "Run dry run" }).click();
    const answer = await planned;
    expect(answer.status(), await answer.text()).toBe(200);
    expect(answer.headers()["cache-control"]).toBe("no-store");
    const skipped = page
      .getByRole("heading", { name: "Would skip" })
      .locator("xpath=following-sibling::ul[1]");
    await expect(skipped).toContainText(STEP);
    await expect(skipped).toContainText("The step is off");
  });
});

test("a submission from /submit queues the received email and no notify_admin job", async ({
  browser,
  page,
}) => {
  // A local browser reaches the Worker as 0.0.0.0, one rate-limit bucket that earlier runs have filled (429); a TEST-NET-3 address gives this run its own.
  await page.context().setExtraHTTPHeaders({
    "cf-connecting-ip": `203.0.113.${String(randomInt(1, 254))}`,
  });
  await page.addInitScript({
    content: `window.turnstile = {
      render: (_host, options) => { window.__turnstileOptions = options; return "stub"; },
      execute: () => { window.__turnstileOptions.callback("${DUMMY_TOKEN}"); },
      remove: () => undefined,
    };`,
  });
  // The photograph goes to a signed Storage address; answering it here keeps the run from leaving an object that SQL cannot remove.
  await page.route("**/storage/v1/**", async (route) => {
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    await route.fulfill({ status: route.request().method() === "PUT" ? 200 : 204, headers });
  });
  await page.goto("/submit", { waitUntil: "networkidle" });
  expect(await page.evaluate(() => document.body.dataset["services"]), "the live build").toBe(
    "live",
  );
  const next = page.getByRole("button", { name: "Continue", exact: true });

  await page.getByLabel("Property address", { exact: true }).fill("1 Fixture Way");
  await page.getByLabel("City", { exact: true }).fill("Ojai");
  await page.getByLabel(/^State/).selectOption("California");
  await page.getByLabel("ZIP", { exact: true }).fill("93023");
  await page.getByLabel(/^Property type/).selectOption({ index: 1 });
  await next.click();

  await page.getByLabel("The property story", { exact: true }).fill("A house built for the light.");
  await page
    .getByLabel("What makes this property significant?", { exact: true })
    .fill("Its plan follows the sun.");
  await page
    .locator('input[type="file"]')
    .setInputFiles([{ name: "tiny.jpg", mimeType: "image/jpeg", buffer: TINY }]);
  await next.click();

  await page.getByLabel(/^I am/).selectOption({ label: "Real estate agent" });
  await page.getByLabel("Your name", { exact: true }).fill("E2E Agent");
  await page.getByLabel("Brokerage", { exact: true }).fill("Fixture Realty");
  await page.getByLabel("Email", { exact: true }).fill(SUBMITTER);
  await next.click();

  await page.getByRole("radio", { name: "The Feature" }).click();
  await page.getByRole("checkbox", { name: /I confirm I have the rights/ }).check();
  await next.click();
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && isPath(response.url(), "/api/public/submissions"),
  );
  await page.getByRole("button", { name: "Send for review" }).click();
  const receipt = await posted;
  expect(receipt.status()).toBe(201);
  await expect(page.getByText("Received. Editorial review comes next.")).toBeVisible();

  const planned = async (): Promise<string | null> =>
    (
      await db.query<{ processed_at: string | null }>(
        `select e.processed_at::text from public.events e
         join public.submissions s on s.id = e.entity_id
         where e.type = $1 and s.submitter_email = $2`,
        [TRIGGER, SUBMITTER],
      )
    ).rows[0]?.processed_at ?? null;
  await expect
    .poll(planned, {
      message: "the job runner plans the event",
      timeout: 120_000,
      intervals: [3_000],
    })
    .not.toBeNull();

  const { rows } = await db.query<{ step_id: string; type: string }>(
    `select j.step_id, j.type from public.jobs j
     join public.events e on e.id = j.event_id
     join public.submissions s on s.id = e.entity_id
     where e.type = $1 and s.submitter_email = $2`,
    [TRIGGER, SUBMITTER],
  );
  expect(rows.map((row) => row.step_id)).toEqual(["send_received"]);
  expect(rows.filter((row) => row.type === "notify_admin")).toEqual([]);

  // Screen 16 lists the jobs of that submission: the received email, and no admin notice.
  const submission = await db.query<{ id: string }>(
    "select id from public.submissions where submitter_email = $1",
    [SUBMITTER],
  );
  const staff = await signInAs(browser, CHIEF);
  await closing(staff.context, async () => {
    await staff.page.goto(`/admin/jobs?entity=${submission.rows[0]?.id ?? ""}`);
    const jobs = staff.page.getByRole("table", { name: "Jobs" });
    await expect(jobs).toContainText(/send email/i);
    await expect(jobs).not.toContainText(/notify admin/i);
  });
});

test("a restore from screen 21 brings the step back", async ({ browser }) => {
  const { context, page } = await signInAs(browser, CHIEF);
  await closing(context, async () => {
    await restoreNewest(page);
    expect(await stepOn()).toBe(true);
    await page.goto("/admin/automation/revisions");
    await expect(newestRevision(page)).toContainText("Restored");
  });
});

test("an agent key makes the same switch, screen 21 shows it with the Agent pill, and the restore undoes it", async ({
  browser,
}) => {
  const listed = await agent.get("/api/admin/automation/recipes");
  expect(listed.status()).toBe(200);
  const recipe = recipeList
    .parse(await listed.json())
    .items.find((item) => item.trigger === TRIGGER);
  if (recipe === undefined) throw new Error(`no recipe ${TRIGGER}`);
  const switched = await agent.put(`/api/admin/automation/recipes/${TRIGGER}`, {
    data: {
      name: recipe.name,
      enabled: recipe.enabled,
      steps: recipe.steps.map((step) => (step.id === STEP ? { ...step, enabled: false } : step)),
    },
  });
  expect(switched.status()).toBe(200);
  expect(await stepOn()).toBe(false);

  const { context, page } = await signInAs(browser, CHIEF);
  await closing(context, async () => {
    await page.goto("/admin/automation/revisions");
    await expect(newestRevision(page)).toContainText("Recipe · submission.received");
    await expect(newestRevision(page).getByText("Agent", { exact: true })).toBeVisible();
    await restoreNewest(page);
    expect(await stepOn()).toBe(true);
  });
});

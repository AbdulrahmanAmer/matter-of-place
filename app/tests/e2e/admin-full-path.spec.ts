import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import pg from "pg";
import { z } from "zod";
import { seedFullPathFixtures, seedFullPathRun, type FullPathRun } from "./fixtures/admin-data";
import { checkpoint } from "./fixtures/a11y";
import { adminClient, signInAs } from "./helpers/session";

// B7 step 16, Part 2 of the observed exit. The human variant takes a request from /submit through review, accept,
// invoice, mark paid and activate to a property draft, and publishes it; the agent variant repeats the decisions an
// agent may take through a key and is refused the two that only a person takes. Every history entry names its actor,
// and the agent's carry the Agent pill. Rows are read back over `pg` on DEV_DB_URL (P-431).
// The photographs, the copy job and the publish leg need the job runner and, for the last, B9's `render_variants`:
// E2E_FULL_STACK=1 submits six real photographs and waits for `copy_submission_media`; E2E_RENDER=1 (laptop, mop-dev,
// once B9's render is deployed) also waits for the render and publishes. Without them the run stops after activate,
// with the copy job queued. The /submit leg needs the live build with the Turnstile test key (G-1151).

const MANAGING_EDITOR = "staff+managing@matterofplace.com";
const ADMIN = "staff+ceo@matterofplace.com";
const POLL_MS = 10_000;
const RENDER_LIMIT_MS = 600_000;
const RUNNER_LIMIT_MS = 180_000;
const DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const PHOTOS = 6;
const AGENT_LABEL = "E2E full path agent";
const TINY = readFileSync(new URL("../fixtures/tiny.jpg", import.meta.url));

const withRunner = process.env["E2E_FULL_STACK"] === "1" || process.env["E2E_RENDER"] === "1";
const withRender = process.env["E2E_RENDER"] === "1";

function dbUrl(): string {
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("admin-full-path: DEV_DB_URL is not set");
  return url;
}

/** One short connection per call, so a long wait never holds a socket the pooler may drop. */
async function sql<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const client = new pg.Client({ connectionString: dbUrl() });
  await client.connect();
  try {
    return (await client.query<Row>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function one<Row extends pg.QueryResultRow>(text: string, params: unknown[] = []) {
  const [row] = await sql<Row>(text, params);
  if (row === undefined) throw new Error(`admin-full-path: no row for ${text}`);
  return row;
}

const statusPanel = (page: Page) => page.getByRole("region", { name: "Status" });
const history = (page: Page) => page.getByRole("region", { name: "History" });

async function openRequest(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/requests/${id}`);
  await expect(statusPanel(page)).toBeVisible();
}

const answerBody = z.object({ error: z.object({ code: z.string() }) });
const keyAnswer = z.object({ user_id: z.string(), key_id: z.string(), key: z.string() });
const decisionAnswer = z.object({ event_id: z.string().uuid() });
const versionAnswer = z.object({ version: z.number() });
const reasonsAnswer = z.object({ items: z.array(z.object({ id: z.string().uuid() })) });
const timelineAnswer = z.object({
  items: z.array(
    z.object({ action: z.string(), actor_kind: z.enum(["human", "agent"]).nullable() }),
  ),
});

/** A write from the signed-in page, with the CSRF header the session needs. */
function sessionCall(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = /(?:^|; )mop_csrf=([^;]*)/.exec(document.cookie)?.[1] ?? "";
      const response = await fetch(path, {
        method,
        headers: { "content-type": "application/json", "x-mop-csrf": decodeURIComponent(token) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.text() };
    },
    { method, path, body },
  );
}

/** A new agent account for the run: the daily caps of invariant 3 count per agent, so a reused account runs out of them. */
async function issueAgentKey(page: Page): Promise<z.infer<typeof keyAnswer>> {
  const made = await sessionCall(page, "POST", "/api/admin/team/agents", {
    label: AGENT_LABEL,
    role: "managing_editor",
    scopes: ["submissions", "properties", "payments"],
  });
  // The answer carries the key, so it is never the assertion's message.
  expect(made.status).toBe(200);
  return keyAnswer.parse(JSON.parse(made.body));
}

/** The account goes once the run's rows have: the requests it decided still name it, and the audit rows stay. */
async function removeAgent(userId: string): Promise<void> {
  const { error } = await adminClient().auth.admin.deleteUser(userId);
  expect(error, "removing the agent account").toBeNull();
}

/** The agent's call: a bearer key and no cookie. */
async function asAgent(
  request: APIRequestContext,
  key: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
) {
  const response = await request.fetch(`/api/admin/${path}`, {
    method,
    headers: { authorization: `Bearer ${key}` },
    ...(data === undefined ? {} : { data }),
  });
  const text = await response.text();
  return { status: response.status(), text };
}

async function agentOk(
  request: APIRequestContext,
  key: string,
  method: "GET" | "POST" | "PATCH",
  path: string,
  data?: unknown,
): Promise<unknown> {
  const answer = await asAgent(request, key, method, path, data);
  expect(answer.status, `${method} ${path}: ${answer.text}`).toBe(200);
  return JSON.parse(answer.text) as unknown;
}

/** Every entry of a history names its actor; the Agent pill is on the agent's audit rows and on nobody else's. */
async function expectActors(entries: Locator, kinds: { agent: boolean }): Promise<void> {
  const rows = entries.getByRole("listitem");
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await expect(row.locator(".admin-actor")).not.toHaveText("");
    const audit = /^(Review started|Declined|Accepted)/.test((await row.innerText()).trim());
    await expect(row.locator(".admin-actor .admin-pill")).toHaveCount(audit && kinds.agent ? 1 : 0);
  }
}

/** The request a visitor sends from /submit, with real photographs when the runner and Storage are in play. */
async function submitRequest(browser: Browser, run: FullPathRun, photos: number): Promise<void> {
  const context = await browser.newContext();
  try {
    // A local browser reaches the Worker as 0.0.0.0, one rate-limit bucket that earlier runs have filled (429); a
    // TEST-NET-3 address gives this run its own, on the Worker's own routes only (Storage would refuse the header).
    const address = `203.0.113.${String(randomInt(1, 254))}`;
    await context.route("**/api/public/**", (route) =>
      route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": address } }),
    );
    await context.addInitScript({
      content: `window.turnstile = {
        render: (_host, options) => { window.__turnstileOptions = options; return "stub"; },
        execute: () => { window.__turnstileOptions.callback("${DUMMY_TOKEN}"); },
        remove: () => undefined,
      };`,
    });
    const page = await context.newPage();
    await page.goto("/submit", { waitUntil: "networkidle" });
    expect(await page.evaluate(() => document.body.dataset["services"]), "the live build").toBe(
      "live",
    );
    const next = page.getByRole("button", { name: "Continue", exact: true });
    await page.getByLabel("Property address", { exact: true }).fill(run.address);
    await page.getByLabel("City", { exact: true }).fill("Ojai");
    await page.getByLabel(/^State/).selectOption("California");
    await page.getByLabel("ZIP", { exact: true }).fill("93023");
    await page.getByLabel(/^Property type/).selectOption({ index: 1 });
    await next.click();
    await page
      .getByLabel("The property story", { exact: true })
      .fill("A house built for the light.");
    await page
      .getByLabel("What makes this property significant?", { exact: true })
      .fill("Its plan follows the sun.");
    if (photos > 0) {
      await page.locator('input[type="file"]').setInputFiles(
        Array.from({ length: photos }, (_, index) => ({
          name: `room-${String(index + 1)}.jpg`,
          mimeType: "image/jpeg",
          buffer: Buffer.concat([TINY, Buffer.from(`room ${String(index + 1)}`)]),
        })),
      );
    }
    await next.click();
    await page.getByLabel(/^I am/).selectOption({ label: "Property owner" });
    await page.getByLabel("Your name", { exact: true }).fill("E2E Owner");
    await page.getByLabel("Email", { exact: true }).fill(run.email);
    await next.click();
    await page.getByRole("radio", { name: "The Feature" }).click();
    await page.getByRole("checkbox", { name: /I confirm I have the rights/ }).check();
    await next.click();
    const posted = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/public/submissions",
    );
    await page.getByRole("button", { name: "Send for review" }).click();
    expect((await posted).status()).toBe(201);
    await expect(
      page.getByText(
        photos > 0 ? "Received, with every photograph." : "Received. Editorial review comes next.",
      ),
    ).toBeVisible({ timeout: 120_000 });
  } finally {
    await context.close();
  }
}

/** Photographs go straight into Storage and the `reconcile` job records them, every 15 minutes: the run asks for it now. */
async function settleUploads(requestId: string): Promise<void> {
  await sql("select public.enqueue_job('reconcile', $1::jsonb, $2)", [
    JSON.stringify({ params: { daily: true }, data: {} }),
    `reconcile:e2e-${randomUUID()}`,
  ]);
  await expect
    .poll(
      async () =>
        (
          await one<{ count: number }>(
            "select count(*)::int as count from public.submission_media where submission_id = $1 and uploaded_at is not null",
            [requestId],
          )
        ).count,
      { intervals: [5000], timeout: RUNNER_LIMIT_MS },
    )
    .toBe(PHOTOS);
}

/** The draft screen to the recorded invoice, then the invoice page: mark paid and activate. Answers the payment id. */
async function invoiceAndActivate(page: Page, id: string): Promise<string> {
  await page.goto(`/admin/invoices/new?submission_id=${id}`);
  await expect(page.getByRole("heading", { name: "New invoice" })).toBeVisible();
  await checkpoint(page, "full path: invoice draft");
  await page.getByLabel("Preferred payment method").fill("bank_transfer");
  await page.getByRole("button", { name: "Issue and email" }).click();
  const issue = page.getByRole("dialog");
  await expect(issue.getByRole("heading", { name: "Issue and email this invoice" })).toBeVisible();
  await checkpoint(page, "full path: issue dialog");
  await issue.getByRole("button", { name: "Issue and email" }).click();
  await expect(
    page.getByRole("region", { name: "Recorded" }).getByText("Invoice issued."),
  ).toBeVisible();
  const payment = await one<{ id: string; status: string }>(
    "select id, status from public.payments where submission_id = $1 and status <> 'void'",
    [id],
  );
  expect(payment.status).toBe("due");

  await page.goto(`/admin/invoices/${payment.id}`);
  await page.getByRole("button", { name: "Mark paid" }).click();
  const paid = page.getByRole("dialog");
  await expect(paid.getByRole("heading", { name: "Mark this invoice paid" })).toBeVisible();
  await checkpoint(page, "full path: mark paid dialog");
  // The database clock (R51): `mark_payment_paid` compares the date it is given with its own `now()`.
  const received = await one<{ day: string }>(
    "select to_char(timezone('America/New_York', now() - interval '36 hours'), 'YYYY-MM-DD') as day",
  );
  await paid.getByLabel("Date received").fill(received.day);
  await paid.getByLabel("Method").fill("Bank transfer");
  await paid.getByRole("button", { name: "Mark paid" }).click();
  await expect(
    page.locator(".admin-invoice-page__state").getByText("Paid", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Activate" }).click();
  const activate = page.getByRole("dialog");
  await expect(activate.getByRole("heading", { name: "Activate this request" })).toBeVisible();
  await checkpoint(page, "full path: activate dialog");
  await activate.getByRole("button", { name: "Activate" }).click();
  await expect(page.getByText("Activated", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Jobs started" }).getByText("copy submission media"),
  ).toBeVisible();
  return payment.id;
}

/** The job's status, with its error while it waits to be retried, so a wait that runs out says why. */
async function jobStatus(id: string): Promise<string> {
  const job = await one<{ status: string; error: string | null }>(
    "select status::text as status, error from public.jobs where id = $1",
    [id],
  );
  return job.status === "failed" || job.status === "dead"
    ? `${job.status}: ${job.error ?? "no error recorded"}`
    : job.status;
}

/** After activate: the property draft, the campaign and the copy job; with the runner, its result and the one render. */
async function expectActivated(requestId: string, paymentId: string): Promise<string> {
  const request = await one<{ workflow_state: string; property_id: string }>(
    "select workflow_state, property_id from public.submissions where id = $1",
    [requestId],
  );
  expect(request.workflow_state).toBe("Scheduled");
  const property = await one<{ editorial_state: string }>(
    "select editorial_state from public.properties where id = $1",
    [request.property_id],
  );
  expect(property.editorial_state).toBe("draft");
  const campaigns = await one<{ count: string }>(
    "select count(*) from public.campaigns where payment_id = $1",
    [paymentId],
  );
  expect(campaigns.count).toBe("1");
  const copy = await one<{ id: string }>("select id from public.jobs where idempotency_key = $1", [
    `copy_submission_media:${request.property_id}`,
  ]);
  if (withRunner) {
    await expect
      .poll(() => jobStatus(copy.id), { intervals: [POLL_MS], timeout: RUNNER_LIMIT_MS })
      .toBe("done");
    const renders = await sql<{ id: string }>(
      "select id from public.jobs where type = 'render_variants' and payload -> 'data' ->> 'property_id' = $1",
      [request.property_id],
    );
    expect(renders).toHaveLength(1);
  }
  return request.property_id;
}

/** Waits for the render, checks the stored photographs, completes the draft's checklist and publishes it. */
async function renderAndPublish(page: Page, propertyId: string): Promise<void> {
  const render = await one<{ id: string }>(
    "select id from public.jobs where type = 'render_variants' and payload -> 'data' ->> 'property_id' = $1",
    [propertyId],
  );
  await expect
    .poll(() => jobStatus(render.id), { intervals: [POLL_MS], timeout: RENDER_LIMIT_MS })
    .toBe("done");
  const rows = await sql<{ media_key: string | null; staging_path: string | null }>(
    "select media_key, staging_path from public.property_media where property_id = $1 order by sort_order",
    [propertyId],
  );
  expect(rows).toHaveLength(PHOTOS);
  for (const row of rows) {
    expect(row.staging_path).toBeNull();
    expect(row.media_key).not.toBeNull();
  }
  const hero = rows[0]?.media_key;
  expect((await page.request.get(`/media/${hero ?? ""}`)).status()).toBe(200);

  // The editor's other work, which the editorial spec drives from the screens: the facts, the story and the alt text.
  await sql(
    `update public.properties set
       region_slug = (select slug from public.regions where market_slug = 'california' order by slug limit 1),
       neighborhood = 'Fixture Quarter', price = 2500000, beds = 4, baths = 3.5, interior_sq_ft = 3200,
       lot_acres = 0.4, year_built = 1962, style = 'Fixture Style', place = 'A quiet street.',
       presented_by_owner = true, story = array['A house built for the light.', 'Its plan follows the sun.']
     where id = $1`,
    [propertyId],
  );
  await sql(
    "update public.property_media set alt = 'A room of the fixture house' where property_id = $1",
    [propertyId],
  );
  await page.goto(`/admin/properties/${propertyId}`);
  const publication = page.getByRole("complementary", { name: "Publication" });
  await expect(publication).toBeVisible();
  await checkpoint(page, "full path: property editor");
  await publication.getByRole("button", { name: "Send to review" }).click();
  await publication.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(publication.getByText("Published", { exact: true })).toBeVisible();
  const published = await one<{ editorial_state: string }>(
    "select editorial_state::text as editorial_state from public.properties where id = $1",
    [propertyId],
  );
  expect(published.editorial_state).toBe("published");
}

test.describe.configure({ mode: "default" });

test.describe("admin full path (B7 step 16)", () => {
  test("a person takes a request from /submit to an activated property, and every history entry names who acted", async ({
    browser,
  }) => {
    test.setTimeout(withRender ? 1_500_000 : 480_000);
    await seedFullPathRun(async (run) => {
      await submitRequest(browser, run, withRunner ? PHOTOS : 0);
      const { id } = await one<{ id: string }>(
        "select id from public.submissions where submitter_email = $1",
        [run.email],
      );
      if (withRunner) await settleUploads(id);
      const { context, page } = await signInAs(browser, MANAGING_EDITOR);
      try {
        await openRequest(page, id);
        await checkpoint(page, "full path: request");
        await statusPanel(page).getByRole("button", { name: "Start review" }).click();
        await expect(statusPanel(page).getByText("Under Review", { exact: true })).toBeVisible();
        await statusPanel(page).getByRole("button", { name: "Accept" }).click();
        const accept = page.getByRole("dialog", { name: "Accept this request" });
        await checkpoint(page, "full path: accept dialog");
        await accept.getByRole("button", { name: "Accept", exact: true }).click();
        await expect(page.getByText("Request accepted.")).toBeVisible();

        const paymentId = await invoiceAndActivate(page, id);
        const propertyId = await expectActivated(id, paymentId);
        if (withRender) await renderAndPublish(page, propertyId);

        await openRequest(page, id);
        await expect(history(page).getByText("Accepted")).toBeVisible();
        await checkpoint(page, "full path: request history");
        await expectActors(history(page), { agent: false });
      } finally {
        await context.close();
      }
    });
  });

  test("an agent key takes the same decisions, is refused the two only a person takes, and its history entries carry the Agent pill", async ({
    browser,
    request,
  }) => {
    test.setTimeout(300_000);
    let agentUser: string | undefined;
    try {
      await seedFullPathFixtures(async ({ submissions, property }) => {
        const { context, page } = await signInAs(browser, ADMIN);
        try {
          const issued = await issueAgentKey(page);
          agentUser = issued.user_id;
          const key = issued.key;
          try {
            const [declined, accepted] = submissions;
            if (declined === undefined || accepted === undefined)
              throw new Error("two requests needed");
            await agentOk(request, key, "POST", "submissions/start-review", {
              ids: submissions.map((entry) => entry.id),
            });
            const reasons = reasonsAnswer.parse(
              await agentOk(request, key, "GET", "submissions/decline-reasons"),
            );
            const reason = reasons.items[0];
            if (reason === undefined) throw new Error("admin-full-path: no decline reason");
            await agentOk(request, key, "POST", `submissions/${declined.id}/decline`, {
              decline_reason_id: reason.id,
            });
            decisionAnswer.parse(
              await agentOk(request, key, "POST", `submissions/${accepted.id}/accept`, {}),
            );
            const states = await sql<{ workflow_state: string }>(
              "select workflow_state::text from public.submissions where id = any($1::uuid[]) order by id",
              [[declined.id, accepted.id]],
            );
            expect(states.map((row) => row.workflow_state).sort()).toEqual([
              "Accepted",
              "Declined",
            ]);

            const before = await one<{ version: number }>(
              "select version from public.properties where id = $1",
              [property.id],
            );
            const reviewed = versionAnswer.parse(
              await agentOk(request, key, "PATCH", `properties/${property.id}`, {
                expected_version: before.version,
                patch: { editorial_state: "review" },
              }),
            );
            await agentOk(request, key, "POST", `properties/${property.id}/publish`, {
              expected_version: reviewed.version,
            });
            const published = await one<{ editorial_state: string }>(
              "select editorial_state::text as editorial_state from public.properties where id = $1",
              [property.id],
            );
            expect(published.editorial_state).toBe("published");

            // Recording money and activating are a person's act (humanOnly), whatever the key's scopes and role.
            const refused = await Promise.all([
              asAgent(request, key, "POST", `payments/${property.id}/mark-paid`, {
                paid_at: "2026-01-01",
                method: "Bank transfer",
              }),
              asAgent(request, key, "POST", `submissions/${accepted.id}/activate`, {}),
            ]);
            expect(
              refused.map(({ status, text }) => ({
                status,
                code: answerBody.parse(JSON.parse(text)).error.code,
              })),
            ).toEqual([
              { status: 403, code: "human_only" },
              { status: 403, code: "human_only" },
            ]);

            const timeline = timelineAnswer.parse(
              await agentOk(request, key, "GET", `submissions/${declined.id}/timeline`),
            );
            // The fixture ids are the same on every run and the audit trail is append-only: earlier runs' rows are agent rows too.
            const declines = timeline.items.filter(
              (entry) => entry.action === "submissions.decline",
            );
            expect(declines.length).toBeGreaterThan(0);
            expect(declines.every((entry) => entry.actor_kind === "agent")).toBe(true);

            for (const entry of [declined, accepted]) {
              await openRequest(page, entry.id);
              await expect(
                history(page)
                  .getByText(/^(Declined|Accepted)/)
                  .first(),
              ).toBeVisible();
              if (entry === declined) await checkpoint(page, "full path: request history, agent");
              await expectActors(history(page), { agent: true });
            }
          } finally {
            const revoked = await sessionCall(
              page,
              "DELETE",
              `/api/admin/team/agents/${issued.user_id}/keys/${issued.key_id}`,
            );
            expect(revoked.status, revoked.body).toBe(200);
          }
          expect((await asAgent(request, key, "GET", "me")).status).toBe(401);
        } finally {
          await context.close();
        }
      });
    } finally {
      if (agentUser !== undefined) await removeAgent(agentUser);
    }
  });
});

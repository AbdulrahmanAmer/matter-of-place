import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { z } from "zod";
import { seedEditorialFixtures } from "./fixtures/admin-data";
import { checkpoint } from "./fixtures/a11y";
import { signInAs } from "./helpers/session";

// B7 step 10, Part 1 of the observed exit: "an editor reviews, declines one, accepts one, publishes one, all from the
// UI". A managing editor starts review on three requests, declines one, accepts one and publishes a draft whose
// checklist is green, with an axe checkpoint after each screen and dialog (T-05); a commercial actor sees no move and
// is refused by the API. Rows are read back over `pg` on DEV_DB_URL (P-431). The render leg waits for B9's
// `render_variants` with E2E_RENDER=1 (laptop, mop-dev); the decline letter's `email_messages` row is read with
// E2E_FULL_STACK=1, where the job runner runs (ruling H70): a dry run until B5 step 5 sets EMAIL_LIVE=1, and with
// E2E_RESEND=1 after that, a letter Resend accepted.

const MANAGING_EDITOR = "staff+managing@matterofplace.com";
const COMMERCIAL = "staff+commercial@matterofplace.com";
const POLL_MS = 10_000;
const RENDER_LIMIT_MS = 600_000;
const MAIL_LIMIT_MS = 180_000;

function dbUrl(): string {
  const url = process.env["DEV_DB_URL"];
  if (url === undefined || url === "") throw new Error("admin-editorial: DEV_DB_URL is not set");
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

/**
 * The jobs of the catalog event `type` about `entityId` since `since`, oldest first. The fixture ids are the same on
 * every run and events are never deleted, so an earlier run's events are left out by time.
 */
const jobsOf = (type: string, entityId: string, since: string) =>
  sql<{ id: string; type: string; status: string }>(
    `select j.id, j.type, j.status::text as status from public.jobs j
     join public.events e on e.id = j.event_id
     where e.type = $1 and e.entity_id = $2 and e.at >= $3::timestamptz order by j.created_at`,
    [type, entityId, since],
  );

/** Polls `read` every 10 seconds until it answers a value, for at most `limitMs`. */
async function waitFor<T>(read: () => Promise<T | undefined>, limitMs: number): Promise<T> {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline)
      throw new Error(`admin-editorial: nothing after ${String(limitMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

const errorBody = z.object({ error: z.object({ code: z.string() }) });

const statusPanel = (page: Page) => page.getByRole("region", { name: "Status" });

async function openRequest(page: Page, id: string): Promise<void> {
  await page.goto(`/admin/requests/${id}`);
  await expect(statusPanel(page)).toBeVisible();
}

test.describe("admin editorial (B7 step 10)", () => {
  test("a managing editor reviews three requests, declines one, accepts one and publishes a draft", async ({
    browser,
  }) => {
    test.setTimeout(process.env["E2E_RENDER"] === "1" ? 900_000 : 300_000);
    await seedEditorialFixtures(async ({ submissions, property }) => {
      const [started] = await sql<{ now: string }>("select now()::text as now");
      if (started === undefined) throw new Error("admin-editorial: no database time");
      const { context, page } = await signInAs(browser, MANAGING_EDITOR);
      try {
        await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
        await checkpoint(page, "admin: dashboard");

        await page.goto("/admin/requests?workflow_state=Submitted");
        await expect(page.getByRole("table")).toBeVisible();
        await checkpoint(page, "admin: requests");

        for (const [index, request] of submissions.entries()) {
          await openRequest(page, request.id);
          if (index === 0) await checkpoint(page, "admin: request");
          await statusPanel(page).getByRole("button", { name: "Start review" }).click();
          await expect(statusPanel(page).getByText("Under Review", { exact: true })).toBeVisible();
        }
        const [declined, accepted] = submissions;
        if (declined === undefined || accepted === undefined)
          throw new Error("two requests needed");

        await openRequest(page, declined.id);
        await statusPanel(page).getByRole("button", { name: "Decline" }).click();
        const decline = page.getByRole("dialog", { name: "Decline this request" });
        await expect(decline.getByLabel("Reason").locator("option")).not.toHaveCount(1);
        await decline.getByLabel("Reason").selectOption({ index: 1 });
        await checkpoint(page, "admin: decline dialog");
        await decline.getByRole("button", { name: "Decline", exact: true }).click();
        await expect(page.getByText("Request declined.")).toBeVisible();
        const watched = page.getByRole("list", { name: "Jobs started" });
        await expect(watched.getByText("send email")).toBeVisible();
        const declineJobs = await jobsOf("submission.declined", declined.id, started.now);
        expect(declineJobs.map((job) => job.type)).toContain("send_email");

        await openRequest(page, accepted.id);
        await statusPanel(page).getByRole("button", { name: "Accept" }).click();
        const accept = page.getByRole("dialog", { name: "Accept this request" });
        await checkpoint(page, "admin: accept dialog");
        await accept.getByRole("button", { name: "Accept", exact: true }).click();
        await expect(page.getByText("Request accepted.")).toBeVisible();
        expect(
          (
            await sql<{ state: string }>(
              "select workflow_state::text as state from public.submissions where id = any($1::uuid[]) order by id",
              [[declined.id, accepted.id]],
            )
          )
            .map((row) => row.state)
            .sort(),
        ).toEqual(["Accepted", "Declined"]);

        await page.goto(`/admin/properties/${property.id}`);
        const publication = page.getByRole("complementary", { name: "Publication" });
        await expect(publication).toBeVisible();
        await checkpoint(page, "admin: property editor");
        await publication.getByRole("button", { name: "Send to review" }).click();
        await publication.getByRole("button", { name: "Publish", exact: true }).click();
        await expect(publication.getByText("Published", { exact: true })).toBeVisible();
        const [published] = await sql<{ state: string }>(
          "select editorial_state::text as state from public.properties where id = $1",
          [property.id],
        );
        expect(published?.state).toBe("published");
        const render = (await jobsOf("property.published", property.id, started.now)).find(
          (job) => job.type === "render_variants",
        );
        expect(render?.status).toBeDefined();

        if (process.env["E2E_RENDER"] === "1" && render !== undefined) {
          const ended = await waitFor(async () => {
            const [row] = await sql<{ status: string }>(
              "select status::text as status from public.jobs where id = $1",
              [render.id],
            );
            return row !== undefined && ["done", "dead", "cancelled"].includes(row.status)
              ? row.status
              : undefined;
          }, RENDER_LIMIT_MS);
          expect(ended).toBe("done");
        }

        if (process.env["E2E_FULL_STACK"] === "1") {
          const mail = await waitFor(async () => {
            const [row] = await sql<{ status: string; resend_id: string | null }>(
              `select m.status, m.resend_id from public.email_messages m
               where m.job_id = any($1::uuid[]) and m.status <> 'queued'`,
              [declineJobs.map((job) => job.id)],
            );
            return row;
          }, MAIL_LIMIT_MS);
          // Until B5 step 5 sets EMAIL_LIVE=1 on the runner, a send is a dry run (B5 invariant 16).
          expect(
            process.env["E2E_RESEND"] === "1"
              ? ["sent", "delivered"].includes(mail.status)
              : mail.status === "skipped" && mail.resend_id?.startsWith("dry_") === true,
            `mail row ${mail.status} ${String(mail.resend_id)}`,
          ).toBe(true);
        }
      } finally {
        await context.close();
      }
    });
  });

  test("a commercial actor sees no move on a request and the API refuses one with 403", async ({
    browser,
  }) => {
    const [request] = await sql<{ id: string }>(
      `select id from public.submissions
       where submitter_email like 'fixture+%@fixtures.invalid' and workflow_state = 'Submitted' limit 1`,
    );
    if (request === undefined)
      throw new Error("admin-editorial: run with E2E_DATASET=1 for B4's data set");
    const { context, page } = await signInAs(browser, COMMERCIAL);
    try {
      await openRequest(page, request.id);
      await checkpoint(page, "admin: request, commercial");
      await expect(statusPanel(page).getByRole("button")).toHaveCount(0);
      const answers = await page.evaluate(async (id) => {
        const token = /(?:^|; )mop_csrf=([^;]*)/.exec(document.cookie)?.[1] ?? "";
        const post = async (path: string, body: unknown) => {
          const response = await fetch(path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-mop-csrf": decodeURIComponent(token),
            },
            body: JSON.stringify(body),
          });
          return { status: response.status, text: await response.text() };
        };
        return [
          await post("/api/admin/submissions/start-review", { ids: [id] }),
          await post(`/api/admin/submissions/${id}/decline`, { decline_reason_id: id }),
        ];
      }, request.id);
      expect(
        answers.map(({ status, text }) => ({
          status,
          code: errorBody.parse(JSON.parse(text)).error.code,
        })),
      ).toEqual([
        { status: 403, code: "forbidden" },
        { status: 403, code: "forbidden" },
      ]);
    } finally {
      await context.close();
    }
  });

  test("the dashboard counts the requests waiting", async ({ browser }) => {
    const [step9] = await sql<{ present: boolean }>(
      "select to_regprocedure('public.admin_dashboard()') is not null as present",
    );
    test.skip(
      step9?.present !== true,
      "admin_dashboard() reaches mop-dev only when main pushes step 9's migration (ruling H57)",
    );
    const { context, page } = await signInAs(browser, COMMERCIAL);
    try {
      const submitted = page.getByRole("listitem", { name: "Submitted" });
      // The managing-editor test of this file, and other files of the run, move Submitted rows while this one runs
      // (fullyParallel, R52): a tile read and a count taken apart can straddle one of their writes, so reload until a
      // pair agrees.
      await expect(async () => {
        await page.reload();
        const shown = await submitted
          .locator(".admin-tile__value")
          .textContent({ timeout: 10_000 });
        const [waiting] = await sql<{ count: number }>(
          "select count(*)::int as count from public.submissions where workflow_state = 'Submitted'",
        );
        expect(Number(shown?.replaceAll(",", ""))).toBe(waiting?.count);
      }).toPass({ timeout: 90_000 });
      await expect(page.getByRole("region", { name: "Free tier" })).toBeVisible();
      await checkpoint(page, "admin: dashboard, commercial");
    } finally {
      await context.close();
    }
  });
});

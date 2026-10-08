// B10 step 9: the admin functions of screen 22 (`src/server/reports/service.ts`). The database is tableDb of
// tests/fixtures/channel-db.ts, whose tables keep only the rows a query's filters keep; the one RPC answers what
// each case registers. A platform is never called from here (invariant 1).
import { describe, expect, it } from "vitest";
import { appRoles } from "../../../src/domain/contracts";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { emailReport, getReport, listReports } from "../../../src/server/reports/service";
import { tableDb, type Handler } from "../../fixtures/channel-db";

const JOB = "3f2a9c1d-0000-4000-8000-0000000000f1";
const CAMPAIGN = "3f2a9c1d-0000-4000-8000-0000000000e1";
const uuid = (n: number) => `3f2a9c1d-0000-4000-8000-${String(n).padStart(12, "0")}`;

const actor = (roles: AdminActor["roles"], kind: AdminActor["kind"] = "human"): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind,
  roles,
  scopes: ["reports"],
  requestId: "req-rep",
});

/** A `campaign_reports` row as PostgREST returns it with its campaign and the property's title embedded. */
function row(n: number, campaign = CAMPAIGN) {
  return {
    id: uuid(n),
    campaign_id: campaign,
    period_start: `2026-${String(1 + (n % 9)).padStart(2, "0")}-01`,
    period_end: `2026-${String(1 + (n % 9)).padStart(2, "0")}-07`,
    media_spend: 0,
    impressions: 3500,
    reach: 1000,
    clicks: 2,
    video_views: null,
    ctr: null,
    geography: {},
    channel_mix: { x: { posts: 1, clicks: 2 } },
    owned_distribution: {},
    top_creative: null,
    campaigns: { property_id: uuid(7), properties: { title: "Oak Hill" } },
  };
}

function db(rows = [row(1)], handlers: Record<string, Handler> = {}) {
  return tableDb({ campaign_reports: rows }, handlers);
}

const rpcs = (database: ReturnType<typeof db>) =>
  database.calls.filter((call) => call.kind === "rpc");

describe("listReports", () => {
  it("returns 50 of 51 rows with the total, the property's name and zeros for an empty owned_distribution", async () => {
    const rows = Array.from({ length: 51 }, (_, index) => row(index + 1));
    const page = await listReports(actor(["media_ops"]), db(rows), { page: 1 });
    expect(page.items).toHaveLength(50);
    expect(page.total).toBe(51);
    expect(page.items[0]).toMatchObject({
      property_name: "Oak Hill",
      owned_distribution: { newsletter_issues: 0, newsletter_clicks: 0 },
    });
    expect(page.items[0]).not.toHaveProperty("campaigns");
    const second = await listReports(actor(["media_ops"]), db(rows), { page: 2 });
    expect(second.items).toHaveLength(1);
  });

  it("is allowed to every role", async () => {
    for (const role of appRoles) {
      const page = await listReports(actor([role]), db(), { page: 1 });
      expect(page.items.map((item) => item.id)).toEqual([uuid(1)]);
    }
  });

  it("narrows to one campaign", async () => {
    const other = "3f2a9c1d-0000-4000-8000-0000000000e2";
    const page = await listReports(actor(["commercial"]), db([row(1), row(2, other)]), {
      campaign_id: other,
      page: 1,
    });
    expect(page.items.map((item) => item.id)).toEqual([uuid(2)]);
  });
});

describe("getReport", () => {
  it("answers one report, and 404 for one that does not exist", async () => {
    const database = db([row(1), row(2)]);
    expect((await getReport(actor(["commercial"]), database, { id: uuid(2) })).id).toBe(uuid(2));
    await expect(getReport(actor(["commercial"]), database, { id: uuid(3) })).rejects.toMatchObject(
      { code: "not_found", status: 404 },
    );
  });
});

describe("emailReport", () => {
  it.each([
    ["commercial", actor(["commercial"])],
    ["media_ops", actor(["media_ops"])],
    ["an agent key", actor(["managing_editor"], "agent")],
  ])("is refused for %s with no database call", async (_label, who) => {
    const database = db();
    await expect(emailReport(who, database, { id: uuid(1) })).rejects.toMatchObject({
      status: 403,
    });
    expect(database.calls).toEqual([]);
  });

  it("makes one email_campaign_report call for a managing_editor and answers 202 with the job", async () => {
    const database = db([row(1)], { email_campaign_report: () => JOB });
    const response = await emailReport(actor(["managing_editor"]), database, { id: uuid(1) });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job_id: JOB });
    expect(rpcs(database)).toEqual([
      {
        kind: "rpc",
        name: "email_campaign_report",
        args: [
          {
            p_report_id: uuid(1),
            p_actor: "00000000-0000-4000-8000-000000000001",
            p_actor_kind: "human",
            p_request_id: "req-rep",
          },
        ],
      },
    ]);
  });

  it("answers duplicate when a job for this minute exists, and passes the SQL refusals through", async () => {
    const same = db([row(1)], { email_campaign_report: () => null });
    const response = await emailReport(actor(["chief_editor"]), same, { id: uuid(1) });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job_id: null, duplicate: true });
    const none = db([row(1)], { email_campaign_report: () => new Error("recipient_missing") });
    await expect(emailReport(actor(["chief_editor"]), none, { id: uuid(1) })).rejects.toMatchObject(
      { code: "recipient_missing", status: 422 },
    );
  });
});

// W7 item 3: the Campaigns read of screen 33 (`src/server/campaigns/service.ts`). The database is tableDb of
// tests/fixtures/channel-db.ts; a `campaigns` row is shaped as PostgREST returns it with the property and the count of
// its reports embedded.
import { describe, expect, it } from "vitest";
import { campaignListLimit, campaignListSchema } from "../../../src/domain/admin-campaigns";
import { appRoles } from "../../../src/domain/contracts";
import { listCampaigns } from "../../../src/server/campaigns/service";
import type { AdminActor } from "../../../src/server/lib/admin-route";
import { tableDb } from "../../fixtures/channel-db";

const uuid = (n: number) => `3f2a9c1d-0000-4000-8000-${String(n).padStart(12, "0")}`;

const actor = (roles: AdminActor["roles"], kind: AdminActor["kind"] = "human"): AdminActor => ({
  userId: "00000000-0000-4000-8000-000000000001",
  kind,
  roles,
  scopes: ["reports"],
  requestId: "req-campaigns",
});

function row(n: number, over: Record<string, unknown> = {}) {
  return {
    id: uuid(n),
    property_id: uuid(1000 + n),
    package: "The Campaign",
    media_budget: 5000,
    management_fee: 750,
    starts_on: "2026-10-05",
    ends_on: "2026-11-05",
    homepage_status: "active",
    featured_status: "planned",
    newsletter_status: "none",
    social_status: "active",
    programmatic_status: "done",
    created_at: `2026-10-${String(1 + (n % 28)).padStart(2, "0")}T00:00:00Z`,
    properties: { title: "Oak Hill", market_slug: "california" },
    campaign_reports: [{ count: 3 }],
    ...over,
  };
}

const db = (rows = [row(1)]) => tableDb({ campaigns: rows });

describe("listCampaigns", () => {
  it("shapes a row: the property's title and market, the five channels and the report count", async () => {
    const list = await listCampaigns(actor(["commercial"]), db());
    expect(list.total).toBe(1);
    expect(list.items[0]).toEqual({
      id: uuid(1),
      property_id: uuid(1001),
      property_title: "Oak Hill",
      market_slug: "california",
      package: "The Campaign",
      media_budget: 5000,
      management_fee: 750,
      starts_on: "2026-10-05",
      ends_on: "2026-11-05",
      channels: {
        homepage: "active",
        featured: "planned",
        newsletter: "none",
        social: "active",
        programmatic: "done",
      },
      report_count: 3,
    });
    expect(list.items[0]).not.toHaveProperty("properties");
  });

  it("counts no reports as 0, and keeps a campaign with no dates", async () => {
    const list = await listCampaigns(
      actor(["commercial"]),
      db([row(1, { campaign_reports: [], starts_on: null, ends_on: null })]),
    );
    expect(list.items[0]).toMatchObject({ report_count: 0, starts_on: null, ends_on: null });
  });

  it("answers the newest campaigns first, at most the limit, with the total of all", async () => {
    const rows = Array.from({ length: campaignListLimit + 1 }, (_, index) =>
      row(index + 1, { created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() }),
    );
    const list = await listCampaigns(actor(["media_ops"]), db(rows));
    expect(list.items).toHaveLength(campaignListLimit);
    expect(list.total).toBe(campaignListLimit + 1);
    expect(list.items[0]?.id).toBe(uuid(campaignListLimit + 1));
    expect(list.items.map((item) => item.id)).not.toContain(uuid(1));
  });

  it("is allowed to every role", async () => {
    for (const role of appRoles) {
      const list = await listCampaigns(actor([role]), db());
      expect(list.items.map((item) => item.id)).toEqual([uuid(1)]);
    }
  });

  it("is refused for an actor with no role, with no database call", async () => {
    const database = db();
    await expect(listCampaigns(actor([]), database)).rejects.toMatchObject({ status: 403 });
    expect(database.calls).toEqual([]);
  });

  it("refuses a package the database enum does not hold, in the service and in the contract", async () => {
    await expect(
      listCampaigns(actor(["commercial"]), db([row(1, { package: "The Platinum" })])),
    ).rejects.toThrow();
    const list = await listCampaigns(actor(["commercial"]), db());
    expect(campaignListSchema.safeParse(list).success).toBe(true);
    const unknown = { ...list, items: [{ ...list.items[0], package: "The Platinum" }] };
    expect(campaignListSchema.safeParse(unknown).success).toBe(false);
  });

  it("reads only the campaigns table", async () => {
    const database = db();
    await listCampaigns(actor(["commercial"]), database);
    expect(database.calls.map((call) => call.name)).toEqual(["campaigns"]);
  });
});

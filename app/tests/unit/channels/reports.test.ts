// B10 step 9: buildCampaignReport (G7, G22). The database is tableDb of tests/fixtures/channel-db.ts, whose tables keep
// only the rows a query's filters keep, JSON paths of `eq` included; the one RPC records what it is given.
import { describe, expect, it } from "vitest";
import { addDays, buildCampaignReport, weekStartOf } from "../../../src/server/reports/build";
import { ASSET, PROPERTY, postRow, tableDb } from "../../fixtures/channel-db";

const CAMPAIGN = "3f2a9c1d-0000-4000-8000-0000000000e1";
const REPORT = "3f2a9c1d-0000-4000-8000-0000000000e2";
const REEL = "3f2a9c1d-0000-4000-8000-0000000000e3";
const COVER = "3f2a9c1d-0000-4000-8000-0000000000e4";
const WEEK = "2026-10-05";

type Row = Record<string, unknown>;

const utm = (source: string, medium = "social", at = "2026-10-07T10:00:00.000Z"): Row => ({
  event: "property_view",
  occurred_at: at,
  data: { utm: { utm_source: source, utm_medium: medium, utm_campaign: "oak-hill" } },
});

const posted = (channel: string, asset: string, metrics: Row, at = "2026-10-06T14:00:00.000Z") =>
  postRow(channel, {
    id: `${asset}-${channel}`,
    asset_id: asset,
    status: "posted",
    posted_at: at,
    metrics: { fetched_at: at, ...metrics },
  });

interface World {
  campaign?: Row;
  posts?: Row[];
  events?: Row[];
  issues?: Row[];
  x?: Row;
}

/** One campaign of a property with an Instagram reel (reach 1000, views 3000) and an X cover (views 500). */
function world(options: World = {}) {
  const stored: Row[] = [];
  const db = tableDb(
    {
      campaigns: [
        {
          id: CAMPAIGN,
          property_id: PROPERTY,
          starts_on: null,
          ends_on: null,
          ...options.campaign,
        },
      ],
      properties: [{ id: PROPERTY, slug: "oak-hill" }],
      social_posts: options.posts ?? [
        posted("instagram", REEL, { reach: 1000, views: 3000, clicks: null }),
        posted("x", COVER, { reach: null, views: 500, clicks: 40 }),
      ],
      assets: [
        { id: REEL, kind: "reel" },
        { id: COVER, kind: "cover" },
        { id: ASSET, kind: "carousel" },
      ],
      settings: [{ key: "x", value: options.x ?? { metrics_days: [7, 28] } }],
      newsletter_issues: options.issues ?? [],
      analytics_events: options.events ?? [],
    },
    {
      upsert_campaign_report: (args) => {
        stored.push(args);
        return REPORT;
      },
    },
  );
  return { db, stored };
}

const rowOf = (stored: Row[]) => {
  const args = stored[0];
  if (args === undefined) throw new Error("no report was stored");
  return args["p_row"];
};

describe("buildCampaignReport", () => {
  it("sums reach, impressions and reel views, and names the post with the most reach", async () => {
    const { db, stored } = world();
    expect(await buildCampaignReport(db, CAMPAIGN, WEEK)).toEqual({ status: "built", id: REPORT });
    expect(stored[0]).toMatchObject({ p_campaign_id: CAMPAIGN, p_period_start: WEEK });
    expect(rowOf(stored)).toMatchObject({
      reach: 1000,
      impressions: 3500,
      video_views: 3000,
      geography: {},
      media_spend: 0,
      top_creative: REEL,
      owned_distribution: { newsletter_issues: 0, newsletter_clicks: 0 },
    });
  });

  it("leaves ctr null when there are no impressions and video_views null without reels", async () => {
    const { db, stored } = world({
      posts: [posted("linkedin", COVER, { reach: null, views: null, clicks: null })],
      events: [utm("linkedin")],
    });
    await buildCampaignReport(db, CAMPAIGN, WEEK);
    expect(rowOf(stored)).toMatchObject({
      impressions: 0,
      clicks: 1,
      ctr: null,
      video_views: null,
    });
  });

  it("counts clicks from first-party visits only, and keeps the platform's clicks in platform_clicks", async () => {
    const { db, stored } = world({
      events: [
        utm("x"),
        utm("x", "social", "2026-10-09T08:00:00.000Z"),
        utm("x", "social", "2026-10-12T09:00:00.000Z"),
        utm("x", "email"),
        {
          event: "property_view",
          occurred_at: "2026-10-07T10:00:00.000Z",
          data: { utm_source: "x", utm_medium: "social", utm_campaign: "oak-hill" },
        },
      ],
    });
    await buildCampaignReport(db, CAMPAIGN, WEEK);
    const row = rowOf(stored);
    expect(row).toMatchObject({ clicks: 2, ctr: 2 / 3500 });
    expect(row).toMatchObject({
      channel_mix: { x: { posts: 1, clicks: 2, platform_clicks: 40, views: 500 } },
    });
  });

  it("leaves out a field no post of a channel returned instead of writing 0", async () => {
    const { db, stored } = world({ events: [utm("instagram")] });
    await buildCampaignReport(db, CAMPAIGN, WEEK);
    expect(rowOf(stored)).toHaveProperty("channel_mix", {
      instagram: { posts: 1, reach: 1000, views: 3000, clicks: 1 },
      x: { posts: 1, clicks: 0, views: 500, platform_clicks: 40 },
    });
    expect(JSON.stringify(rowOf(stored))).not.toContain('"reach":null');
  });

  it("shows X as posts and clicks only while its metric days are empty", async () => {
    const { db, stored } = world({ x: { metrics_days: [] }, events: [utm("x")] });
    await buildCampaignReport(db, CAMPAIGN, WEEK);
    expect(rowOf(stored)).toMatchObject({ channel_mix: { x: { posts: 1, clicks: 1 } } });
    expect(JSON.stringify(rowOf(stored))).not.toContain('"platform_clicks"');
  });

  it("counts a post in the week it was posted, and inside the campaign's dates only", async () => {
    const { db, stored } = world({
      campaign: { starts_on: "2026-10-06", ends_on: "2026-10-08" },
      posts: [
        posted("instagram", REEL, { reach: 10, views: 20 }, "2026-10-06T14:00:00.000Z"),
        posted("instagram", COVER, { reach: 5, views: 5 }, "2026-10-05T23:00:00.000Z"),
        posted("x", COVER, { reach: 7, views: 7 }, "2026-10-09T09:00:00.000Z"),
        posted("linkedin", COVER, { reach: 9, views: 9 }, "2026-09-30T09:00:00.000Z"),
      ],
    });
    await buildCampaignReport(db, CAMPAIGN, WEEK);
    expect(rowOf(stored)).toMatchObject({ reach: 10, impressions: 20 });
  });

  it("sums the newsletter clicks of the issues sent that week that name the property", async () => {
    const { db, stored } = world({
      issues: [
        {
          sent_at: "2026-10-08T09:00:00.000Z",
          metrics: { per_property: { [PROPERTY]: { clicks: 6 } } },
        },
        {
          sent_at: "2026-10-09T09:00:00.000Z",
          metrics: { per_property: { [PROPERTY]: { clicks: 4 } } },
        },
        {
          sent_at: "2026-10-09T09:00:00.000Z",
          metrics: { per_property: { other: { clicks: 99 } } },
        },
        {
          sent_at: "2026-10-13T09:00:00.000Z",
          metrics: { per_property: { [PROPERTY]: { clicks: 50 } } },
        },
      ],
    });
    await buildCampaignReport(db, CAMPAIGN, WEEK);
    expect(rowOf(stored)).toMatchObject({
      owned_distribution: { newsletter_issues: 2, newsletter_clicks: 10 },
    });
  });

  it("produces no report for a campaign that does not exist", async () => {
    const { db, stored } = world();
    expect(await buildCampaignReport(db, "3f2a9c1d-0000-4000-8000-0000000000ff", WEEK)).toEqual({
      skipped: "no_campaign",
    });
    expect(stored).toEqual([]);
  });
});

describe("the weeks", () => {
  it("finds the Monday of an ISO week and adds days across a month", () => {
    expect([
      weekStartOf("2026-10-06"),
      weekStartOf("2026-10-11"),
      weekStartOf("2026-10-12"),
    ]).toEqual(["2026-10-05", "2026-10-05", "2026-10-12"]);
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
});

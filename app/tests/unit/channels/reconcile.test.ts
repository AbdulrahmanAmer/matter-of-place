// B10 step 9: the social part of the reconcile job (`reconcile-social.ts`). The adapters are the real ones, the
// platforms are a fetch stub that answers by request and fails on one nobody registered, and the database is the
// channel world of tests/fixtures/channel-db.ts with the extra tables and functions this part reads and calls.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Json } from "../../../src/db/index.ts";
import { reconcileSocial } from "../../../src/server/channels/reconcile-social";
import type { StepContext } from "../../../src/server/jobs/types";
import { logLine } from "../../../src/server/lib/log";
import { context } from "../../fixtures/asset-rows";
import {
  channelWorld,
  PROPERTY,
  postRow,
  type Handler,
  type PostRow,
} from "../../fixtures/channel-db";
import { Answer, answerOf, stubPlatform } from "../../fixtures/social-api";

const NOW = new Date("2026-10-08T05:15:00.000Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CAMPAIGN = "3f2a9c1d-0000-4000-8000-0000000000e1";
const OTHER_CAMPAIGN = "3f2a9c1d-0000-4000-8000-0000000000e2";
const X_USER = "1700000000000000001";
const X_SETTINGS = {
  user_id: X_USER,
  handle: "mop_test",
  read_allowance: 100,
  usage: { month: "2026-10", reads: 10 },
};
const GRAPH = "https://graph.facebook.com/v23.0";
const LINKEDIN_STATS = "GET https://api.linkedin.com/rest/organizationalEntityShareStatistics";
const vaultSet = JSON.stringify({
  access_token: "access",
  refresh_token: "refresh",
  expires_at: "2026-12-01T00:00:00.000Z",
});

type Row = Record<string, unknown>;

const uuid = (n: number) => `3f2a9c1d-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ago = (ms: number, from = NOW) => new Date(from.getTime() - ms).toISOString();

/** A posted row `days` days old (and three hours, so it sits inside its day), with a remote id of its own. */
function aged(n: number, channel: string, days: number): PostRow {
  return postRow(channel, {
    id: uuid(n),
    status: "posted",
    posted_at: ago(days * DAY_MS + 3 * HOUR_MS),
    remote_id: `${channel}-${String(n)}`,
    permalink: `https://p.test/${String(n)}`,
  });
}

const insights = new Answer({ data: [{ name: "reach", values: [{ value: 4 }] }] });
const baseAnswers = (): Record<string, Answer> => ({
  [`GET https://api.x.com/2/users/me`]: answerOf("x", "users-me"),
  [`GET https://api.linkedin.com/rest/organizationAcls`]: answerOf("linkedin", "organization-acls"),
});

interface Setup {
  posts?: PostRow[];
  x?: Row;
  answers?: Record<string, Answer | Answer[]>;
  schedule?: boolean;
  campaigns?: Row[];
  handlers?: Record<string, Handler>;
}

/** A run of the job: the world, the platforms, and the calls each recorded. */
function setup(options: Setup = {}) {
  const platform = stubPlatform({ ...baseAnswers(), ...options.answers });
  const metrics: Row[] = [];
  const reports: Row[] = [];
  const world = channelWorld({
    posts: options.posts ?? [],
    settings: [
      {
        key: "meta",
        value: {
          page_id: "100",
          ig_user_id: "178",
          graph_version: "v23.0",
          token_state: "ok",
          token_expires_at: null,
        },
      },
      { key: "x", value: options.x ?? X_SETTINGS },
      {
        key: "linkedin",
        value: { organization_urn: "urn:li:organization:1", api_version: "202510" },
      },
    ],
    handlers: {
      get_vault_secret: (args) => (args["p_name"] === "meta_page_token" ? "EAAtest" : vaultSet),
      record_channel_check: () => null,
      set_social_post_metrics: (args) => {
        metrics.push(args);
        return null;
      },
      complete_distributed_submissions: () => 3,
      upsert_campaign_report: (args) => {
        reports.push(args);
        return uuid(900 + reports.length);
      },
      ...options.handlers,
    },
  });
  Object.assign(world.tables, {
    schedule_settings: [{ key: "reconcile", enabled: options.schedule ?? true }],
    campaigns: options.campaigns ?? [],
    newsletter_issues: [],
    analytics_events: [],
  });
  const ctx = (now = NOW): StepContext => ({
    ...context(world.db, "reconcile"),
    env: { META_APP_SECRET: "secret" },
    log: logLine,
    now,
  });
  const rpcs = (name: string) =>
    world.db.calls.filter((call) => call.kind === "rpc" && call.name === name);
  return { ...world, platform, metrics, reports, ctx, rpcs };
}

const daily = { daily: true } satisfies Json;

/** `result.social` of a daily run. */
async function dailyRun(run: ReturnType<typeof setup>): Promise<Row> {
  const { social } = await reconcileSocial(run.ctx(), daily, NOW);
  if (typeof social !== "object" || social === null || Array.isArray(social)) {
    throw new Error(`the daily part answered ${JSON.stringify(social)}`);
  }
  return social;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the quarter-hour runs", () => {
  it("enqueue exactly one daily run in the 96 ticks of a UTC day, none before 05:00", async () => {
    const run = setup();
    const answers: string[] = [];
    for (let tick = 0; tick < 96; tick += 1) {
      const now = new Date(Date.UTC(2026, 9, 8, 0, 0) + tick * 15 * 60_000);
      const { social } = await reconcileSocial(run.ctx(now), {}, now);
      answers.push(typeof social === "string" ? social : "a daily run");
    }
    expect(answers.slice(0, 20).every((answer) => answer === "not_due")).toBe(true);
    expect(answers[20]).toBe("daily_enqueued");
    expect(answers.slice(21).every((answer) => answer === "daily_exists")).toBe(true);
    expect(run.jobs.map((job) => [job.type, job.key, job.payload])).toEqual([
      ["reconcile", "reconcile_social:2026-10-08", { params: { daily: true }, data: {} }],
    ]);
  });

  it("make no complete_distributed_submissions call and no platform call", async () => {
    const run = setup({ posts: [aged(1, "instagram", 3)] });
    await reconcileSocial(run.ctx(), {}, NOW);
    expect(run.rpcs("complete_distributed_submissions")).toEqual([]);
    expect(run.platform.calls()).toEqual([]);
  });
});

describe("the daily part", () => {
  it("returns skipped_disabled when the reconcile row is off, and touches nothing", async () => {
    const run = setup({ schedule: false, posts: [aged(1, "instagram", 3)] });
    const { social } = await reconcileSocial(run.ctx(), daily, NOW);
    expect(social).toBe("skipped_disabled");
    expect(run.rpcs("complete_distributed_submissions")).toEqual([]);
    expect(run.platform.calls()).toEqual([]);
  });

  it("fails a scheduled row 48 hours and a minute past its time, and not one 47 hours past", async () => {
    const run = setup({
      posts: [
        postRow("instagram", { id: uuid(1), scheduled_at: ago(48 * HOUR_MS + 60_000) }),
        postRow("instagram", { id: uuid(2), scheduled_at: ago(47 * HOUR_MS) }),
      ],
    });
    const social = await dailyRun(run);
    expect(social["overdue"]).toBe(1);
    expect(run.posts.map((post) => [post.id, post.status, post.error])).toEqual([
      [uuid(1), "failed", "overdue"],
      [uuid(2), "scheduled", null],
    ]);
  });

  it("fetches Instagram and LinkedIn posts aged 1, 3, 7, 14 and 28 days once each, and a 2-day-old one never", async () => {
    const ages = [1, 2, 3, 7, 14, 28];
    const posts = ages.flatMap((days, index) => [
      aged(index + 1, "instagram", days),
      aged(index + 11, "linkedin", days),
    ]);
    const run = setup({
      posts,
      answers: {
        ...Object.fromEntries(
          ages.map((_, index) => [
            `GET ${GRAPH}/instagram-${String(index + 1)}/insights`,
            insights,
          ]),
        ),
        [LINKEDIN_STATS]: answerOf("linkedin", "share-statistics"),
      },
    });
    const social = await dailyRun(run);
    const calls = run.platform.calls();
    expect(calls.filter((call) => call.endsWith("/insights")).sort()).toEqual(
      [1, 3, 4, 5, 6].map((n) => `GET ${GRAPH}/instagram-${String(n)}/insights`).sort(),
    );
    expect(calls.filter((call) => call === LINKEDIN_STATS)).toHaveLength(5);
    expect(social["metrics"]).toBe(10);
    expect(run.metrics).toHaveLength(10);
  });

  it("fetches X posts only on the days of settings.x.metrics_days", async () => {
    const run = setup({
      posts: [aged(1, "x", 1), aged(2, "x", 7)],
      answers: { "GET https://api.x.com/2/tweets/x-2": answerOf("x", "tweet-metrics") },
    });
    const social = await dailyRun(run);
    expect(run.platform.calls().filter((call) => call.includes("/2/tweets/"))).toEqual([
      "GET https://api.x.com/2/tweets/x-2",
    ]);
    expect(social["metrics"]).toBe(1);
  });

  it("makes no X metric fetch while metrics_days is empty", async () => {
    const run = setup({
      x: { ...X_SETTINGS, metrics_days: [] },
      posts: [aged(1, "x", 7), aged(2, "x", 28)],
    });
    const social = await dailyRun(run);
    expect(run.platform.calls().filter((call) => call.includes("/2/tweets/"))).toEqual([]);
    expect(social).toMatchObject({ metrics: 0, skipped_budget: 0 });
  });

  it("makes no X metric fetch at the read budget and records skipped_budget", async () => {
    const run = setup({
      x: { ...X_SETTINGS, usage: { month: "2026-10", reads: 90 } },
      posts: [aged(1, "x", 7)],
    });
    const social = await dailyRun(run);
    expect(run.platform.calls().filter((call) => call.includes("/2/tweets/"))).toEqual([]);
    expect(social).toMatchObject({ metrics: 0, skipped_budget: 1 });
  });

  it("counts one platform error and still fetches the other posts", async () => {
    const run = setup({
      posts: [aged(1, "instagram", 1), aged(2, "instagram", 3)],
      answers: {
        [`GET ${GRAPH}/instagram-1/insights`]: new Answer(
          { error: { message: "Please try again later", code: 2 } },
          500,
        ),
        [`GET ${GRAPH}/instagram-2/insights`]: insights,
      },
    });
    const social = await dailyRun(run);
    expect(social["metrics"]).toBe(1);
    expect(social["errors"]).toEqual([expect.stringContaining(uuid(1))]);
    expect(run.metrics.map((row) => row["p_id"])).toEqual([uuid(2)]);
  });

  it("asks nothing of a withdrawn post and still completes the day", async () => {
    const withdrawn = { ...aged(1, "x", 7), withdrawn_at: ago(DAY_MS) };
    const run = setup({
      posts: [withdrawn, aged(2, "instagram", 1)],
      answers: { [`GET ${GRAPH}/instagram-2/insights`]: insights },
    });
    const social = await dailyRun(run);
    expect(run.platform.calls().filter((call) => call.includes("/2/tweets/"))).toEqual([]);
    expect(social).toMatchObject({ metrics: 1, completed: 3, errors: [] });
  });

  it("counts a tweet X no longer answers for as one platform error and still completes the day", async () => {
    const gone = new Answer({
      errors: [
        { title: "Not Found Error", type: "https://api.twitter.com/2/problems/resource-not-found" },
      ],
    });
    const run = setup({
      posts: [aged(1, "x", 7), aged(2, "instagram", 1)],
      answers: {
        "GET https://api.x.com/2/tweets/x-1": gone,
        [`GET ${GRAPH}/instagram-2/insights`]: insights,
      },
    });
    const social = await dailyRun(run);
    expect(social).toMatchObject({ metrics: 1, completed: 3 });
    expect(social["errors"]).toEqual([expect.stringContaining(uuid(1))]);
    expect(run.rpcs("complete_distributed_submissions")).toHaveLength(1);
  });

  it("counts a platform that does not answer as one platform error and goes on", async () => {
    const run = setup({
      posts: [aged(1, "x", 7), aged(2, "instagram", 1)],
      answers: { [`GET ${GRAPH}/instagram-2/insights`]: insights },
    });
    const social = await dailyRun(run);
    expect(social).toMatchObject({ metrics: 1, completed: 3 });
    expect(social["errors"]).toEqual([expect.stringContaining("X did not answer")]);
  });

  it("throws on a database error, so the job is retried", async () => {
    const run = setup({
      posts: [aged(1, "instagram", 1)],
      answers: { [`GET ${GRAPH}/instagram-1/insights`]: insights },
      handlers: { set_social_post_metrics: () => new Error("db down") },
    });
    await expect(dailyRun(run)).rejects.toThrow("The database did not answer");
  });

  it("throws when the token check cannot record, so the check day is not lost", async () => {
    const run = setup({ handlers: { record_channel_check: () => new Error("db down") } });
    await expect(dailyRun(run)).rejects.toThrow("did not answer (record_channel_check)");
  });

  it("throws when an X read cannot be counted, so the budget does not drift", async () => {
    const run = setup({
      posts: [aged(1, "x", 7)],
      answers: { "GET https://api.x.com/2/tweets/x-1": answerOf("x", "tweet-metrics") },
      handlers: { record_channel_usage: () => new Error("db down") },
    });
    await expect(dailyRun(run)).rejects.toThrow("did not answer (record_channel_usage)");
  });

  it("throws when a stored token cannot be read, so the metrics day is not dropped", async () => {
    const run = setup({
      posts: [aged(1, "linkedin", 1)],
      handlers: {
        get_vault_secret: (args) =>
          args["p_name"] === "linkedin_oauth_token" ? new Error("db down") : vaultSet,
      },
    });
    await expect(dailyRun(run)).rejects.toThrow("did not answer (get_vault_secret)");
  });

  it("makes one complete_distributed_submissions call with its now and stores the count", async () => {
    const run = setup();
    const social = await dailyRun(run);
    expect(run.rpcs("complete_distributed_submissions").map((call) => call.args)).toEqual([
      [{ p_now: NOW.toISOString() }],
    ]);
    expect(social["completed"]).toBe(3);
  });

  it("checks the X and LinkedIn tokens and reads Meta's health without a second debug_token call", async () => {
    const run = setup();
    const social = await dailyRun(run);
    expect(social["tokens"]).toEqual({ meta: "ok", x: "ok", linkedin: "ok" });
    expect(run.platform.calls().sort()).toEqual([
      "GET https://api.linkedin.com/rest/organizationAcls",
      "GET https://api.x.com/2/users/me",
    ]);
  });
});

describe("a marker an hour old or older (INT-01)", () => {
  const marker = (media: string, at = ago(2 * HOUR_MS)) => `inflight:${at}:media:${media}`;
  const lookup = {
    [`GET https://api.x.com/2/users/${X_USER}/tweets`]: answerOf("x", "user-tweets"),
  };

  it("is resolved by the platform's lookup and recorded as posted", async () => {
    const run = setup({
      posts: [
        postRow("x", {
          id: uuid(1),
          scheduled_at: ago(3 * HOUR_MS),
          updated_at: ago(2 * HOUR_MS),
          error: marker("123"),
        }),
      ],
      answers: lookup,
    });
    const social = await dailyRun(run);
    expect(run.rpcs("mark_social_post_posted").map((call) => call.args)).toEqual([
      [
        {
          p_id: uuid(1),
          p_remote_id: "1840000000000000001",
          p_permalink: "https://x.com/mop_test/status/1840000000000000001",
          p_targets: ["instagram"],
        },
      ],
    ]);
    expect(social["markers"]).toEqual({ posted: 1, failed: 0, left: 0 });
    expect(run.platform.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("becomes outcome_unknown when the lookup finds nothing, and nothing is created again", async () => {
    const run = setup({
      posts: [
        postRow("x", {
          id: uuid(1),
          scheduled_at: ago(3 * HOUR_MS),
          updated_at: ago(2 * HOUR_MS),
          error: marker("777"),
        }),
      ],
      answers: lookup,
    });
    const social = await dailyRun(run);
    expect(run.posts.map((post) => [post.status, post.error])).toEqual([
      ["failed", "outcome_unknown"],
    ]);
    expect(run.jobs.map((job) => job.key)).toEqual([`social_failed:${uuid(1)}`]);
    expect(social["markers"]).toEqual({ posted: 0, failed: 1, left: 0 });
    expect(run.platform.calls().some((call) => call.startsWith("POST"))).toBe(false);
  });

  it("becomes outcome_unknown when the X read allowance is spent, since the lookup cannot be made", async () => {
    const run = setup({
      x: { ...X_SETTINGS, usage: { month: "2026-10", reads: 100 } },
      posts: [
        postRow("x", {
          id: uuid(1),
          scheduled_at: ago(3 * HOUR_MS),
          updated_at: ago(2 * HOUR_MS),
          error: marker("123"),
        }),
      ],
    });
    const social = await dailyRun(run);
    expect(run.posts.map((post) => [post.status, post.error])).toEqual([
      ["failed", "outcome_unknown"],
    ]);
    expect(social["markers"]).toEqual({ posted: 0, failed: 1, left: 0 });
    expect(run.platform.calls().filter((call) => call.includes("/2/users/"))).toEqual([
      "GET https://api.x.com/2/users/me",
    ]);
  });

  it("is left alone while it is younger than an hour", async () => {
    const run = setup({
      posts: [
        postRow("x", {
          id: uuid(1),
          scheduled_at: ago(3 * HOUR_MS),
          updated_at: ago(30 * 60_000),
          error: marker("123", ago(30 * 60_000)),
        }),
      ],
    });
    await dailyRun(run);
    expect(run.platform.calls().some((call) => call.includes("/tweets"))).toBe(false);
    expect(run.posts.map((post) => post.status)).toEqual(["scheduled"]);
  });
});

describe("a run with post_ids", () => {
  it("fetches the metrics of those posts only, and enqueues and completes nothing", async () => {
    const run = setup({
      posts: [aged(1, "instagram", 5), aged(2, "instagram", 5), aged(3, "instagram", 5)],
      answers: {
        [`GET ${GRAPH}/instagram-1/insights`]: insights,
        [`GET ${GRAPH}/instagram-3/insights`]: insights,
      },
    });
    const { social } = await reconcileSocial(run.ctx(), { post_ids: [uuid(1), uuid(3)] }, NOW);
    expect(social).toMatchObject({ metrics: 2, skipped_budget: 0, errors: [] });
    expect(run.metrics.map((row) => row["p_id"])).toEqual([uuid(1), uuid(3)]);
    expect(run.jobs).toEqual([]);
    expect(run.rpcs("complete_distributed_submissions")).toEqual([]);
  });
});

describe("the campaign reports (DL-09)", () => {
  const campaign = (id: string, startsOn: string | null, endsOn: string | null): Row => ({
    id,
    property_id: PROPERTY,
    starts_on: startsOn,
    ends_on: endsOn,
  });

  it("builds none for a campaign with no end whose start was 70 days ago, and every week of one that began 40 days ago", async () => {
    const run = setup({
      campaigns: [
        campaign(CAMPAIGN, "2026-07-30", null),
        campaign(OTHER_CAMPAIGN, "2026-08-29", null),
      ],
    });
    const social = await dailyRun(run);
    expect(run.reports.map((row) => [row["p_campaign_id"], row["p_period_start"]])).toEqual(
      ["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21"].map((week) => [
        OTHER_CAMPAIGN,
        week,
      ]),
    );
    expect(social["reports"]).toEqual({ built: 5, not_started: 0 });
  });

  it("starts a campaign with no starts_on at its first posted row, in that ISO week", async () => {
    const run = setup({
      campaigns: [campaign(CAMPAIGN, null, null)],
      posts: [
        postRow("instagram", {
          id: uuid(1),
          status: "posted",
          posted_at: "2026-10-06T14:00:00.000Z",
          remote_id: null,
        }),
      ],
    });
    await dailyRun(run);
    expect(run.reports.map((row) => row["p_period_start"])).toEqual(["2026-10-05"]);
  });

  it("skips a campaign with no starts_on and no posted row as not started", async () => {
    const run = setup({ campaigns: [campaign(CAMPAIGN, null, null)] });
    const social = await dailyRun(run);
    expect(run.reports).toEqual([]);
    expect(social["reports"]).toEqual({ built: 0, not_started: 1 });
  });
});

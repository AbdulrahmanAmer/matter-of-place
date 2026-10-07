// B10 step 6: `postToChannel`, the one body of the three post steps (invariants 2 to 8, INT-01, INT-04, E2E-04). The
// database is the channel world of tests/fixtures/channel-db.ts; most cases post through a stand-in adapter, and the
// cases that name a platform's own answer (an X timeline, a Meta container, a media fetch) use the real adapter with
// fetch stubbed. Nothing here reaches the network (R50).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialChannel } from "../../../src/domain/channels";
import { createMetaChannel, GraphError } from "../../../src/server/channels/meta";
import { ChannelApiError } from "../../../src/server/channels/oauth-tokens";
import { notifyAdmin, postToChannel } from "../../../src/server/channels/post-to-channel";
import type { SocialAsset } from "../../../src/server/channels/types";
import { createXChannel } from "../../../src/server/channels/x";
import type { StepContext } from "../../../src/server/jobs/types";
import { context } from "../../fixtures/asset-rows";
import {
  AGENT,
  ASSET,
  channelWorld,
  POST,
  POSTED_AT,
  postRow,
  PROPERTY,
  type WorldOptions,
} from "../../fixtures/channel-db";
import type { FakeDb } from "../../fixtures/fake-db";
import { Answer, answerOf, requestOf, stubPlatform } from "../../fixtures/social-api";

// Tuesday 10:00 in New York: inside the seeded window.
const NOW = new Date("2026-10-06T14:00:00.000Z");
const LIVE = { respectWindow: true, force: false };
const CONTAINER = "container:17889455560051444";
const MEDIA_BASE = "https://matterofplace.com/media";
const COVER_KEY = "o/oak-hill/cover-x.webp";
const IG_USER = "17841400000000001";
const GRAPH = "https://graph.facebook.com/v23.0";
const X_USER = "1700000000000000001";
const TIMELINE = `GET https://api.x.com/2/users/${X_USER}/tweets`;
const X_SETTINGS = {
  key: "x",
  value: {
    user_id: X_USER,
    handle: "mop_test",
    read_allowance: 100,
    usage: { month: "2026-10", reads: 10 },
  },
};
const X_TOKEN = JSON.stringify({
  access_token: "x-access-held",
  refresh_token: "x-refresh-held",
  expires_at: "2026-12-01T00:00:00.000Z",
});
const X_FILES = [{ media_key: COVER_KEY, w: 1200, h: 675, bytes: 7, role: "x" }];
const PLATFORMS = /graph\.facebook\.com|api\.x\.com|api\.linkedin\.com/;

function ctxOf(db: FakeDb, now = NOW): StepContext {
  return { ...context(db, "post_meta"), now, env: { META_APP_SECRET: "test-app-secret" } };
}

type Publish = (
  asset: SocialAsset,
  ctx: StepContext,
  onMarker?: (marker: string) => Promise<void>,
) => Promise<
  | { status: "posted"; remoteId: string; permalink: string }
  | { status: "in_progress"; containerId: string }
  | { status: "skipped_disabled" }
>;
type Find = (
  marker: string,
  since: Date,
  ctx: StepContext,
) => Promise<
  | { status: "posted"; remoteId: string; permalink: string }
  | { status: "in_progress"; containerId: string }
  | { status: "restart" }
  | { status: "not_found" }
  | { status: "skipped_budget" }
>;

const posted = {
  status: "posted",
  remoteId: "remote-1",
  permalink: "https://example.test/p/1",
} as const;

/** A stand-in adapter: `publish` hands over `marker` before it "creates" the post, and counts the creates. */
function adapter(
  id: SocialChannel,
  publish?: Publish,
  find: Find = () => Promise.resolve({ status: "not_found" }),
) {
  const creates: string[] = [];
  const marker = id === "instagram" ? CONTAINER : "inflight:2026-10-06T14:00:00.000Z:media:123";
  const fallback: Publish = async (_asset, _ctx, onMarker) => {
    await onMarker?.(marker);
    creates.push(marker);
    return posted;
  };
  const publishSpy = vi.fn(publish ?? fallback);
  const findSpy = vi.fn(find);
  return { id, publish: publishSpy, findRecentPost: findSpy, creates };
}

function world(options: WorldOptions = {}) {
  return channelWorld(options);
}

const notices = (jobs: { type: string; key: string }[]) =>
  jobs.filter((job) => job.type === "notify_admin").map((job) => job.key);

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
  vi.stubEnv("META_PAGE_TOKEN", "EAAtest-page-token");
  vi.stubEnv("SENTRY_DSN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("what decides before any platform call", () => {
  it("an asset approved by an agent while the channel is manual fails human_approval_required with no fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { db, posts } = world({ approvedBy: AGENT });
    const meta = adapter("instagram");
    const result = await postToChannel(ctxOf(db), meta, ASSET, LIVE);
    expect(result).toEqual({
      status: "done",
      result: { result: "failed", error: "human_approval_required" },
    });
    expect(posts[0]).toMatchObject({ status: "failed", error: "human_approval_required" });
    expect(meta.publish).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("an agent's approval stands while the channel is auto for the tier", async () => {
    const { db } = world({
      approvedBy: AGENT,
      approvalMode: { Feature: "auto", Reach: "manual", Campaign: "manual" },
      autoAfter: "2026-10-01",
    });
    const meta = adapter("instagram");
    expect((await postToChannel(ctxOf(db), meta, ASSET, LIVE)).status).toBe("done");
    expect(meta.creates).toHaveLength(1);
  });

  it("an unpublished property fails the row with property_unpublished and no fetch", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { db, posts } = world({ editorialState: "archived" });
    const meta = adapter("instagram");
    await postToChannel(ctxOf(db), meta, ASSET, LIVE);
    expect(posts[0]).toMatchObject({ status: "failed", error: "property_unpublished" });
    expect(meta.publish).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a second revision of a posted kind fails revision_already_posted, and posts with force", async () => {
    const OLD = "3f2a9c1d-0000-4000-8000-0000000000d1";
    const options: WorldOptions = {
      assets: [{ id: OLD, property_id: PROPERTY, kind: "carousel" }],
      posts: [postRow("instagram", { id: "old-post", asset_id: OLD, status: "posted" })],
    };
    const first = world(options);
    const refused = adapter("instagram");
    await postToChannel(ctxOf(first.db), refused, ASSET, LIVE);
    expect(first.posts.find((row) => row.asset_id === ASSET)).toMatchObject({
      status: "failed",
      error: "revision_already_posted",
    });
    expect(refused.publish).not.toHaveBeenCalled();
    const second = world(options);
    const forced = adapter("instagram");
    await postToChannel(ctxOf(second.db), forced, ASSET, { respectWindow: true, force: true });
    expect(forced.creates).toHaveLength(1);
  });

  it("a cancelled row ends skipped: cancelled", async () => {
    const { db } = world({
      posts: [postRow("instagram", { status: "failed", error: "cancelled" })],
    });
    const meta = adapter("instagram");
    expect(await postToChannel(ctxOf(db), meta, ASSET, LIVE)).toEqual({
      status: "done",
      result: { skipped: "cancelled" },
    });
    expect(meta.publish).not.toHaveBeenCalled();
  });

  it("a newsletter_block returns skipped_kind and writes no row", async () => {
    const { db, posts } = world({ kind: "newsletter_block" });
    expect(await postToChannel(ctxOf(db), adapter("instagram"), ASSET, LIVE)).toEqual({
      status: "done",
      result: "skipped_kind",
    });
    expect(posts).toEqual([]);
  });

  it("a disabled channel returns skipped_disabled and writes no row", async () => {
    const { db, posts } = world({ kind: "cover", enabled: { facebook: false } });
    expect(await postToChannel(ctxOf(db), adapter("facebook"), ASSET, LIVE)).toEqual({
      status: "done",
      result: "skipped_disabled",
    });
    expect(posts).toEqual([]);
  });

  it("outside the window waits for the next slot; respect_window false posts at once", async () => {
    // Tuesday 08:00 in New York, an hour before the window opens.
    const early = new Date("2026-10-06T12:00:00.000Z");
    const waiting = world();
    expect(
      await postToChannel(ctxOf(waiting.db, early), adapter("instagram"), ASSET, LIVE),
    ).toEqual({
      status: "retry_at",
      at: new Date("2026-10-06T13:00:00.000Z"),
      reason: "outside_window",
    });
    const now = world();
    const meta = adapter("instagram");
    await postToChannel(ctxOf(now.db, early), meta, ASSET, { respectWindow: false, force: false });
    expect(meta.creates).toHaveLength(1);
  });

  it("respect_window false still keeps the daily cap", async () => {
    const early = new Date("2026-10-06T12:00:00.000Z");
    const today = (id: string) =>
      postRow("instagram", {
        id,
        asset_id: id,
        status: "posted",
        posted_at: "2026-10-06T11:00:00.000Z",
      });
    const { db } = world({ posts: [today("a"), today("b")] });
    const meta = adapter("instagram");
    const result = await postToChannel(ctxOf(db, early), meta, ASSET, {
      respectWindow: false,
      force: false,
    });
    expect(result).toEqual({
      status: "retry_at",
      at: new Date("2026-10-07T13:00:00.000Z"),
      reason: "outside_window",
    });
    expect(meta.publish).not.toHaveBeenCalled();
  });
});

describe("in-flight markers (INT-01)", () => {
  it("adopts the post an older inflight marker left behind, with no publish call", async () => {
    const marker = "inflight:2026-10-06T13:50:00.000Z:media:123";
    const { db, posts } = world({ kind: "cover", posts: [postRow("x", { error: marker })] });
    const x = adapter("x", undefined, () => Promise.resolve(posted));
    const result = await postToChannel(ctxOf(db), x, ASSET, LIVE);
    expect(result).toEqual({
      status: "done",
      result: { result: "posted", remote_id: "remote-1", permalink: "https://example.test/p/1" },
    });
    expect(x.findRecentPost).toHaveBeenCalledWith(
      marker,
      new Date("2026-10-06T13:55:00.000Z"),
      expect.anything(),
    );
    expect(x.publish).not.toHaveBeenCalled();
    expect(posts[0]).toMatchObject({ status: "posted", remote_id: "remote-1" });
  });

  it("adopts the X tweet holding the stored media key and a t.co link, with zero create calls", async () => {
    const api = stubPlatform({ [TIMELINE]: answerOf("x", "user-tweets") });
    const { db, posts } = world({
      kind: "cover",
      files: X_FILES,
      settings: [{ key: "linkedin", value: {} }, X_SETTINGS],
      posts: [postRow("x", { error: "inflight:2026-10-06T13:50:00.000Z:media:123" })],
      handlers: { get_vault_secret: () => X_TOKEN },
    });
    await postToChannel(ctxOf(db), createXChannel(), ASSET, LIVE);
    expect(api.calls()).toEqual([TIMELINE]);
    expect(posts[0]).toMatchObject({
      status: "posted",
      remote_id: "1840000000000000001",
      permalink: "https://x.com/mop_test/status/1840000000000000001",
    });
  });

  it.each([
    [
      "a 429",
      () =>
        Promise.reject(
          new ChannelApiError({
            class: "retry_at",
            status: 429,
            reason: null,
            retryAt: null,
            message: "Too Many Requests",
          }),
        ),
    ],
    [
      "an error",
      () =>
        Promise.reject(
          new ChannelApiError({
            class: "retryable",
            status: 503,
            reason: null,
            retryAt: null,
            message: "Service Unavailable",
          }),
        ),
    ],
    ["nothing", () => Promise.resolve({ status: "not_found" } as const)],
  ])(
    "a marker whose lookup returns %s fails outcome_unknown, alerts once and creates nothing",
    async (_label, find: Find) => {
      const { db, posts, jobs } = world({
        kind: "cover",
        posts: [postRow("x", { error: "inflight:2026-10-06T13:50:00.000Z:media:123" })],
      });
      const x = adapter("x", undefined, find);
      await postToChannel(ctxOf(db), x, ASSET, LIVE);
      expect(posts[0]).toMatchObject({ status: "failed", error: "outcome_unknown" });
      expect(notices(jobs)).toEqual([`social_failed:${POST}`]);
      expect(x.publish).not.toHaveBeenCalled();
    },
  );

  it("a marker younger than 2 minutes waits in_flight_elsewhere and calls nothing", async () => {
    const { db } = world({
      kind: "cover",
      posts: [postRow("x", { error: "inflight:2026-10-06T13:59:00.000Z:media:123" })],
    });
    const x = adapter("x");
    expect(await postToChannel(ctxOf(db), x, ASSET, LIVE)).toEqual({
      status: "retry_at",
      at: new Date("2026-10-06T14:02:00.000Z"),
      reason: "in_flight_elsewhere",
    });
    expect(x.findRecentPost).not.toHaveBeenCalled();
    expect(x.publish).not.toHaveBeenCalled();
  });

  it("two concurrent runs on one row make one create call, the loser waits in_flight_elsewhere", async () => {
    const { db } = world({ kind: "cover" });
    const x = adapter("x");
    const results = await Promise.all([
      postToChannel(ctxOf(db), x, ASSET, LIVE),
      postToChannel(ctxOf(db), x, ASSET, LIVE),
    ]);
    expect(x.creates).toHaveLength(1);
    expect(results.map((result) => result.status).sort()).toEqual(["done", "retry_at"]);
    expect(results.find((result) => result.status === "retry_at")).toMatchObject({
      reason: "in_flight_elsewhere",
    });
  });

  it("adopts the Meta media of a PUBLISHED container with no media_publish call", async () => {
    const api = stubPlatform({
      [`GET ${GRAPH}/17889455560051444`]: new Answer({
        status_code: "PUBLISHED",
        id: "17889455560051444",
      }),
      [`GET ${GRAPH}/${IG_USER}/media`]: new Answer({
        data: [
          {
            caption: "Oak Hill, Larchmont.",
            timestamp: "2026-10-06T13:58:12+0000",
            permalink: "https://www.instagram.com/p/EXAMPLE1/",
            id: "17895695668004550",
          },
        ],
      }),
    });
    const { db, posts } = world({
      settings: [
        { key: "linkedin", value: {} },
        {
          key: "meta",
          value: { page_id: "100000000000001", ig_user_id: IG_USER, graph_version: "v23.0" },
        },
      ],
      posts: [postRow("instagram", { error: CONTAINER })],
    });
    await postToChannel(ctxOf(db), createMetaChannel("instagram"), ASSET, LIVE);
    expect(api.calls().some((call) => call.endsWith("/media_publish"))).toBe(false);
    expect(posts[0]).toMatchObject({ status: "posted", remote_id: "17895695668004550" });
  });

  it("a container in progress waits 2 minutes and keeps its marker; FINISHED next run publishes it, creating none", async () => {
    const { db, posts } = world();
    const first = adapter("instagram", async (_asset, _ctx, onMarker) => {
      await onMarker?.(CONTAINER);
      return { status: "in_progress", containerId: "17889455560051444" };
    });
    expect(await postToChannel(ctxOf(db), first, ASSET, LIVE)).toEqual({
      status: "retry_at",
      at: new Date("2026-10-06T14:02:00.000Z"),
      reason: "container_in_progress",
    });
    expect(posts[0]?.error).toBe(CONTAINER);
    const second = adapter("instagram", undefined, () => Promise.resolve(posted));
    await postToChannel(ctxOf(db, new Date("2026-10-06T14:02:00.000Z")), second, ASSET, LIVE);
    expect(second.findRecentPost).toHaveBeenCalledTimes(1);
    expect(second.publish).not.toHaveBeenCalled();
    expect(posts[0]).toMatchObject({ status: "posted" });
  });

  it("an EXPIRED container clears the marker and creates one new container", async () => {
    const { db, posts } = world({ posts: [postRow("instagram", { error: CONTAINER })] });
    const meta = adapter("instagram", undefined, () => Promise.resolve({ status: "restart" }));
    await postToChannel(ctxOf(db), meta, ASSET, LIVE);
    expect(meta.creates).toHaveLength(1);
    expect(posts[0]).toMatchObject({ status: "posted" });
  });

  it("a container still IN_PROGRESS 61 minutes after scheduled_at fails container_timeout and alerts once", async () => {
    const { db, posts, jobs } = world({ posts: [postRow("instagram", { error: CONTAINER })] });
    const meta = adapter("instagram", undefined, () =>
      Promise.resolve({ status: "in_progress", containerId: "17889455560051444" }),
    );
    await postToChannel(ctxOf(db, new Date("2026-10-06T14:56:00.000Z")), meta, ASSET, LIVE);
    expect(posts[0]).toMatchObject({ status: "failed", error: "container_timeout" });
    expect(notices(jobs)).toEqual([`social_failed:${POST}`]);
  });
});

describe("the platform's answers", () => {
  it("an X media fetch that answers 503 throws, keeps the row scheduled with no marker and creates nothing", async () => {
    const api = stubPlatform({
      [`GET ${MEDIA_BASE}/${COVER_KEY}`]: new Answer(undefined, 503),
      [requestOf("x", "media-upload")]: answerOf("x", "media-upload"),
      [requestOf("x", "tweet-create")]: answerOf("x", "tweet-create"),
    });
    const { db, posts } = world({
      kind: "cover",
      files: X_FILES,
      settings: [{ key: "linkedin", value: {} }, X_SETTINGS],
      handlers: { get_vault_secret: () => X_TOKEN },
    });
    await expect(postToChannel(ctxOf(db), createXChannel(), ASSET, LIVE)).rejects.toMatchObject({
      code: "storage_unavailable",
    });
    expect(posts[0]).toMatchObject({ status: "scheduled", error: null });
    expect(api.calls()).toEqual([`GET ${MEDIA_BASE}/${COVER_KEY}`]);
  });

  it("on development without SOCIAL_LIVE logs the payload and reaches no platform; SOCIAL_LIVE=1 posts", async () => {
    vi.stubEnv("MOP_ENV", "development");
    const api = stubPlatform({
      [`GET ${MEDIA_BASE}/${COVER_KEY}`]: new Answer(new Uint8Array([1, 2, 3])),
      [requestOf("x", "media-upload")]: answerOf("x", "media-upload"),
      [requestOf("x", "tweet-create")]: answerOf("x", "tweet-create"),
    });
    const options: WorldOptions = {
      kind: "cover",
      files: X_FILES,
      settings: [{ key: "linkedin", value: {} }, X_SETTINGS],
      handlers: { get_vault_secret: () => X_TOKEN },
    };
    const dry = world(options);
    const log = vi.fn();
    const result = await postToChannel({ ...ctxOf(dry.db), log }, createXChannel(), ASSET, LIVE);
    expect(result).toEqual({ status: "done", result: { result: "dry_run" } });
    expect(log).toHaveBeenCalledWith(
      "info",
      "social_dry_run",
      expect.objectContaining({ channel: "x" }),
    );
    expect(api.sent.filter((request) => PLATFORMS.test(request.url.host))).toEqual([]);
    vi.stubEnv("SOCIAL_LIVE", "1");
    const live = world(options);
    await postToChannel(ctxOf(live.db), createXChannel(), ASSET, LIVE);
    expect(live.posts[0]).toMatchObject({ status: "posted", remote_id: "1840000000000000001" });
  });

  it("a posted story enqueues one reconcile job 20 hours after posted_at", async () => {
    const { db, jobs } = world({
      kind: "story",
      files: [
        { media_key: "assets/p/story/r1/story.jpg", w: 1080, h: 1920, bytes: 1, role: "main" },
      ],
    });
    await postToChannel(ctxOf(db), adapter("instagram"), ASSET, LIVE);
    expect(jobs.filter((job) => job.type === "reconcile")).toEqual([
      {
        type: "reconcile",
        key: `reconcile_story:${POST}`,
        payload: { params: { post_ids: [POST] }, data: {} },
        runAfter: new Date(Date.parse(POSTED_AT) + 20 * 3_600_000).toISOString(),
      },
    ]);
  });

  it("a Graph code 190 writes token_dead and alerts once a day to reconnect Instagram", async () => {
    const { db, posts, jobs } = world();
    const meta = adapter("instagram", () =>
      Promise.reject(
        new GraphError({
          class: "token_dead",
          code: 190,
          subcode: null,
          message: "Invalid OAuth access token.",
        }),
      ),
    );
    expect(await postToChannel(ctxOf(db), meta, ASSET, LIVE)).toEqual({
      status: "done",
      result: { result: "failed", error: "token_dead" },
    });
    expect(posts[0]).toMatchObject({ status: "failed", error: "token_dead" });
    expect(jobs.filter((job) => job.type === "notify_admin")).toEqual([
      {
        type: "notify_admin",
        key: "token_dead:instagram:2026-10-06",
        payload: {
          params: { headline: "Instagram needs to be reconnected" },
          data: {
            summary:
              "The Instagram token was refused (190). Run the authorize script again (docs/runbooks/social.md) or renew the Meta token (docs/runbooks/meta.md).",
            link_path: "/admin/channels",
          },
        },
        runAfter: undefined,
      },
    ]);
  });
});

describe("notifyAdmin (INT-04)", () => {
  it("reports a new alert to Sentry while Resend fails, and a second call for the same key reports nothing", async () => {
    vi.stubEnv("SENTRY_DSN", "https://publickey@o1.ingest.sentry.io/42");
    const api = stubPlatform({
      "POST https://api.resend.com/emails": new Answer({ name: "internal_server_error" }, 500),
      "POST https://o1.ingest.sentry.io/api/42/envelope/": new Answer({ id: "e" }),
    });
    const { db, jobs } = world();
    const alert = () =>
      notifyAdmin(
        db,
        `social_failed:${POST}`,
        "Instagram post failed",
        "Oak Hill, carousel: x",
        "/admin/channels",
      );
    await alert();
    await alert();
    const envelopes = api.sent.filter((request) => request.url.pathname === "/api/42/envelope/");
    expect(envelopes).toHaveLength(1);
    expect(typeof envelopes[0]?.body === "string" ? envelopes[0].body : "").toContain(
      '"fingerprint":["alert","social_failed"]',
    );
    expect(notices(jobs)).toEqual([`social_failed:${POST}`]);
  });
});

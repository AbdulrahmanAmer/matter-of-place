// B10 step 6: the `post_meta` step against a mocked Graph API (invariants 2, 3, 3a, 3b and 5). The database is the
// channel world of tests/fixtures/channel-db.ts; Graph is a fetch stub that answers by request. Nothing here reaches
// the network (R50).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postMeta } from "../../../src/server/jobs/steps/post-meta";
import type { StepContext } from "../../../src/server/jobs/types";
import { context } from "../../fixtures/asset-rows";
import {
  ASSET,
  channelWorld,
  POST,
  postRow,
  PROPERTY,
  type WorldOptions,
} from "../../fixtures/channel-db";
import type { FakeDb } from "../../fixtures/fake-db";
import { Answer, stubPlatform } from "../../fixtures/social-api";

const IG_USER = "17841400000000001";
const GRAPH = "https://graph.facebook.com/v23.0";
const CONTAINER = "17889455560051444";
const MEDIA = "17895695668004550";
const CREATE = `POST ${GRAPH}/${IG_USER}/media`;
const STATUS = `GET ${GRAPH}/${CONTAINER}`;
const PUBLISH = `POST ${GRAPH}/${IG_USER}/media_publish`;
const PERMALINK = `GET ${GRAPH}/${MEDIA}`;
// Tuesday 10:00 in New York, inside the window; 11:59:50 is ten seconds before it closes.
const NOW = new Date("2026-10-06T14:00:00.000Z");
const NEAR_END = new Date("2026-10-06T15:59:50.000Z");
const DATA = {
  asset_id: ASSET,
  property_id: PROPERTY,
  kind: "carousel",
  tier: "Feature",
  market: "new-york",
};
const TEMPORARY = new Answer(
  {
    error: {
      message: "An unexpected error has occurred.",
      type: "OAuthException",
      code: 2,
      is_transient: true,
    },
  },
  500,
);
const TOKEN_DEAD = new Answer(
  { error: { message: "Error validating access token.", type: "OAuthException", code: 190 } },
  400,
);

const happy = () => ({
  [CREATE]: new Answer({ id: CONTAINER }),
  [STATUS]: new Answer({ status_code: "FINISHED", id: CONTAINER }),
  [PUBLISH]: new Answer({ id: MEDIA }),
  [PERMALINK]: new Answer({ permalink: "https://www.instagram.com/p/EXAMPLE1/", id: MEDIA }),
});

function world(options: WorldOptions = {}) {
  return channelWorld({
    settings: [
      { key: "linkedin", value: {} },
      {
        key: "meta",
        value: { page_id: "100000000000001", ig_user_id: IG_USER, graph_version: "v23.0" },
      },
    ],
    ...options,
  });
}

function ctxOf(db: FakeDb, now = NOW, attempts = 0): StepContext {
  return {
    ...context(db, "post_meta", { attempts }),
    now,
    env: { META_APP_SECRET: "test-app-secret" },
  };
}

const run = (ctx: StepContext) => postMeta.run(ctx, postMeta.paramsSchema.parse({}), DATA);

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", "https://matterofplace.com/media");
  vi.stubEnv("META_PAGE_TOKEN", "EAAtest-page-token");
  vi.stubEnv("SENTRY_DSN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("post_meta", () => {
  it("post_meta runs twice without a second outside effect", async () => {
    const api = stubPlatform(happy());
    const { db, posts } = world();
    expect(await run(ctxOf(db))).toEqual({
      status: "done",
      result: {
        instagram: {
          result: "posted",
          remote_id: MEDIA,
          permalink: "https://www.instagram.com/p/EXAMPLE1/",
        },
        facebook: "skipped_kind",
      },
    });
    const calls = api.calls().length;
    await run(ctxOf(db));
    expect(api.calls()).toHaveLength(calls);
    expect(api.calls().filter((call) => call === PUBLISH)).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });

  it("outside the window returns retry_at, so no attempt is used, and calls nothing", async () => {
    const api = stubPlatform(happy());
    const { db } = world();
    const result = await run(ctxOf(db, new Date("2026-10-04T14:00:00.000Z")));
    expect(result).toMatchObject({
      status: "retry_at",
      at: new Date("2026-10-06T13:00:00.000Z"),
      reason: "outside_window",
    });
    expect(api.calls()).toEqual([]);
  });

  it("SOCIAL_DRY_RUN logs the payload and calls nothing", async () => {
    vi.stubEnv("SOCIAL_DRY_RUN", "1");
    const api = stubPlatform(happy());
    const { db } = world();
    const log = vi.fn();
    expect(await run({ ...ctxOf(db), log })).toMatchObject({
      status: "done",
      result: { instagram: { result: "dry_run" } },
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "social_dry_run",
      expect.objectContaining({ channel: "instagram" }),
    );
    expect(api.calls()).toEqual([]);
  });

  it("retries a temporary Graph error inside the window with backoff and posts once", async () => {
    const api = stubPlatform({ ...happy(), [CREATE]: [TEMPORARY, new Answer({ id: CONTAINER })] });
    const { db, posts, audit } = world();
    await expect(run(ctxOf(db))).rejects.toMatchObject({ name: "GraphError" });
    expect(posts[0]).toMatchObject({ status: "scheduled", error: null });
    await run(ctxOf(db, new Date("2026-10-06T14:00:40.000Z"), 1));
    expect(api.calls().filter((call) => call === PUBLISH)).toHaveLength(1);
    expect(posts[0]).toMatchObject({ status: "posted" });
    expect(audit).toEqual([]);
  });

  it("the same error near the window end moves the post to the next slot and keeps the row scheduled", async () => {
    stubPlatform({ ...happy(), [CREATE]: TEMPORARY });
    const { db, posts, audit } = world();
    expect(await run(ctxOf(db, NEAR_END))).toMatchObject({
      status: "retry_at",
      at: new Date("2026-10-07T13:00:00.000Z"),
      reason: "window_moved",
    });
    expect(audit).toEqual([
      {
        action: "channels.reschedule",
        entity_id: POST,
        actor_id: null,
        note: "Instagram answered with a temporary error, moved to Oct 7, 2026, 9:00 AM ET",
      },
    ]);
    expect(posts[0]).toMatchObject({
      status: "scheduled",
      scheduled_at: "2026-10-07T13:00:00.000Z",
    });
  });

  it("the fourth move fails the row and alerts once with the post's link", async () => {
    stubPlatform({ ...happy(), [CREATE]: TEMPORARY });
    const moved = { action: "channels.reschedule", entity_id: POST, actor_id: null };
    const { db, posts, audit, jobs } = world({
      posts: [postRow("instagram")],
      audit: [moved, moved, moved],
    });
    expect(await run(ctxOf(db, NEAR_END))).toMatchObject({
      status: "done",
      result: { instagram: { result: "failed", error: "An unexpected error has occurred." } },
    });
    expect(posts[0]).toMatchObject({
      status: "failed",
      error: "An unexpected error has occurred.",
    });
    expect(audit).toHaveLength(3);
    expect(jobs.filter((job) => job.type === "notify_admin")).toEqual([
      {
        type: "notify_admin",
        key: `social_failed:${POST}`,
        payload: {
          params: { headline: "Instagram post failed" },
          data: {
            summary: "Oak Hill, carousel: An unexpected error has occurred.",
            link_path: `/admin/channels?post=${POST}`,
          },
        },
        runAfter: undefined,
      },
    ]);
  });

  it("a code 190 fails at once without moving", async () => {
    stubPlatform({ ...happy(), [CREATE]: TOKEN_DEAD });
    const { db, posts, audit } = world();
    expect(await run(ctxOf(db, NEAR_END))).toMatchObject({
      status: "done",
      result: { instagram: { result: "failed", error: "token_dead" } },
    });
    expect(posts[0]).toMatchObject({ status: "failed", error: "token_dead" });
    expect(audit).toEqual([]);
  });
});

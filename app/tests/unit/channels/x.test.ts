// B10 step 5a: the X adapter against a mocked X API. The API is a fetch stub that answers from tests/fixtures/x and
// writes down every request; the database is fakeDb with Vault, `settings.x` and the social.sql functions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db/index.ts";
import type { AssetFile, AssetKind } from "../../../src/domain/assets.ts";
import { getChannel } from "../../../src/server/channels/index.ts";
import { ChannelApiError } from "../../../src/server/channels/oauth-tokens.ts";
import type { SocialAsset } from "../../../src/server/channels/types.ts";
import { createXChannel } from "../../../src/server/channels/x.ts";
import { context } from "../../fixtures/asset-rows";
import {
  Answer,
  answerOf,
  platformFixture,
  requestOf,
  rpcArgs,
  socialDb,
  stubPlatform,
  type SocialDbOptions,
} from "../../fixtures/social-api";

const MEDIA_BASE = "https://matterofplace.com/media";
const COVER_KEY = "o/oak-hill/cover-x.webp";
const MEDIA = `GET ${MEDIA_BASE}/${COVER_KEY}`;
const UPLOAD = requestOf("x", "media-upload");
const CREATE = requestOf("x", "tweet-create");
const TOKEN = requestOf("x", "token-refresh");
const USER_ID = "1700000000000000001";
const TIMELINE = `GET https://api.x.com/2/users/${USER_ID}/tweets`;
const TWEET_ID = "1840000000000000001";
const METRICS = `GET https://api.x.com/2/tweets/${TWEET_ID}`;
const BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const CAPTION = "Oak Hill, Larchmont. A garden that runs to the creek.";
const HELD = {
  access_token: "x-access-held",
  refresh_token: "x-refresh-held",
  expires_at: "2026-10-04T13:00:00.000Z",
};
const SETTINGS = {
  user_id: USER_ID,
  handle: "mop_test",
  read_allowance: 100,
  usage: { month: "2026-10", reads: 10 },
};
const MARKER = "inflight:2026-10-04T11:50:00.000Z:media:123";

function db(options: SocialDbOptions = {}) {
  return socialDb({ vault: HELD, settings: { key: "x", value: SETTINGS }, ...options });
}

const ctx = (database = db()) => context(database, "post_x");

const coverFile = (role: AssetFile["role"] = "x"): AssetFile => ({
  media_key: COVER_KEY,
  w: 1200,
  h: 675,
  bytes: BYTES.length,
  role,
});

const cover = (overrides: Partial<SocialAsset> = {}): SocialAsset => ({
  kind: "cover",
  files: [coverFile()],
  caption: "The Instagram caption.",
  meta: { captions: { x: CAPTION, linkedin: "The LinkedIn caption." } },
  property_slug: "oak-hill",
  ...overrides,
});

const happy = () => ({
  [MEDIA]: new Answer(BYTES),
  [UPLOAD]: answerOf("x", "media-upload"),
  [CREATE]: answerOf("x", "tweet-create"),
});

const POSTED = {
  status: "posted",
  remoteId: TWEET_ID,
  permalink: `https://x.com/mop_test/status/${TWEET_ID}`,
};

/** The rejection of `promise`: a test that expects a failure reads it instead of catching it. */
async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

const classOf = async (promise: Promise<unknown>) => {
  const error = await failure(promise);
  return error instanceof ChannelApiError ? error.detail : error.message;
};

const jsonBody = (body: unknown): unknown => (typeof body === "string" ? JSON.parse(body) : null);

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
  vi.stubEnv("X_CLIENT_ID", "x-client");
  vi.stubEnv("X_CLIENT_SECRET", "x-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("X publishing", () => {
  it("fetches the cover's bytes, uploads them, then posts the short caption with the media id", async () => {
    const api = stubPlatform(happy());
    expect(await createXChannel().publish(cover(), ctx())).toEqual(POSTED);
    expect(api.calls()).toEqual([MEDIA, UPLOAD, CREATE]);
    const media = api.sent[1]?.body;
    expect(media instanceof FormData ? media.get("media_category") : null).toBe("tweet_image");
    const sent = media instanceof FormData ? media.get("media") : null;
    expect(sent instanceof Blob ? new Uint8Array(await sent.arrayBuffer()) : null).toEqual(BYTES);
    expect(jsonBody(api.sent[2]?.body)).toEqual({ text: CAPTION, media: { media_ids: ["123"] } });
    expect(api.sent.slice(1).map((request) => request.headers.get("authorization"))).toEqual([
      "Bearer x-access-held",
      "Bearer x-access-held",
    ]);
  });

  it("hands over the media marker after the upload and before the post is created", async () => {
    const api = stubPlatform(happy());
    const seen: { marker: string; calls: string[] }[] = [];
    await createXChannel().publish(cover(), ctx(), (marker) => {
      seen.push({ marker, calls: api.calls() });
      return Promise.resolve();
    });
    expect(seen).toEqual([
      { marker: "inflight:2026-10-04T12:00:00.000Z:media:123", calls: [MEDIA, UPLOAD] },
    ]);
  });

  it("throws naming the key and the status when the file answers 503, and uploads and posts nothing", async () => {
    const api = stubPlatform({ ...happy(), [MEDIA]: new Answer(undefined, 503) });
    const error = await failure(createXChannel().publish(cover(), ctx()));
    expect(error.message).toBe(`The file ${COVER_KEY} answered 503.`);
    expect(api.calls()).toEqual([MEDIA]);
  });

  it("refreshes an expired token before the upload", async () => {
    const database = db({ vault: { ...HELD, expires_at: "2026-10-04T12:05:00.000Z" } });
    const api = stubPlatform({ ...happy(), [TOKEN]: answerOf("x", "token-refresh") });
    expect(await createXChannel().publish(cover(), ctx(database))).toEqual(POSTED);
    expect(api.calls()).toEqual([MEDIA, TOKEN, UPLOAD, CREATE]);
    expect(api.sent[2]?.headers.get("authorization")).toBe("Bearer x-access-fresh");
    expect(rpcArgs(database, "store_channel_token")).toHaveLength(1);
  });

  it("refreshes once on a 401 and sends the call again", async () => {
    const database = db();
    const api = stubPlatform({
      ...happy(),
      [UPLOAD]: [new Answer({ title: "Unauthorized" }, 401), answerOf("x", "media-upload")],
      [TOKEN]: answerOf("x", "token-refresh"),
    });
    expect(await createXChannel().publish(cover(), ctx(database))).toEqual(POSTED);
    expect(api.calls()).toEqual([MEDIA, UPLOAD, TOKEN, UPLOAD, CREATE]);
    expect(rpcArgs(database, "record_channel_check")).toEqual([]);
  });

  it("records the token dead on a 401 after a refresh and throws token_dead", async () => {
    const database = db();
    stubPlatform({
      ...happy(),
      [UPLOAD]: new Answer({ title: "Unauthorized" }, 401),
      [TOKEN]: answerOf("x", "token-refresh"),
    });
    expect(await classOf(createXChannel().publish(cover(), ctx(database)))).toMatchObject({
      class: "token_dead",
      status: 401,
    });
    expect(rpcArgs(database, "record_channel_check")).toEqual([
      {
        p_channel: "x",
        p_expires_at: null,
        p_checked_at: "2026-10-04T12:00:00.000Z",
        p_state: "dead",
      },
    ]);
  });

  it("maps a 429 on the post to retry_at at X's latest reset time", async () => {
    stubPlatform({ ...happy(), [CREATE]: answerOf("x", "rate-limited") });
    expect(await classOf(createXChannel().publish(cover(), ctx()))).toMatchObject({
      class: "retry_at",
      retryAt: new Date("2026-10-04T18:00:00.000Z"),
    });
  });

  it("makes no write call when MOP_ENV is not production", async () => {
    vi.stubEnv("MOP_ENV", "development");
    const api = stubPlatform(happy());
    const error = await failure(createXChannel().publish(cover(), ctx()));
    expect(error.message).toBe("Posting is switched off here: no write call was made.");
    expect(api.calls().filter((call) => call.startsWith("POST"))).toEqual([]);
  });

  it("posts a cover only, and the registry hands it out for an enabled row", async () => {
    stubPlatform({});
    const x = createXChannel();
    const kinds: AssetKind[] = ["cover", "carousel", "story", "reel"];
    expect(kinds.map((kind) => x.supports(kind))).toEqual([true, false, false, false]);
    expect((await failure(x.publish(cover({ kind: "story" }), ctx()))).message).toBe(
      "x does not post a story.",
    );
    expect(getChannel("x", true).id).toBe("x");
  });
});

describe("X findRecentPost", () => {
  const timeline = () => ({ [TIMELINE]: answerOf("x", "user-tweets") });

  it("adopts the post whose media keys hold 3_<media_id>, whatever its t.co text", async () => {
    const api = stubPlatform(timeline());
    const since = new Date("2026-10-04T11:00:00.000Z");
    expect(await createXChannel().findRecentPost(MARKER, since, ctx())).toEqual(POSTED);
    expect(api.calls()).toEqual([TIMELINE]);
    expect(Object.fromEntries(api.sent[0]?.url.searchParams ?? [])).toEqual({
      start_time: "2026-10-04T11:00:00Z",
      expansions: "attachments.media_keys",
    });
    const text = z
      .object({ data: z.array(z.object({ text: z.string() })) })
      .parse(platformFixture("x", "user-tweets").response).data[0]?.text;
    expect(text).toContain("https://t.co/");
    expect(text).not.toBe(CAPTION);
  });

  it("adopts nothing when no post holds the media key", async () => {
    stubPlatform(timeline());
    const marker = MARKER.replace(":media:123", ":media:124");
    expect(await createXChannel().findRecentPost(marker, new Date(0), ctx())).toEqual({
      status: "not_found",
    });
  });

  it("counts the lookup as one read", async () => {
    stubPlatform(timeline());
    const database = db();
    await createXChannel().findRecentPost(MARKER, new Date(0), ctx(database));
    expect(rpcArgs(database, "record_channel_usage")).toEqual([{ p_channel: "x", p_reads: 1 }]);
  });

  it("still runs at 90 percent of the allowance, and stops with skipped_budget once it is spent", async () => {
    const at = (reads: number) =>
      db({ settings: { key: "x", value: { ...SETTINGS, usage: { month: "2026-10", reads } } } });
    const api = stubPlatform(timeline());
    expect(await createXChannel().findRecentPost(MARKER, new Date(0), ctx(at(90)))).toEqual(POSTED);
    expect(await createXChannel().findRecentPost(MARKER, new Date(0), ctx(at(100)))).toEqual({
      status: "skipped_budget",
    });
    expect(api.calls()).toEqual([TIMELINE]);
  });
});

describe("X metrics", () => {
  const settingsWith = (value: NonNullable<Json>) => db({ settings: { key: "x", value } });

  it("maps public_metrics to views, likes, shares and comments, and leaves what X did not return null", async () => {
    stubPlatform({ [METRICS]: answerOf("x", "tweet-metrics") });
    const database = db();
    const result = await createXChannel().metrics(
      { remoteId: TWEET_ID, permalink: null },
      ctx(database),
    );
    expect(result).toEqual({
      status: "fetched",
      metrics: {
        reach: null,
        views: null,
        saves: null,
        shares: 2,
        likes: 9,
        comments: 1,
        clicks: null,
        fetched_at: "2026-10-04T12:00:00.000Z",
        raw: platformFixture("x", "tweet-metrics").response,
      },
    });
    expect(rpcArgs(database, "record_channel_usage")).toEqual([{ p_channel: "x", p_reads: 1 }]);
  });

  it("answers skipped_budget with no fetch at 90 percent of the allowance", async () => {
    const api = stubPlatform({ [METRICS]: answerOf("x", "tweet-metrics") });
    const database = settingsWith({ ...SETTINGS, usage: { month: "2026-10", reads: 90 } });
    expect(
      await createXChannel().metrics({ remoteId: TWEET_ID, permalink: null }, ctx(database)),
    ).toEqual({ status: "skipped_budget" });
    expect(api.spy).not.toHaveBeenCalled();
  });

  it("counts last month's reads as none, and an allowance not measured yet as 0", async () => {
    const api = stubPlatform({ [METRICS]: answerOf("x", "tweet-metrics") });
    const lastMonth = settingsWith({ ...SETTINGS, usage: { month: "2026-09", reads: 99 } });
    const unmeasured = settingsWith({ user_id: USER_ID, handle: "mop_test" });
    const post = { remoteId: TWEET_ID, permalink: null };
    expect((await createXChannel().metrics(post, ctx(lastMonth))).status).toBe("fetched");
    expect(await createXChannel().metrics(post, ctx(unmeasured))).toEqual({
      status: "skipped_budget",
    });
    expect(api.calls()).toEqual([METRICS]);
  });
});

describe("X health", () => {
  it("reads the card state from the last daily check: dead is red, a check never made amber", async () => {
    const health = (value: NonNullable<Json>) =>
      createXChannel().health(ctx(db({ settings: { key: "x", value } })));
    expect(await health({ ...SETTINGS, token_state: "dead" })).toEqual({
      state: "red",
      detail: "The token was refused. Run the authorize script again.",
    });
    expect(
      await health({ ...SETTINGS, token_state: "ok", token_checked_at: "2026-10-04T05:00:00Z" }),
    ).toEqual({ state: "ok", detail: "Checked on 2026-10-04." });
    expect(await health(SETTINGS)).toEqual({ state: "amber", detail: "Not checked yet." });
  });
});

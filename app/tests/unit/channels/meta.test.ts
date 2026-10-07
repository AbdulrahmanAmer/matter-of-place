// B10 step 5: the Meta adapter against a mocked Graph API. Graph is a fetch stub that answers from the recorded
// shapes in tests/fixtures/graph and writes down every request it gets; the database is fakeDb with the settings row
// and the Vault read. Nothing here reaches the network (R50).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Json } from "../../../src/db/index.ts";
import type { AssetFile, AssetKind } from "../../../src/domain/assets.ts";
import { captionFor, getChannel } from "../../../src/server/channels/index.ts";
import { createMetaChannel, GraphError } from "../../../src/server/channels/meta.ts";
import { META_METRICS } from "../../../src/server/channels/meta-metrics.ts";
import type { SocialAsset } from "../../../src/server/channels/types.ts";
import { hmacSha256, toHex } from "../../../src/server/lib/crypto.ts";
import { fakeDb } from "../../fixtures/fake-db";
import { assetRow, context, NOW } from "../../fixtures/asset-rows";

const IG_USER = "17841400000000001";
const PAGE = "100000000000001";
const BASE = "https://graph.facebook.com/v23.0";
const TOKEN = "EAAtest-page-token";
const SECRET = "test-app-secret";
const MEDIA_BASE = "https://matterofplace.com/media";
const META = { page_id: PAGE, ig_user_id: IG_USER, graph_version: "v23.0" };

const fixtureFile = z
  .object({
    response: z.unknown().optional(),
    responses: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

function fixture(name: string) {
  const path = new URL(`../../fixtures/graph/${name}.json`, import.meta.url);
  return fixtureFile.parse(JSON.parse(readFileSync(path, "utf8")));
}

const answerOf = (name: string): unknown => fixture(name).response;
const statusOf = (code: string): unknown => fixture("container-status").responses?.[code];
const CONTAINER = z.object({ id: z.string() }).parse(answerOf("container-create")).id;
const MEDIA_ID = z.object({ id: z.string() }).parse(answerOf("media-publish")).id;

/** A Graph answer other than 200. */
class Refused {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    this.status = status;
    this.body = body;
  }
}

interface Sent {
  method: string;
  path: string;
  params: Record<string, string>;
  url: string;
}

/**
 * Answers by `<METHOD> <path>`: a list is taken one answer per call and its last answer repeats, a call nobody
 * registered throws. `sent` holds every request in order.
 */
function stubGraph(answers: Record<string, unknown>) {
  const queues = new Map(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map((item: unknown) => item) : [value],
    ]),
  );
  const sent: Sent[] = [];
  const spy = vi.fn((input: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? "GET";
    const url = new URL(input);
    const body = init.body instanceof URLSearchParams ? init.body : url.searchParams;
    const path = url.pathname.replace(/^\/v23\.0\//, "");
    sent.push({ method, path, params: Object.fromEntries(body), url: input });
    const queue = queues.get(`${method} ${path}`);
    if (queue === undefined) throw new Error(`unexpected ${method} ${path}`);
    const answer: unknown = queue.length > 1 ? queue.shift() : queue[0];
    return Promise.resolve(
      answer instanceof Refused
        ? new Response(JSON.stringify(answer.body), { status: answer.status })
        : new Response(JSON.stringify(answer)),
    );
  });
  vi.stubGlobal("fetch", spy);
  return { sent, spy, calls: () => sent.map((request) => `${request.method} ${request.path}`) };
}

const tick = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

/**
 * Moves the fake clock by one poll interval once the adapter is sleeping on it: the proof's Web Crypto call and the
 * body reads finish on real ticks, so the clock moves only when a timer exists.
 */
async function nextPoll() {
  while (vi.getTimerCount() === 0) await tick();
  await vi.advanceTimersByTimeAsync(5_000);
}

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

function ctx(settings: NonNullable<Json> = META) {
  const db = fakeDb({
    rpc: { get_vault_secret: () => TOKEN },
    tables: {
      settings: [
        {
          key: "meta",
          value: settings,
          updated_at: "2026-10-07T00:00:00Z",
          updated_by: null,
        },
      ],
    },
  });
  return { ...context(db, "post_meta"), env: { META_APP_SECRET: SECRET } };
}

const file = (role: AssetFile["role"], name: string, index?: number): AssetFile => ({
  media_key: name,
  w: 1080,
  h: 1350,
  bytes: 1,
  role,
  ...(index === undefined ? {} : { index }),
});

function asset(overrides: Partial<SocialAsset> = {}): SocialAsset {
  const { kind, files, caption, meta } = assetRow();
  return { kind, files, caption, meta, property_slug: "oak-hill", ...overrides };
}

const slides = (count: number) =>
  Array.from({ length: count }, (_, n) =>
    file("slide", `o/oak-hill/s${String(n + 1)}.webp`, n + 1),
  );
const carousel = (count: number) =>
  asset({ kind: "carousel", files: slides(count), caption: "Oak Hill, Larchmont." });
const story = () =>
  asset({ kind: "story", files: [file("main", "o/oak-hill/story.webp")], caption: "ignored" });
const reel = () =>
  asset({
    kind: "reel",
    files: [file("poster", "o/oak-hill/reel.jpg"), file("video", "o/oak-hill/reel.mp4")],
    caption: "A reel.",
  });
const cover = () =>
  asset({
    kind: "cover",
    files: [file("main", "o/oak-hill/cover.webp")],
    meta: { captions: { linkedin: "Oak Hill, Larchmont." } },
  });

const instagram = () => createMetaChannel("instagram");
const facebook = () => createMetaChannel("facebook");
const media = `POST ${IG_USER}/media`;
const publish = `POST ${IG_USER}/media_publish`;
const status = `GET ${CONTAINER}`;
const permalink = `GET ${MEDIA_ID}`;
const happy = {
  [status]: statusOf("FINISHED"),
  [publish]: answerOf("media-publish"),
  [permalink]: answerOf("media-permalink"),
};
const POSTED = {
  status: "posted",
  remoteId: MEDIA_ID,
  permalink: "https://www.instagram.com/p/EXAMPLE1/",
};

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Instagram publishing", () => {
  it("creates an image container, waits for FINISHED, publishes it and reads the permalink", async () => {
    const graph = stubGraph({ [media]: answerOf("container-create"), ...happy });
    expect(await instagram().publish(carousel(1), ctx())).toEqual(POSTED);
    expect(graph.calls()).toEqual([media, status, publish, permalink]);
    expect(graph.sent[0]?.params).toMatchObject({
      image_url: `${MEDIA_BASE}/o/oak-hill/s1.webp`,
      caption: "Oak Hill, Larchmont.",
    });
    expect(graph.sent[0]?.params["media_type"]).toBeUndefined();
    expect(graph.sent[2]?.params["creation_id"]).toBe(CONTAINER);
    expect(graph.sent[3]?.params["fields"]).toBe("permalink");
  });

  it("creates the children of a carousel, then the parent, then publishes", async () => {
    const graph = stubGraph({
      [media]: [{ id: "c1" }, { id: "c2" }, { id: "c3" }, answerOf("container-create")],
      ...happy,
    });
    expect(await instagram().publish(carousel(3), ctx())).toEqual(POSTED);
    expect(graph.calls()).toEqual([media, media, media, media, status, publish, permalink]);
    expect(graph.sent.slice(0, 3).map((request) => request.params)).toMatchObject([
      { image_url: `${MEDIA_BASE}/o/oak-hill/s1.webp`, is_carousel_item: "true" },
      { image_url: `${MEDIA_BASE}/o/oak-hill/s2.webp`, is_carousel_item: "true" },
      { image_url: `${MEDIA_BASE}/o/oak-hill/s3.webp`, is_carousel_item: "true" },
    ]);
    expect(graph.sent[0]?.params["caption"]).toBeUndefined();
    expect(graph.sent[3]?.params).toMatchObject({
      media_type: "CAROUSEL",
      children: "c1,c2,c3",
      caption: "Oak Hill, Larchmont.",
    });
  });

  it("creates a story container with media_type STORIES, the main image and no caption", async () => {
    const graph = stubGraph({ [media]: answerOf("container-create"), ...happy });
    await instagram().publish(story(), ctx());
    expect(graph.sent[0]?.params).toMatchObject({
      media_type: "STORIES",
      image_url: `${MEDIA_BASE}/o/oak-hill/story.webp`,
    });
    expect(graph.sent[0]?.params["caption"]).toBeUndefined();
  });

  it("creates a reel container with video_url, cover_url and share_to_feed", async () => {
    const graph = stubGraph({ [media]: answerOf("container-create"), ...happy });
    await instagram().publish(reel(), ctx());
    expect(graph.sent[0]?.params).toMatchObject({
      media_type: "REELS",
      video_url: `${MEDIA_BASE}/o/oak-hill/reel.mp4`,
      cover_url: `${MEDIA_BASE}/o/oak-hill/reel.jpg`,
      share_to_feed: "true",
      caption: "A reel.",
    });
  });

  it("hands the container marker to onContainer before the first status call", async () => {
    const graph = stubGraph({ [media]: answerOf("container-create"), ...happy });
    const seen: string[] = [];
    await instagram().publish(story(), ctx(), (marker) => {
      seen.push(marker, ...graph.calls());
      return Promise.resolve();
    });
    expect(seen).toEqual([`container:${CONTAINER}`, media]);
  });
});

describe("the container status", () => {
  it("stops polling at FINISHED after three status calls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const graph = stubGraph({
      [media]: answerOf("container-create"),
      ...happy,
      [status]: [statusOf("IN_PROGRESS"), statusOf("IN_PROGRESS"), statusOf("FINISHED")],
    });
    const posted = instagram().publish(story(), ctx());
    await nextPoll();
    await nextPoll();
    expect(await posted).toEqual(POSTED);
    expect(graph.calls().filter((call) => call === status)).toHaveLength(3);
  });

  it.each(["ERROR", "EXPIRED"])("fails on %s and never calls media_publish", async (code) => {
    const graph = stubGraph({
      [media]: answerOf("container-create"),
      ...happy,
      [status]: statusOf(code),
    });
    await expect(instagram().publish(story(), ctx())).rejects.toMatchObject({
      name: "GraphError",
      detail: { class: "non_retryable" },
    });
    expect(graph.calls()).toEqual([media, status]);
  });

  it("returns in_progress after 5 status calls in 20 seconds and never calls media_publish", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const graph = stubGraph({
      [media]: answerOf("container-create"),
      [status]: statusOf("IN_PROGRESS"),
    });
    const result = instagram().publish(reel(), ctx());
    for (let poll = 0; poll < 3; poll += 1) await nextPoll();
    while (vi.getTimerCount() === 0) await tick();
    expect(graph.calls().filter((call) => call === status)).toHaveLength(4);
    await nextPoll();
    expect(await result).toEqual({ status: "in_progress", containerId: CONTAINER });
    expect(graph.calls().filter((call) => call === status)).toHaveLength(5);
    expect(graph.calls()).not.toContain(publish);
  });
});

describe("findRecentPost with a stored container", () => {
  const marker = `container:${CONTAINER}`;
  const since = new Date("2026-10-07T00:00:00Z");

  it("publishes a FINISHED container once and creates no container", async () => {
    const graph = stubGraph(happy);
    expect(await instagram().findRecentPost(marker, since, ctx())).toEqual(POSTED);
    expect(graph.calls()).toEqual([status, publish, permalink]);
  });

  it("adopts the newest media at or after since for a PUBLISHED container and calls no media_publish", async () => {
    const graph = stubGraph({
      [status]: statusOf("PUBLISHED"),
      [`GET ${IG_USER}/media`]: answerOf("media-list"),
    });
    const newest = {
      status: "posted",
      remoteId: "17895695668004550",
      permalink: "https://www.instagram.com/p/EXAMPLE1/",
    };
    const bothAfter = new Date("2026-10-06T00:00:00Z");
    expect(await instagram().findRecentPost(marker, bothAfter, ctx())).toEqual(newest);
    expect(graph.calls()).toEqual([status, `GET ${IG_USER}/media`]);
    expect(graph.sent[1]?.params["fields"]).toBe("caption,timestamp,permalink");
    const exactly = new Date("2026-10-07T13:00:12Z");
    expect(await instagram().findRecentPost(marker, exactly, ctx())).toEqual(newest);
  });

  it("adopts nothing from a PUBLISHED container when every media is older than since", async () => {
    stubGraph({
      [status]: statusOf("PUBLISHED"),
      [`GET ${IG_USER}/media`]: answerOf("media-list"),
    });
    const later = new Date("2026-10-07T13:00:13Z");
    expect(await instagram().findRecentPost(marker, later, ctx())).toEqual({ status: "not_found" });
  });

  it.each(["ERROR", "EXPIRED"])("answers restart for a container that ended %s", async (code) => {
    const graph = stubGraph({ [status]: statusOf(code) });
    expect(await instagram().findRecentPost(marker, since, ctx())).toEqual({ status: "restart" });
    expect(graph.calls()).toEqual([status]);
  });

  it("answers in_progress for a container that is still processing after 20 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const graph = stubGraph({ [status]: statusOf("IN_PROGRESS") });
    const result = instagram().findRecentPost(marker, since, ctx());
    for (let poll = 0; poll < 4; poll += 1) await nextPoll();
    expect(await result).toEqual({ status: "in_progress", containerId: CONTAINER });
    expect(graph.calls()).toHaveLength(5);
  });

  it("refuses a marker that is not a container marker", async () => {
    const graph = stubGraph({});
    await expect(
      instagram().findRecentPost("inflight:2026-10-07T00:00:00Z:media:1", since, ctx()),
    ).rejects.toMatchObject({ code: "server" });
    expect(graph.spy).not.toHaveBeenCalled();
  });
});

describe("appsecret_proof and the live switch", () => {
  it("puts the token and an appsecret_proof of toHex(hmacSha256(secret, token)) on every call", async () => {
    const graph = stubGraph({
      [media]: [{ id: "c1" }, { id: "c2" }, answerOf("container-create")],
      ...happy,
      [`GET ${MEDIA_ID}/insights`]: answerOf("media-insights"),
      [`GET ${IG_USER}/media`]: answerOf("media-list"),
    });
    const channel = instagram();
    await channel.publish(carousel(2), ctx());
    await channel.metrics({ remoteId: MEDIA_ID, permalink: null }, ctx());
    await channel.findRecentPost(`container:${CONTAINER}`, NOW, ctx());
    const proof = toHex(await hmacSha256(SECRET, TOKEN));
    expect(graph.sent.length).toBeGreaterThanOrEqual(9);
    for (const request of graph.sent) {
      expect(request.params["appsecret_proof"]).toBe(proof);
      expect(request.params["access_token"]).toBe(TOKEN);
      expect(request.url.startsWith(`${BASE}/`)).toBe(true);
    }
  });

  it("keeps the token and the proof out of the url of every write call", async () => {
    const graph = stubGraph({ [media]: answerOf("container-create"), ...happy });
    await instagram().publish(story(), ctx());
    const writes = graph.sent.filter((request) => request.method === "POST");
    expect(writes).toHaveLength(2);
    for (const request of writes) expect(request.url).not.toMatch(/access_token|appsecret_proof/);
  });

  it.each([
    ["SOCIAL_DRY_RUN is 1 in production", () => vi.stubEnv("SOCIAL_DRY_RUN", "1")],
    ["MOP_ENV is not production", () => vi.stubEnv("MOP_ENV", "preview")],
  ])("sends no write call when %s", async (_name, arrange) => {
    arrange();
    const graph = stubGraph({ [media]: answerOf("container-create"), ...happy });
    await expect(instagram().publish(story(), ctx())).rejects.toMatchObject({ code: "server" });
    await expect(facebook().publish(cover(), ctx())).rejects.toMatchObject({ code: "server" });
    expect(graph.spy).not.toHaveBeenCalled();
  });

  it("still reads insights when posting is switched off", async () => {
    vi.stubEnv("SOCIAL_DRY_RUN", "1");
    const graph = stubGraph({ [`GET ${MEDIA_ID}/insights`]: answerOf("media-insights") });
    const result = await instagram().metrics({ remoteId: MEDIA_ID, permalink: null }, ctx());
    expect(result.status).toBe("fetched");
    expect(graph.calls()).toEqual([`GET ${MEDIA_ID}/insights`]);
  });
});

describe("Graph errors", () => {
  it("throws a GraphError that carries the class of the answer", async () => {
    stubGraph({ [media]: new Refused(400, answerOf("error-publish-limit")) });
    const error = await failure(instagram().publish(story(), ctx()));
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ detail: { class: "retry_at", code: 9, subcode: 2207042 } });
    stubGraph({
      [media]: new Refused(400, { error: { message: "Session expired", code: 190 } }),
    });
    await expect(instagram().publish(story(), ctx())).rejects.toMatchObject({
      detail: { class: "token_dead" },
    });
  });

  it("does not quote the url, the token or the proof when the network fails", async () => {
    vi.stubGlobal("fetch", (input: string) =>
      Promise.reject(new Error(`connect failed: ${input}`)),
    );
    const error = await failure(instagram().publish(story(), ctx()));
    expect(error).toMatchObject({ code: "unavailable" });
    expect(error.message).not.toMatch(/graph\.facebook\.com|EAA|appsecret/);
  });

  it("refuses a kind the channel does not post", async () => {
    const graph = stubGraph({});
    await expect(instagram().publish(cover(), ctx())).rejects.toMatchObject({
      code: "invalid_kind",
    });
    await expect(facebook().publish(carousel(2), ctx())).rejects.toMatchObject({
      code: "invalid_kind",
    });
    expect(graph.spy).not.toHaveBeenCalled();
  });

  it("refuses an asset without the file its kind needs before any call", async () => {
    const graph = stubGraph({});
    await expect(
      instagram().publish(asset({ kind: "story", files: [] }), ctx()),
    ).rejects.toMatchObject({
      code: "asset_incomplete",
    });
    await expect(
      instagram().publish(asset({ kind: "reel", files: [] }), ctx()),
    ).rejects.toMatchObject({
      code: "asset_incomplete",
    });
    expect(graph.spy).not.toHaveBeenCalled();
  });

  it("names the settings it needs when settings.meta holds no ids", async () => {
    const graph = stubGraph({});
    const error = await failure(instagram().publish(story(), ctx({ page_id: PAGE })));
    expect(error).toMatchObject({ code: "server" });
    expect(error.message).toContain("ig_user_id");
    expect(graph.spy).not.toHaveBeenCalled();
  });
});

describe("insights, health and supports", () => {
  it("reads insights with the metric names of the table and keeps the answer in raw", async () => {
    const graph = stubGraph({ [`GET ${MEDIA_ID}/insights`]: answerOf("media-insights") });
    const result = await instagram().metrics({ remoteId: MEDIA_ID, permalink: null }, ctx());
    expect(graph.sent[0]?.params["metric"]).toBe(Object.keys(META_METRICS).join(","));
    expect(result).toMatchObject({
      status: "fetched",
      metrics: {
        reach: 4,
        likes: 2,
        views: null,
        fetched_at: NOW.toISOString(),
        raw: answerOf("media-insights"),
      },
    });
  });

  it("reports the token health from settings.meta", async () => {
    const ok = { ...META, token_state: "ok", token_expires_at: "2026-12-31T00:00:00Z" };
    expect(await instagram().health(ctx(ok))).toEqual({
      state: "ok",
      detail: "The token expires on 2026-12-31.",
    });
    expect(await instagram().health(ctx({ ...ok, token_state: "dead" }))).toMatchObject({
      state: "red",
    });
    expect(await facebook().health(ctx({ ...META, token_state: "ok" }))).toEqual({
      state: "ok",
      detail: "The token does not expire.",
    });
  });

  it("supports the kinds that targetsFor sends to the channel", () => {
    const kinds: AssetKind[] = ["carousel", "cover", "story", "reel", "newsletter_block"];
    expect(kinds.map((kind) => [instagram().supports(kind), facebook().supports(kind)])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [true, false],
      [false, false],
    ]);
  });
});

describe("the registry", () => {
  it("hands out the Meta adapter of instagram and of facebook for an enabled row", () => {
    expect(getChannel("instagram", true).id).toBe("instagram");
    expect(getChannel("facebook", true).id).toBe("facebook");
    expect(getChannel("instagram", true).supports("story")).toBe(true);
  });
});

describe("the Facebook Page block", () => {
  const photos = `POST ${PAGE}/photos`;
  const url = `${MEDIA_BASE}/o/oak-hill/cover.webp`;

  it("posts a cover as a Page photo with the url and the caption, then reads permalink_url", async () => {
    const graph = stubGraph({
      [photos]: answerOf("facebook-photo"),
      "GET 1000000000000002_1000000000000001": answerOf("facebook-permalink"),
    });
    expect(await facebook().publish(cover(), ctx())).toEqual({
      status: "posted",
      remoteId: "1000000000000002_1000000000000001",
      permalink: "https://www.facebook.com/example/posts/1000000000000002",
    });
    expect(graph.sent[0]?.params).toMatchObject({ url, caption: captionFor("facebook", cover()) });
    expect(graph.sent[0]?.params["published"]).toBeUndefined();
    expect(graph.sent[1]?.params["fields"]).toBe("permalink_url");
  });

  it("uploads a story photo unpublished, then publishes it to photo_stories", async () => {
    const graph = stubGraph({
      [photos]: answerOf("facebook-photo"),
      [`POST ${PAGE}/photo_stories`]: answerOf("facebook-photo-story"),
      "GET 1000000000000003": answerOf("facebook-permalink"),
    });
    const storyAsset = asset({ kind: "story", files: [file("main", "o/oak-hill/cover.webp")] });
    const result = await facebook().publish(storyAsset, ctx());
    expect(result).toMatchObject({ status: "posted", remoteId: "1000000000000003" });
    expect(graph.calls()).toEqual([photos, `POST ${PAGE}/photo_stories`, "GET 1000000000000003"]);
    expect(graph.sent[0]?.params).toMatchObject({ url, published: "false" });
    expect(graph.sent[0]?.params["caption"]).toBeUndefined();
    expect(graph.sent[1]?.params["photo_id"]).toBe("1000000000000001");
  });

  it("adopts the newest Page post at or after since", async () => {
    const graph = stubGraph({ [`GET ${PAGE}/posts`]: answerOf("facebook-posts") });
    const found = await facebook().findRecentPost("", new Date("2026-10-06T00:00:00Z"), ctx());
    expect(found).toEqual({
      status: "posted",
      remoteId: "1000000000000099_1000000000000010",
      permalink: "https://www.facebook.com/example/posts/1000000000000010",
    });
    expect(graph.sent[0]?.params["fields"]).toBe("message,created_time,permalink_url");
  });

  it("answers metrics with skipped_disabled until the Page insights are named", async () => {
    const graph = stubGraph({});
    expect(await facebook().metrics({ remoteId: "1", permalink: null }, ctx())).toEqual({
      status: "skipped_disabled",
    });
    expect(graph.spy).not.toHaveBeenCalled();
  });
});

// B10 step 5a: the LinkedIn adapter against a mocked LinkedIn API. The API is a fetch stub that answers from
// tests/fixtures/linkedin and writes down every request; the database is fakeDb with Vault, `settings.linkedin` and
// the social.sql functions.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetFile, AssetKind } from "../../../src/domain/assets.ts";
import { getChannel } from "../../../src/server/channels/index.ts";
import { createLinkedInChannel } from "../../../src/server/channels/linkedin.ts";
import { ChannelApiError } from "../../../src/server/channels/oauth-tokens.ts";
import type { SocialAsset } from "../../../src/server/channels/types.ts";
import { context } from "../../fixtures/asset-rows";
import {
  Answer,
  answerOf,
  platformFixture,
  requestOf,
  socialDb,
  stubPlatform,
} from "../../fixtures/social-api";

const MEDIA_BASE = "https://matterofplace.com/media";
const ORG = "urn:li:organization:100000001";
const SETTINGS = { organization_urn: ORG, api_version: "202509" };
const HELD = {
  access_token: "linkedin-access-held",
  refresh_token: "linkedin-refresh-held",
  expires_at: "2026-11-30T00:00:00.000Z",
};
const INIT = requestOf("linkedin", "initialize-upload");
const POSTS = requestOf("linkedin", "post-create");
const LIST = requestOf("linkedin", "posts-by-author");
const STATS = requestOf("linkedin", "share-statistics");
const SHARE = "urn:li:share:7380000000000000001";
const IMAGE = (n: number) => `urn:li:image:D4E10AQExample${String(n)}`;
const PUT = (n: number) =>
  `PUT https://www.linkedin.com/dms-uploads/sp/v2/D4E10AQExample${String(n)}/uploaded-image/0`;
const media = (key: string) => `GET ${MEDIA_BASE}/${key}`;
const BYTES = new Uint8Array([82, 73, 70, 70, 4, 5, 6]);
const CAPTION = "Oak Hill, Larchmont (Westchester). For agents and brokerages: #3 on the street.";

const ctx = (
  database = socialDb({ vault: HELD, settings: { key: "linkedin", value: SETTINGS } }),
) => context(database, "post_linkedin");

const file = (role: AssetFile["role"], key: string, index?: number): AssetFile => ({
  media_key: key,
  w: 1200,
  h: 627,
  bytes: BYTES.length,
  role,
  ...(index === undefined ? {} : { index }),
});

const COVER_KEY = "o/oak-hill/cover-linkedin.webp";
const SET_KEYS = [1, 2, 3].map((n) => `o/oak-hill/linkedin-${String(n)}.webp`);

const asset = (kind: AssetKind, files: AssetFile[]): SocialAsset => ({
  kind,
  files,
  caption: "The Instagram caption.",
  meta: { captions: { x: "The X caption.", linkedin: CAPTION } },
  property_slug: "oak-hill",
});
const cover = () =>
  asset("cover", [file("x", "o/oak-hill/cover-x.webp"), file("linkedin", COVER_KEY)]);
// Listed out of order: the set is posted by `index`.
const carousel = () =>
  asset("carousel", [
    file("linkedin_set", SET_KEYS[2] ?? "", 3),
    file("slide", "o/oak-hill/s1.webp", 1),
    file("linkedin_set", SET_KEYS[0] ?? "", 1),
    file("linkedin_set", SET_KEYS[1] ?? "", 2),
  ]);

const uploads = (count: number) => ({
  [INIT]: ["first", "second", "third"]
    .slice(0, count)
    .map((which) => answerOf("linkedin", "initialize-upload", which)),
  ...Object.fromEntries([1, 2, 3].slice(0, count).map((n) => [PUT(n), new Answer(undefined, 201)])),
  [POSTS]: answerOf("linkedin", "post-create"),
});

const POSTED = {
  status: "posted",
  remoteId: SHARE,
  permalink: `https://www.linkedin.com/feed/update/${SHARE}/`,
};

const jsonBody = (body: unknown): unknown => (typeof body === "string" ? JSON.parse(body) : null);

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

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
  vi.stubEnv("LINKEDIN_CLIENT_ID", "linkedin-client");
  vi.stubEnv("LINKEDIN_CLIENT_SECRET", "linkedin-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("LinkedIn publishing", () => {
  it("uploads the cover's image, then creates an organisation post with it", async () => {
    const api = stubPlatform({ [media(COVER_KEY)]: new Answer(BYTES), ...uploads(1) });
    expect(await createLinkedInChannel().publish(cover(), ctx())).toEqual(POSTED);
    expect(api.calls()).toEqual([media(COVER_KEY), INIT, PUT(1), POSTS]);
    expect(api.sent[1]?.url.searchParams.get("action")).toBe("initializeUpload");
    expect(jsonBody(api.sent[1]?.body)).toEqual({ initializeUploadRequest: { owner: ORG } });
    const put = api.sent[2]?.body;
    expect(put instanceof Blob ? new Uint8Array(await put.arrayBuffer()) : null).toEqual(BYTES);
    expect(jsonBody(api.sent[3]?.body)).toEqual({
      author: ORG,
      commentary:
        "Oak Hill, Larchmont \\(Westchester\\). For agents and brokerages: \\#3 on the street.",
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: { media: { id: IMAGE(1) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
  });

  it("posts the carousel's linkedin_set as one multi-image post, in index order, after fetching every file", async () => {
    const api = stubPlatform({
      ...Object.fromEntries(SET_KEYS.map((key) => [media(key), new Answer(BYTES)])),
      ...uploads(3),
    });
    expect(await createLinkedInChannel().publish(carousel(), ctx())).toEqual(POSTED);
    expect(api.calls()).toEqual([
      ...SET_KEYS.map(media),
      INIT,
      PUT(1),
      INIT,
      PUT(2),
      INIT,
      PUT(3),
      POSTS,
    ]);
    expect(jsonBody(api.sent.at(-1)?.body)).toMatchObject({
      content: { multiImage: { images: [{ id: IMAGE(1) }, { id: IMAGE(2) }, { id: IMAGE(3) }] } },
    });
  });

  it("sends both version headers and the token on every LinkedIn call", async () => {
    const api = stubPlatform({ [media(COVER_KEY)]: new Answer(BYTES), ...uploads(1) });
    await createLinkedInChannel().publish(cover(), ctx());
    const headers = api.sent
      .slice(1)
      .map((request) => [
        request.headers.get("linkedin-version"),
        request.headers.get("x-restli-protocol-version"),
        request.headers.get("authorization"),
      ]);
    expect(headers).toEqual(
      Array.from({ length: 3 }, () => ["202509", "2.0.0", "Bearer linkedin-access-held"]),
    );
  });

  it("hands over the first image's marker after the uploads and before the post is created", async () => {
    const api = stubPlatform({
      ...Object.fromEntries(SET_KEYS.map((key) => [media(key), new Answer(BYTES)])),
      ...uploads(3),
    });
    const seen: { marker: string; created: boolean }[] = [];
    await createLinkedInChannel().publish(carousel(), ctx(), (marker) => {
      seen.push({ marker, created: api.calls().includes(POSTS) });
      return Promise.resolve();
    });
    expect(seen).toEqual([
      { marker: `inflight:2026-10-04T12:00:00.000Z:image:${IMAGE(1)}`, created: false },
    ]);
  });

  it("uploads nothing when one file of the set answers 503", async () => {
    const api = stubPlatform({
      ...Object.fromEntries(SET_KEYS.map((key) => [media(key), new Answer(BYTES)])),
      [media(SET_KEYS[1] ?? "")]: new Answer(undefined, 503),
      ...uploads(3),
    });
    const error = await failure(createLinkedInChannel().publish(carousel(), ctx()));
    expect(error.message).toBe(`The file ${SET_KEYS[1] ?? ""} answered 503.`);
    expect(api.calls()).toEqual(SET_KEYS.slice(0, 2).map(media));
  });

  it("throws version_expired when LinkedIn no longer serves the pinned version", async () => {
    stubPlatform({
      [media(COVER_KEY)]: new Answer(BYTES),
      ...uploads(1),
      [POSTS]: answerOf("linkedin", "version-missing"),
    });
    const error = await failure(createLinkedInChannel().publish(cover(), ctx()));
    expect(error instanceof ChannelApiError ? error.detail : null).toMatchObject({
      class: "non_retryable",
      reason: "version_expired",
    });
  });

  it("posts covers and carousels, and the registry hands it out for an enabled row", () => {
    const kinds: AssetKind[] = ["cover", "carousel", "story", "reel"];
    expect(kinds.map((kind) => createLinkedInChannel().supports(kind))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(getChannel("linkedin", true).id).toBe("linkedin");
  });
});

describe("LinkedIn findRecentPost", () => {
  const list = () => ({ [LIST]: answerOf("linkedin", "posts-by-author") });
  const marker = (urn: string) => `inflight:2026-10-04T11:50:00.000Z:image:${urn}`;

  it("adopts the organisation's post whose content.media.id is the stored image URN", async () => {
    const api = stubPlatform(list());
    expect(
      await createLinkedInChannel().findRecentPost(marker(IMAGE(1)), new Date(0), ctx()),
    ).toEqual(POSTED);
    expect(Object.fromEntries(api.sent[0]?.url.searchParams ?? [])).toEqual({
      q: "author",
      author: ORG,
    });
    expect(api.sent[0]?.headers.get("linkedin-version")).toBe("202509");
  });

  it("adopts a multi-image post holding the URN, and nothing when no post holds it", async () => {
    stubPlatform(list());
    const linkedin = createLinkedInChannel();
    expect(await linkedin.findRecentPost(marker(IMAGE(2)), new Date(0), ctx())).toMatchObject({
      remoteId: "urn:li:share:7380000000000000003",
    });
    expect(await linkedin.findRecentPost(marker(IMAGE(9)), new Date(0), ctx())).toEqual({
      status: "not_found",
    });
  });
});

describe("LinkedIn metrics", () => {
  it("maps the share statistics to views, clicks, likes, comments and shares, and leaves the rest null", async () => {
    const api = stubPlatform({ [STATS]: answerOf("linkedin", "share-statistics") });
    const result = await createLinkedInChannel().metrics(
      { remoteId: SHARE, permalink: null },
      ctx(),
    );
    expect(result).toEqual({
      status: "fetched",
      metrics: {
        reach: null,
        views: 58,
        saves: null,
        shares: 2,
        likes: 7,
        comments: 1,
        clicks: 5,
        fetched_at: "2026-10-04T12:00:00.000Z",
        raw: platformFixture("linkedin", "share-statistics").response,
      },
    });
    expect(api.sent[0]?.url.search).toBe(
      `?q=organizationalEntity&organizationalEntity=${encodeURIComponent(ORG)}&shares=List(${encodeURIComponent(SHARE)})`,
    );
  });
});

describe("LinkedIn health", () => {
  it("shows an expired API version as amber", async () => {
    const value = { ...SETTINGS, token_state: "version_expired" };
    const database = socialDb({ vault: HELD, settings: { key: "linkedin", value } });
    expect(await createLinkedInChannel().health(ctx(database))).toEqual({
      state: "amber",
      detail: "API version expired",
    });
  });
});

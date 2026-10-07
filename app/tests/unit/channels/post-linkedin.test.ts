// B10 step 6: the `post_linkedin` step against a mocked LinkedIn API (invariants 2, 3 and 5). The database is the
// channel world of tests/fixtures/channel-db.ts; LinkedIn and the media address are a fetch stub. Nothing here reaches
// the network (R50).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postLinkedIn } from "../../../src/server/jobs/steps/post-linkedin";
import type { StepContext } from "../../../src/server/jobs/types";
import { context } from "../../fixtures/asset-rows";
import { ASSET, channelWorld, PROPERTY } from "../../fixtures/channel-db";
import type { FakeDb } from "../../fixtures/fake-db";
import { Answer, answerOf, requestOf, stubPlatform } from "../../fixtures/social-api";

const MEDIA_BASE = "https://matterofplace.com/media";
const COVER_KEY = "o/oak-hill/cover-linkedin.webp";
const MEDIA = `GET ${MEDIA_BASE}/${COVER_KEY}`;
const INIT = requestOf("linkedin", "initialize-upload");
const PUT = "PUT https://www.linkedin.com/dms-uploads/sp/v2/D4E10AQExample1/uploaded-image/0";
const CREATE = requestOf("linkedin", "post-create");
const SHARE = "urn:li:share:7380000000000000001";
const NOW = new Date("2026-10-06T14:00:00.000Z");
const DATA = {
  asset_id: ASSET,
  property_id: PROPERTY,
  kind: "cover",
  tier: "Feature",
  market: "new-york",
};

const happy = () => ({
  [MEDIA]: new Answer(new Uint8Array([82, 73, 70, 70])),
  [INIT]: answerOf("linkedin", "initialize-upload", "first"),
  [PUT]: new Answer(undefined, 201),
  [CREATE]: answerOf("linkedin", "post-create"),
});

function world() {
  return channelWorld({
    kind: "cover",
    files: [{ media_key: COVER_KEY, w: 1200, h: 627, bytes: 4, role: "linkedin" }],
    settings: [
      {
        key: "linkedin",
        value: { organization_urn: "urn:li:organization:100000001", api_version: "202509" },
      },
    ],
    handlers: {
      get_vault_secret: () =>
        JSON.stringify({
          access_token: "linkedin-access-held",
          refresh_token: "linkedin-refresh-held",
          expires_at: "2026-11-30T00:00:00.000Z",
        }),
    },
  });
}

function ctxOf(db: FakeDb, now = NOW): StepContext {
  return { ...context(db, "post_linkedin"), now };
}

const run = (ctx: StepContext) => postLinkedIn.run(ctx, postLinkedIn.paramsSchema.parse({}), DATA);

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("post_linkedin", () => {
  it("post_linkedin runs twice without a second outside effect", async () => {
    const api = stubPlatform(happy());
    const { db, posts } = world();
    expect(await run(ctxOf(db))).toEqual({
      status: "done",
      result: {
        result: "posted",
        remote_id: SHARE,
        permalink: `https://www.linkedin.com/feed/update/${SHARE}/`,
      },
    });
    await run(ctxOf(db));
    expect(api.calls()).toEqual([MEDIA, INIT, PUT, CREATE]);
    expect(posts).toHaveLength(1);
  });

  it("outside the window returns retry_at, so no attempt is used, and calls nothing", async () => {
    const api = stubPlatform(happy());
    const { db } = world();
    expect(await run(ctxOf(db, new Date("2026-10-08T17:00:00.000Z")))).toEqual({
      status: "retry_at",
      at: new Date("2026-10-13T13:00:00.000Z"),
      reason: "outside_window",
    });
    expect(api.calls()).toEqual([]);
  });

  it("SOCIAL_DRY_RUN logs the payload and calls nothing", async () => {
    vi.stubEnv("SOCIAL_DRY_RUN", "1");
    const api = stubPlatform(happy());
    const { db } = world();
    const log = vi.fn();
    expect(await run({ ...ctxOf(db), log })).toEqual({
      status: "done",
      result: { result: "dry_run" },
    });
    expect(log).toHaveBeenCalledWith(
      "info",
      "social_dry_run",
      expect.objectContaining({ channel: "linkedin" }),
    );
    expect(api.calls()).toEqual([]);
  });
});

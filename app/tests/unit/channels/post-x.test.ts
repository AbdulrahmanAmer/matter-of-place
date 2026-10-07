// B10 step 6: the `post_x` step against a mocked X API (invariants 2, 3 and 5). The database is the channel world of
// tests/fixtures/channel-db.ts; X and the media address are a fetch stub. Nothing here reaches the network (R50).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { postX } from "../../../src/server/jobs/steps/post-x";
import type { StepContext } from "../../../src/server/jobs/types";
import { context } from "../../fixtures/asset-rows";
import { ASSET, channelWorld, PROPERTY } from "../../fixtures/channel-db";
import type { FakeDb } from "../../fixtures/fake-db";
import { Answer, answerOf, requestOf, stubPlatform } from "../../fixtures/social-api";

const MEDIA_BASE = "https://matterofplace.com/media";
const COVER_KEY = "o/oak-hill/cover-x.webp";
const MEDIA = `GET ${MEDIA_BASE}/${COVER_KEY}`;
const UPLOAD = requestOf("x", "media-upload");
const CREATE = requestOf("x", "tweet-create");
const NOW = new Date("2026-10-06T14:00:00.000Z");
const DATA = {
  asset_id: ASSET,
  property_id: PROPERTY,
  kind: "cover",
  tier: "Feature",
  market: "new-york",
};

const happy = () => ({
  [MEDIA]: new Answer(new Uint8Array([137, 80, 78, 71])),
  [UPLOAD]: answerOf("x", "media-upload"),
  [CREATE]: answerOf("x", "tweet-create"),
});

function world() {
  return channelWorld({
    kind: "cover",
    files: [{ media_key: COVER_KEY, w: 1200, h: 675, bytes: 4, role: "x" }],
    settings: [
      { key: "linkedin", value: {} },
      {
        key: "x",
        value: { user_id: "1700000000000000001", handle: "mop_test", read_allowance: 100 },
      },
    ],
    handlers: {
      get_vault_secret: () =>
        JSON.stringify({
          access_token: "x-access-held",
          refresh_token: "x-refresh-held",
          expires_at: "2026-12-01T00:00:00.000Z",
        }),
    },
  });
}

function ctxOf(db: FakeDb, now = NOW): StepContext {
  return { ...context(db, "post_x"), now };
}

const run = (ctx: StepContext) => postX.run(ctx, postX.paramsSchema.parse({}), DATA);

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("post_x", () => {
  it("post_x runs twice without a second outside effect", async () => {
    const api = stubPlatform(happy());
    const { db, posts } = world();
    expect(await run(ctxOf(db))).toEqual({
      status: "done",
      result: {
        result: "posted",
        remote_id: "1840000000000000001",
        permalink: "https://x.com/mop_test/status/1840000000000000001",
      },
    });
    await run(ctxOf(db));
    expect(api.calls()).toEqual([MEDIA, UPLOAD, CREATE]);
    expect(posts).toHaveLength(1);
  });

  it("outside the window returns retry_at, so no attempt is used, and calls nothing", async () => {
    const api = stubPlatform(happy());
    const { db } = world();
    expect(await run(ctxOf(db, new Date("2026-10-06T17:00:00.000Z")))).toEqual({
      status: "retry_at",
      at: new Date("2026-10-07T13:00:00.000Z"),
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
      expect.objectContaining({ channel: "x" }),
    );
    expect(api.calls()).toEqual([]);
  });
});

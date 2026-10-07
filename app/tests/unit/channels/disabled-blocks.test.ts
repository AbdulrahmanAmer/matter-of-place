// B10 invariant 7: the YouTube block and every channel whose row is disabled answer `skipped_disabled` and make no
// request. fetch is a spy that throws, so any call fails the test as well as the assertion on the spy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetKind } from "../../../src/domain/assets.ts";
import type { SocialChannel } from "../../../src/domain/channels.ts";
import { getChannel } from "../../../src/server/channels/index.ts";
import type { Channel } from "../../../src/server/channels/types.ts";
import { createYouTubeChannel } from "../../../src/server/channels/youtube.ts";
import { assetRow, context } from "../../fixtures/asset-rows";
import { socialDb } from "../../fixtures/social-api";

const fetchSpy = vi.fn(() => {
  throw new Error("no request may leave a disabled block");
});

beforeEach(() => {
  vi.stubEnv("MOP_ENV", "production");
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  fetchSpy.mockClear();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const KINDS: AssetKind[] = ["carousel", "cover", "story", "reel"];

async function answers(block: Channel) {
  const ctx = context(socialDb(), "post_meta");
  const results = [];
  for (const kind of KINDS) {
    const { files, caption, meta } = assetRow();
    results.push(
      await block.publish({ kind, files, caption, meta, property_slug: "oak-hill" }, ctx),
    );
  }
  return {
    publish: results,
    metrics: await block.metrics({ remoteId: "1", permalink: null }, ctx),
    health: await block.health(ctx),
  };
}

const SKIPPED = {
  publish: KINDS.map(() => ({ status: "skipped_disabled" })),
  metrics: { status: "skipped_disabled" },
  health: { state: "disabled" },
};

describe("disabled blocks", () => {
  it("youtube supports no kind, answers skipped_disabled and makes no request", async () => {
    const youtube = createYouTubeChannel();
    expect(KINDS.map((kind) => youtube.supports(kind))).toEqual(KINDS.map(() => false));
    expect(await answers(youtube)).toEqual(SKIPPED);
    expect(await answers(getChannel("youtube", true))).toEqual(SKIPPED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a disabled facebook, x or linkedin row answers skipped_disabled and makes no request", async () => {
    const disabled: SocialChannel[] = ["facebook", "x", "linkedin"];
    for (const name of disabled) expect(await answers(getChannel(name, false))).toEqual(SKIPPED);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

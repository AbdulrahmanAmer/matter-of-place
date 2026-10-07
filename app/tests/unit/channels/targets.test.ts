import { describe, expect, it } from "vitest";
import type { SocialChannel } from "../../../src/domain/channels.ts";
import {
  captionFor,
  filesFor,
  getChannel,
  targetsFor,
} from "../../../src/server/channels/index.ts";
import type { SocialAsset } from "../../../src/server/channels/types.ts";
import { assetRow, context } from "../../fixtures/asset-rows";
import { fakeDb } from "../../fixtures/fake-db";

const file = (role: string, index?: number) => ({
  media_key: `o/oak-hill/${role}${index === undefined ? "" : String(index)}.webp`,
  w: 1080,
  h: 1350,
  bytes: 1000,
  role,
  ...(index === undefined ? {} : { index }),
});

function asset(overrides: Partial<SocialAsset>): SocialAsset {
  const { kind, files, caption, meta } = assetRow();
  return { kind, files, caption, meta, property_slug: "oak-hill", ...overrides };
}

const keys = (files: { media_key: string }[]): string[] => files.map((entry) => entry.media_key);

describe("targetsFor", () => {
  it("sends a carousel to instagram only while multi_image is null", () => {
    expect(targetsFor("carousel", { linkedin: { multi_image: null } })).toEqual(["instagram"]);
    expect(targetsFor("carousel", {})).toEqual(["instagram"]);
  });

  it("sends a carousel to instagram and linkedin when multi_image is true", () => {
    expect(targetsFor("carousel", { linkedin: { multi_image: true } })).toEqual([
      "instagram",
      "linkedin",
    ]);
  });

  it("sends a cover to x, linkedin and facebook while multi_image is null", () => {
    expect(targetsFor("cover", { linkedin: { multi_image: null } })).toEqual([
      "x",
      "linkedin",
      "facebook",
    ]);
  });

  it("leaves linkedin off a cover when multi_image is true", () => {
    expect(targetsFor("cover", { linkedin: { multi_image: true } })).toEqual(["x", "facebook"]);
  });

  it("sends a story to instagram and facebook and a reel to instagram", () => {
    expect(targetsFor("story", {})).toEqual(["instagram", "facebook"]);
    expect(targetsFor("reel", {})).toEqual(["instagram"]);
  });

  it("keeps a channel whose row is disabled in the targets of a carousel", () => {
    const rows = { linkedin: null, instagram: { enabled: false } };
    expect(targetsFor("carousel", rows)).toEqual(["instagram"]);
  });

  it("gives a newsletter block and a standalone email no target", () => {
    expect(targetsFor("newsletter_block", {})).toEqual([]);
    expect(targetsFor("standalone_email", {})).toEqual([]);
  });
});

describe("filesFor and captionFor", () => {
  it("reads the x file and the x caption for a cover on x", () => {
    const cover = asset({
      kind: "cover",
      files: [file("main"), file("linkedin"), file("x")],
      meta: { captions: { instagram: "ig", x: "short x caption", linkedin: "long caption" } },
    });
    expect(keys(filesFor("x", cover))).toEqual(["o/oak-hill/x.webp"]);
    expect(captionFor("x", cover)).toBe("short x caption");
  });

  it("reads the slide files of an instagram carousel in index order whatever the array order", () => {
    const carousel = asset({
      kind: "carousel",
      caption: "instagram caption",
      files: [file("slide", 2), file("linkedin_set", 0), file("slide", 0), file("slide", 1)],
    });
    expect(keys(filesFor("instagram", carousel))).toEqual([
      "o/oak-hill/slide0.webp",
      "o/oak-hill/slide1.webp",
      "o/oak-hill/slide2.webp",
    ]);
    expect(captionFor("instagram", carousel)).toBe("instagram caption");
  });

  it("reads the main file of an instagram story", () => {
    const story = asset({ kind: "story", files: [file("poster"), file("main")] });
    expect(keys(filesFor("instagram", story))).toEqual(["o/oak-hill/main.webp"]);
  });

  it("reads the video and then the poster of an instagram reel", () => {
    const reel = asset({ kind: "reel", files: [file("poster"), file("video")] });
    expect(keys(filesFor("instagram", reel))).toEqual([
      "o/oak-hill/video.webp",
      "o/oak-hill/poster.webp",
    ]);
  });

  it("reads the linkedin file of a cover and the linkedin_set files of a carousel on linkedin", () => {
    const meta = { captions: { instagram: "ig", x: "x", linkedin: "editorial caption" } };
    const cover = asset({ kind: "cover", files: [file("main"), file("linkedin")], meta });
    const carousel = asset({
      kind: "carousel",
      files: [file("linkedin_set", 1), file("slide", 0), file("linkedin_set", 0)],
      meta,
    });
    expect(keys(filesFor("linkedin", cover))).toEqual(["o/oak-hill/linkedin.webp"]);
    expect(keys(filesFor("linkedin", carousel))).toEqual([
      "o/oak-hill/linkedin_set0.webp",
      "o/oak-hill/linkedin_set1.webp",
    ]);
    expect(captionFor("linkedin", cover)).toBe("editorial caption");
  });

  it("reads the main file of a cover on facebook and the linkedin caption plus the dossier url", () => {
    const cover = asset({
      kind: "cover",
      files: [file("x"), file("main")],
      meta: { captions: { instagram: "ig", x: "x", linkedin: "editorial caption" } },
    });
    expect(keys(filesFor("facebook", cover))).toEqual(["o/oak-hill/main.webp"]);
    expect(captionFor("facebook", cover)).toBe(
      "editorial caption\n\nhttps://matterofplace.com/property/oak-hill?utm_source=facebook&utm_medium=social&utm_campaign=oak-hill",
    );
  });

  it("gives no file and no caption where a channel and a kind never meet", () => {
    const cover = asset({ kind: "cover", files: [file("main"), file("x")], meta: {} });
    expect(filesFor("instagram", cover)).toEqual([]);
    expect(captionFor("x", cover)).toBeNull();
    expect(captionFor("facebook", cover)).toBeNull();
    expect(captionFor("youtube", cover)).toBeNull();
  });
});

describe("getChannel", () => {
  it("answers a disabled row with the disabled block, which posts nothing", async () => {
    const channels: SocialChannel[] = ["instagram", "x", "linkedin", "facebook", "youtube"];
    for (const name of channels) {
      const block = getChannel(name, false);
      const ctx = context(fakeDb(), "post_meta");
      expect(block.id).toBe(name);
      expect(await block.publish(asset({}), ctx)).toEqual({ status: "skipped_disabled" });
      expect(await block.metrics({ remoteId: "1", permalink: null }, ctx)).toEqual({
        status: "skipped_disabled",
      });
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  canMove,
  channelProblems,
  proposedPostInputSchema,
  type ChannelPost,
} from "../../src/domain/proposed-posts";

// W8 item 10 (H116): the status machine and the channel rules of a proposed post. The same rules run again in SQL
// (tests/db/proposed-posts.db.test.ts), so a refusal reads the same from the admin route and from the runner.

const file = (key: string) => ({
  key,
  source: "studio" as const,
  original: null,
  alt: "The entrance hall.",
  w: 1080,
  h: 1350,
  bytes: 200_000,
});

const post = (overrides: Partial<ChannelPost>): ChannelPost => ({
  channel: "x",
  format: "single",
  caption: "Fairfield.",
  images: [file("proposed/t/x.jpg")],
  reel: null,
  ...overrides,
});

describe("the status machine", () => {
  it("moves a proposed post to approved or rejected, a rejected one back to proposed, and nothing out of posted", () => {
    expect({
      approve: canMove("proposed", "approved"),
      reject: canMove("proposed", "rejected"),
      approveTwice: canMove("approved", "approved"),
      approveRejected: canMove("rejected", "approved"),
      revise: canMove("rejected", "proposed"),
      schedule: canMove("approved", "scheduled"),
      post: canMove("scheduled", "posted"),
      settledUnposted: canMove("scheduled", "approved"),
      afterPosted: canMove("posted", "rejected"),
    }).toEqual({
      approve: true,
      reject: true,
      approveTwice: false,
      approveRejected: false,
      revise: true,
      schedule: true,
      post: true,
      settledUnposted: true,
      afterPosted: false,
    });
  });
});

describe("the caption count", () => {
  it("counts code points as char_length does, so an emoji is one character on both sides", () => {
    expect({
      atLimit: channelProblems(post({ caption: "🏠".repeat(280) })),
      over: channelProblems(post({ caption: "🏠".repeat(281) })),
    }).toEqual({
      atLimit: [],
      over: ["X captions are at most 280 characters; this one has 281."],
    });
  });
});

describe("the channel rules", () => {
  it("refuses a disabled channel, a caption over each limit, a wrong image count and a LinkedIn reel without its poster", () => {
    const reel = { video: file("proposed/t/reel.mp4"), poster: null };
    expect({
      facebook: channelProblems(post({ channel: "facebook" })),
      youtube: channelProblems(post({ channel: "youtube" })),
      x: channelProblems(post({ caption: "a".repeat(281) })),
      xAtLimit: channelProblems(post({ caption: "a".repeat(280) })),
      instagram: channelProblems(post({ channel: "instagram", caption: "a".repeat(2201) })),
      linkedin: channelProblems(post({ channel: "linkedin", caption: "a".repeat(3001) })),
      carousel: channelProblems(post({ channel: "instagram", format: "carousel" })),
      xCarousel: channelProblems(
        post({
          format: "carousel",
          images: ["1", "2", "3", "4", "5"].map((n) => file(`k/${n}.jpg`)),
        }),
      ),
      poster: channelProblems(post({ channel: "linkedin", format: "reel", images: [], reel })),
      instagramReel: channelProblems(
        post({ channel: "instagram", format: "reel", images: [], reel }),
      ),
      reelWithImages: channelProblems(post({ channel: "instagram", format: "reel", reel })),
    }).toEqual({
      facebook: ["Facebook is a disabled channel block."],
      youtube: ["YouTube is a disabled channel block."],
      x: ["X captions are at most 280 characters; this one has 281."],
      xAtLimit: [],
      instagram: ["Instagram captions are at most 2200 characters; this one has 2201."],
      linkedin: ["LinkedIn captions are at most 3000 characters; this one has 3001."],
      carousel: ["A carousel on Instagram takes 2 to 10 images; this one has 1."],
      xCarousel: ["A carousel on X takes 2 to 4 images; this one has 5."],
      poster: ["A reel on LinkedIn needs its poster."],
      instagramReel: [],
      reelWithImages: ["A reel on Instagram carries no images."],
    });
  });

  it("answers each refusal at the channel's path with its reason, and takes the Fairfield set", () => {
    const refused = proposedPostInputSchema.safeParse({
      title: "Fairfield",
      channels: [post({ channel: "facebook" }), post({ caption: "a".repeat(281) }), post({})],
    });
    expect(refused.error?.issues.map((issue) => [issue.path.join("."), issue.message])).toEqual([
      ["channels.0", "Facebook is a disabled channel block."],
      ["channels.1", "X captions are at most 280 characters; this one has 281."],
      ["channels.2.channel", "X is named twice."],
    ]);
    const fairfield = proposedPostInputSchema.safeParse({
      title: "Fairfield",
      test: true,
      channels: [
        post({
          channel: "instagram",
          format: "carousel",
          images: ["s1", "s2", "s3"].map((n) => file(`proposed/t/${n}.jpg`)),
        }),
        post({
          channel: "linkedin",
          format: "carousel",
          images: ["q1", "q2"].map((n) => file(`proposed/t/${n}.jpg`)),
        }),
        post({}),
      ],
    });
    expect([fairfield.success, fairfield.data?.property_id, fairfield.data?.test]).toEqual([
      true,
      null,
      true,
    ]);
  });
});

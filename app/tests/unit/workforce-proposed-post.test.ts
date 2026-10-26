import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fileProposedPost,
  isStructuredPost,
  type PostDeps,
} from "../../scripts/workforce/proposed-post";

// W8 item 10 (H135): the runner files a colleague's structured post. The channel rules run before anything is uploaded;
// a file must lie in the studio or the Drive folder (or already be in storage); each is measured, uploaded under
// `proposed/<batch>/` and named in create_proposed_post with where it came from.

let root = "";
let studio = "";
let drive = "";
let elsewhere = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mop-post-test-"));
  studio = join(root, "studio");
  drive = join(root, "drive");
  elsewhere = join(root, "elsewhere");
  for (const folder of [studio, drive, elsewhere]) mkdirSync(folder);
  writeFileSync(join(studio, "Slide 1.jpg"), "slide-one");
  writeFileSync(join(drive, "cover.png"), "cover");
  writeFileSync(join(elsewhere, "secret.jpg"), "not ours");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function deps(stored: Record<string, string> = {}, refuse = "") {
  const uploads: string[] = [];
  const removed: string[] = [];
  const created: unknown[] = [];
  const probed: string[] = [];
  const fake: PostDeps = {
    roots: { studio, drive },
    realPath: (path) => {
      probed.push(path);
      return existsSync(path) ? realpathSync(path) : null;
    },
    download: (key) =>
      Promise.resolve(key in stored ? new TextEncoder().encode(stored[key]) : null),
    upload: (key) => {
      uploads.push(key);
      return Promise.resolve();
    },
    measure: (_body, video) => Promise.resolve(video ? { w: 1080, h: 1920 } : { w: 1080, h: 1350 }),
    remove: (keys) => {
      removed.push(...keys);
      return Promise.resolve();
    },
    create: (args) => {
      created.push(args);
      return Promise.resolve(refuse === "" ? { id: "post-1" } : { refused: refuse });
    },
  };
  return { fake, uploads, removed, created, probed };
}

const input = (post: unknown) => ({ agent: "maya", run: "run-1", summary: "Fairfield", post });

describe("isStructuredPost", () => {
  it("files only a social post that carries its post; any other proposal stays a generic approval", () => {
    expect([
      isStructuredPost({ action: "social_post", content: { post: { channels: [] } } }),
      isStructuredPost({ action: "social_post", content: {} }),
      isStructuredPost({ action: "campaign_plan", content: { post: { channels: [] } } }),
    ]).toEqual([true, false, false]);
  });
});

describe("fileProposedPost, what it never touches or leaves", () => {
  it("refuses a network or device path before the disk is touched", async () => {
    const { fake, uploads, probed } = deps();
    const single = (path: string) =>
      fileProposedPost(
        fake,
        input({
          channels: [
            {
              channel: "x",
              format: "single",
              caption: "Fairfield.",
              images: [{ path, alt: "A." }],
            },
          ],
        }),
      );
    expect([
      await single("\\\\host\\share\\x.jpg"),
      await single("//host/share/x.jpg"),
      await single("\\\\?\\C:\\x.jpg"),
    ]).toEqual([
      { refused: "\\\\host\\share\\x.jpg is not in the studio or the Drive folder" },
      { refused: "//host/share/x.jpg is not in the studio or the Drive folder" },
      { refused: "\\\\?\\C:\\x.jpg is not in the studio or the Drive folder" },
    ]);
    expect([uploads, probed]).toEqual([[], []]);
  });

  it("removes what it uploaded when a later file or the database refuses the post", async () => {
    const image = (path: string) => ({ path, alt: "A." });
    const twoFiles = input({
      channels: [
        {
          channel: "linkedin",
          format: "carousel",
          caption: "Fairfield.",
          images: [image(join(studio, "Slide 1.jpg")), image(join(elsewhere, "secret.jpg"))],
        },
      ],
    });
    const later = deps();
    const lateAnswer = await fileProposedPost(later.fake, twoFiles);
    const database = deps({}, "media_not_found");
    const dbAnswer = await fileProposedPost(
      database.fake,
      input({
        channels: [
          {
            channel: "x",
            format: "single",
            caption: "Fairfield.",
            images: [image(join(drive, "cover.png"))],
          },
        ],
      }),
    );
    expect([lateAnswer, later.removed, later.created]).toEqual([
      { refused: `${join(elsewhere, "secret.jpg")} is not in the studio or the Drive folder` },
      later.uploads,
      [],
    ]);
    expect([dbAnswer, database.removed]).toEqual([
      { refused: "media_not_found" },
      database.uploads,
    ]);
    expect([later.uploads.length, database.uploads.length]).toEqual([1, 1]);
  });
});

describe("fileProposedPost", () => {
  it("refuses a disabled channel or a long caption before uploading anything", async () => {
    const { fake, uploads, created } = deps();
    const image = { path: join(studio, "Slide 1.jpg"), alt: "The hall." };
    const answers = [
      await fileProposedPost(
        fake,
        input({
          channels: [
            { channel: "youtube", format: "single", caption: "Fairfield.", images: [image] },
          ],
        }),
      ),
      await fileProposedPost(
        fake,
        input({
          channels: [{ channel: "x", format: "single", caption: "a".repeat(281), images: [image] }],
        }),
      ),
    ];
    expect(answers).toEqual([
      { refused: "YouTube is a disabled channel block." },
      { refused: "X captions are at most 280 characters; this one has 281." },
    ]);
    expect([uploads, created]).toEqual([[], []]);
  });

  it("refuses a file outside the studio and the Drive folder, and a storage key that is not stored", async () => {
    const { fake, created } = deps();
    const single = (file: Record<string, string>) =>
      fileProposedPost(
        fake,
        input({
          channels: [
            {
              channel: "x",
              format: "single",
              caption: "Fairfield.",
              images: [{ ...file, alt: "A." }],
            },
          ],
        }),
      );
    const outside = join(elsewhere, "secret.jpg");
    expect([
      await single({ path: outside }),
      await single({ path: join(studio, "..", "elsewhere", "secret.jpg") }),
      await single({ key: "proposed/none/x.jpg" }),
    ]).toEqual([
      { refused: `${outside} is not in the studio or the Drive folder` },
      {
        refused: `${join(studio, "..", "elsewhere", "secret.jpg")} is not in the studio or the Drive folder`,
      },
      { refused: "proposed/none/x.jpg is not in storage" },
    ]);
    expect(created).toEqual([]);
  });

  it("never stores a post the admin list could not read: a key outside the key pattern, or a file measured oddly", async () => {
    const odd = deps({ "proposed/t/x.jpg": "x" });
    odd.fake.measure = () => Promise.resolve({ w: 1080.5, h: 1350 });
    const plain = deps({ "proposed/t/x.jpg": "x" });
    const single = (fake: PostDeps, key: string) =>
      fileProposedPost(
        fake,
        input({
          channels: [
            { channel: "x", format: "single", caption: "Fairfield.", images: [{ key, alt: "A." }] },
          ],
        }),
      );
    const badKey = await single(plain.fake, "proposed/t/x y.jpg");
    const measured = await single(odd.fake, "proposed/t/x.jpg");
    expect({
      badKey:
        "refused" in badKey && badKey.refused.startsWith("the post is not in the shape asked for"),
      measured:
        "refused" in measured && measured.refused.startsWith("a file is not in the shape stored"),
      created: [plain.created, odd.created],
    }).toEqual({ badKey: true, measured: true, created: [[], []] });
  });

  it("uploads studio and Drive files under one batch and proposes them with their source, path, size and alt", async () => {
    const { fake, uploads, created } = deps({ "requested/r1/reel.mp4": "video" });
    const answer = await fileProposedPost(
      fake,
      input({
        test: true,
        channels: [
          {
            channel: "x",
            format: "single",
            caption: "Fairfield.",
            images: [{ path: join(drive, "cover.png"), alt: "The front door." }],
          },
          {
            channel: "instagram",
            format: "reel",
            caption: "Fairfield, in motion.",
            reel: {
              video: { key: "requested/r1/reel.mp4", alt: "Rooms in turn." },
              poster: { path: join(studio, "Slide 1.jpg"), alt: "The hall." },
            },
          },
        ],
      }),
    );
    expect(answer).toEqual({ id: "post-1" });
    expect(uploads).toHaveLength(2);
    expect(
      uploads.every((key) =>
        /^proposed\/[0-9a-f-]{36}\/(cover|slide-1)\.[0-9a-f]{8}\.(png|jpg)$/.test(key),
      ),
    ).toBe(true);
    expect(new Set(uploads.map((key) => key.split("/")[1])).size).toBe(1);
    expect(created).toEqual([
      {
        p_title: "Fairfield",
        p_proposer_kind: "agent",
        p_proposer_agent: "maya",
        p_run: "run-1",
        p_test: true,
        p_channels: [
          {
            channel: "x",
            format: "single",
            caption: "Fairfield.",
            images: [
              {
                key: uploads[0],
                source: "drive",
                original: join(drive, "cover.png"),
                alt: "The front door.",
                w: 1080,
                h: 1350,
                bytes: 5,
              },
            ],
            reel: null,
          },
          {
            channel: "instagram",
            format: "reel",
            caption: "Fairfield, in motion.",
            images: [],
            reel: {
              video: {
                key: "requested/r1/reel.mp4",
                source: "storage",
                original: null,
                alt: "Rooms in turn.",
                w: 1080,
                h: 1920,
                bytes: 5,
              },
              poster: {
                key: uploads[1],
                source: "studio",
                original: join(studio, "Slide 1.jpg"),
                alt: "The hall.",
                w: 1080,
                h: 1350,
                bytes: 9,
              },
            },
          },
        ],
      },
    ]);
  });
});

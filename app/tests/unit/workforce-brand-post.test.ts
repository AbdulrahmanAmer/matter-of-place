import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { matterPrompt } from "../../scripts/matter/run.ts";
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import {
  copyEarlier,
  inPalette,
  MIN_TEXT_PX,
  postCaptions,
  postPass,
  postPrompt,
  postReviewPrompt,
  readDesign,
  sourceGate,
  stillGate,
  strayWords,
  type FrameReport,
  type PostDeps,
} from "../../scripts/workforce/brand-post.ts";
import {
  framesFor,
  postRequestSchema,
  type PostRequest,
} from "../../scripts/workforce/post-request.ts";
import { mediaFor, queueReel, reelPass, type Brief } from "../../scripts/workforce/reel.ts";
import { lintBrandCaption } from "../../src/server/assets/voice.ts";
import { fakeDb, type FakeDb } from "../fixtures/fake-db.ts";

// W8 item 1: a still post about the brand, a market or a story waits in the studio beside the reels, and one pass
// designs it fresh, gates and reviews it, and records it as a pending visual of its subject, or stops and says why.

const from = { agent: "matter", thread: "team" };
const comingSoon: PostRequest = {
  skill: "post",
  name: "Coming soon",
  kind: "coming_soon",
  titles: ["A quieter way", "to show a home."],
  caption: "A selective platform for homes in California, New York and Florida. Opening soon.",
  captions: { x: "Opening soon.", linkedin: "A selective platform, opening soon." },
};
const interest: PostRequest = {
  skill: "post",
  name: "Hear about homes in California",
  kind: "interest",
  titles: ["Hear about homes here."],
  market: "california",
  caption: "Hear first when a California home joins the collection.",
};

const studio = () => mkdtempSync(join(tmpdir(), "studio-"));
const briefRead = z.object({ id: z.string(), state: z.string() }).passthrough();
const brief = (folder: string) =>
  briefRead.parse(JSON.parse(readFileSync(join(folder, "brief.json"), "utf8")));

/** A clean report of a frame, as the engine and sharp answer it. */
function report(name: string, width: number, height: number, text: string): FrameReport {
  return {
    name,
    file: "",
    width,
    height,
    findings: [],
    families: ["Cormorant Garamond", "Jost"],
    colors: ["rgb(17, 17, 15)", "rgb(238, 234, 225)", "rgba(0, 0, 0, 0)"],
    smallest_px: 32,
    text,
    spread: 40,
  };
}

const recording = (): FakeDb =>
  fakeDb({
    rpc: { record_requested_asset: () => "asset-9" },
    tables: {
      markets: [
        {
          slug: "california",
          name: "California",
          image: "markets/california.webp",
          coming_soon: true,
          country: "United States",
          created_at: "",
          currency: "USD",
          image_variants: {},
          interest_copy: null,
          intro: "x",
          places: [],
          sort_order: 1,
          updated_at: "",
        },
      ],
    },
  });

const DESIGN =
  '{"alt": "Two lines of type over Bone, the emblem below.", "slide_alts": ["The first line.", "The second line."], "note": "type and space"}';

function deps(
  over: Partial<PostDeps> = {},
  log: string[] = [],
  db: FakeDb = recording(),
): PostDeps {
  return {
    db,
    download: (key) => {
      log.push(`download ${key}`);
      return Promise.resolve(new Uint8Array([7]));
    },
    design: (folder, prompt) => {
      log.push(`design ${prompt.slice(0, 40)}`);
      writeFileSync(join(folder, "post", "post.html"), "<html><body>x</body></html>");
      return Promise.resolve(`Done. ${DESIGN}`);
    },
    render: (folder, frames) => {
      log.push("render");
      mkdirSync(join(folder, "out"), { recursive: true });
      return Promise.resolve(
        frames.map((frame, index) => {
          const file = join(folder, "out", `${frame.name}.png`);
          writeFileSync(file, `png ${frame.name}`);
          const titles = ["A quieter way", "to show a home."];
          return {
            ...report(
              frame.name,
              frame.width,
              frame.height,
              `${titles[index] ?? ""}\nMATTER OF PLACE`,
            ),
            file,
          };
        }),
      );
    },
    review: () => {
      log.push("review");
      return Promise.resolve('Calm and clear. {"pass": true, "reasons": []}');
    },
    jpeg: (png) => Promise.resolve(new Uint8Array(readFileSync(png))),
    upload: (key) => {
      log.push(`upload ${key}`);
      return Promise.resolve();
    },
    remove: (keys) => {
      log.push(`remove ${keys.join(",")}`);
      return Promise.resolve();
    },
    say: (thread, body) => {
      log.push(`say ${thread}: ${body}`);
      return Promise.resolve();
    },
    ...over,
  };
}

describe("a post request (W8 item 1)", () => {
  it("names the subject its kind needs and no other, and keeps a carousel to 2 to 6 titles", () => {
    const parses = (over: Record<string, unknown>) =>
      postRequestSchema.safeParse({ ...comingSoon, ...over }).success;
    expect({
      comingSoon: parses({}),
      comingSoonInAMarket: parses({ market: "florida" }),
      marketNoteWithout: parses({ kind: "market_note" }),
      marketNote: parses({ kind: "market_note", market: "new-york" }),
      storyCardWithout: parses({ kind: "story_card", titles: ["One"] }),
      storyCard: parses({
        kind: "story_card",
        titles: ["One"],
        story_id: "00000000-0000-4000-8000-000000000001",
      }),
      oneSlide: parses({ titles: ["Only one"] }),
      sevenSlides: parses({ titles: ["1", "2", "3", "4", "5", "6", "7"] }),
      storyOfFour: parses({ format: "story", titles: ["a", "b", "c", "d"] }),
      emDash: parses({ titles: [`A home ${String.fromCharCode(0x2014)} here`, "two"] }),
    }).toEqual({
      comingSoon: true,
      comingSoonInAMarket: false,
      marketNoteWithout: false,
      marketNote: true,
      storyCardWithout: false,
      storyCard: true,
      oneSlide: false,
      sevenSlides: false,
      storyOfFour: false,
      emDash: false,
    });
  });

  it("is read from Matter's answer beside a reel, and dropped from a colleague's", () => {
    const answer = readJsonAnswer(
      `Done. ${JSON.stringify({ reply: "ok", media: [comingSoon, { skill: "reel", name: "r", kind: "brand", titles: ["a"] }] })}`,
    );
    expect(answer.media.map((item) => item.skill)).toEqual(["post", "reel"]);
    expect(mediaFor(answer.media, true, []).map((item) => item.skill)).toEqual(["post", "reel"]);
    expect(mediaFor(answer.media, false, ["request_reel"]).map((item) => item.skill)).toEqual([
      "reel",
    ]);
  });

  it("is shot at B9's sizes and roles: carousel slides, a story, a cover with its X and LinkedIn crops", () => {
    expect({
      carousel: framesFor("carousel", ["a", "b"]),
      story: framesFor("story", ["a"]),
      cover: framesFor("cover", ["a"]).map((frame) => [frame.role, frame.width, frame.height]),
    }).toEqual({
      carousel: [
        { name: "slide-0", role: "slide", index: 0, width: 1080, height: 1350 },
        { name: "slide-1", role: "slide", index: 1, width: 1080, height: 1350 },
      ],
      story: [{ name: "story", role: "main", width: 1080, height: 1920 }],
      cover: [
        ["main", 1200, 630],
        ["x", 1200, 675],
        ["linkedin", 1200, 627],
      ],
    });
  });

  it("tells Matter how to ask for one, and that it is never posted by itself", () => {
    const prompt = matterPrompt({
      charterText: "",
      atlasText: "",
      notes: "",
      thread: "",
      business: "",
      power: "full",
    });
    expect([
      prompt.includes('{"skill": "post"'),
      prompt.includes("coming_soon|market_note|story_card|interest"),
      prompt.includes("it is never posted by itself"),
    ]).toEqual([true, true, true]);
  });
});

describe("a post's captions", () => {
  it("adds the post's own link on X and LinkedIn, the market's page for an interest post", () => {
    const soon = postCaptions(comingSoon);
    const california = postCaptions({
      ...interest,
      captions: { x: "Hear first.", linkedin: "Hear first." },
    });
    expect({
      soon: soon.captions,
      california: [california.captions.x, california.captions.linkedin],
      issues: [...soon.issues, ...california.issues],
    }).toEqual({
      soon: {
        instagram: comingSoon.caption,
        x: "Opening soon. https://matterofplace.com/?utm_source=x&utm_medium=social&utm_campaign=coming-soon",
        linkedin:
          "A selective platform, opening soon.\n\nhttps://matterofplace.com/?utm_source=linkedin&utm_medium=social&utm_campaign=coming-soon",
      },
      california: [
        "Hear first. https://matterofplace.com/california?utm_source=x&utm_medium=social&utm_campaign=interest-california",
        "Hear first.\n\nhttps://matterofplace.com/california?utm_source=linkedin&utm_medium=social&utm_campaign=interest-california",
      ],
      issues: [],
    });
  });

  it("refuses a figure, a hashtag, an exclamation, a promise or a link of its own", () => {
    const issues = (caption: string) => postCaptions({ ...comingSoon, caption }).issues;
    expect({
      figure: issues("Twelve homes, 3 markets."),
      hashtag: issues("Opening soon. #realestate"),
      exclamation: issues("Opening soon!"),
      promise: issues("More buyers for your home."),
      link: issues("Opening soon. https://example.com"),
    }).toEqual({
      figure: ["instagram: A brand post states no figures: 3."],
      hashtag: ["instagram: Use no hashtags."],
      exclamation: ["instagram: Use no exclamation marks."],
      promise: ['instagram: Promise no leads, buyers or sales; do not use "buyers".'],
      link: ["instagram: Carry no link; the profile holds it."],
    });
    expect(lintBrandCaption("Opening soon.", "x", "https://matterofplace.com/")).toEqual([
      { rule: "link", message: "Carry exactly this link and no other: https://matterofplace.com/" },
    ]);
  });
});

describe("the still gate", () => {
  const frames = framesFor("carousel", ["A quieter way", "to show a home."]);
  const allowed = ["A quieter way", "to show a home.", "Matter of Place", "matterofplace.com"];
  const clean = [
    report("slide-0", 1080, 1350, "A QUIETER\nWAY\nMatter of Place"),
    report("slide-1", 1080, 1350, "to show a home.\nmatterofplace.com"),
  ];

  it("passes frames of the request's words in the house typefaces and palette", () => {
    expect(stillGate(clean, frames, allowed)).toBeNull();
  });

  it("names every broken rule of every frame", () => {
    const broken: FrameReport[] = [
      {
        ...report("slide-0", 1080, 1080, "A quieter way. Book now"),
        findings: ["background-image gradient on <div.sky>"],
        families: ["Arial"],
        smallest_px: 14,
        colors: ["rgb(212, 175, 55)"],
      },
      { ...report("slide-1", 1080, 1350, ""), spread: 1 },
    ];
    expect(stillGate(broken, frames, allowed)?.split("; ")).toEqual([
      "gate_failed: slide-0: 1080 x 1080, not 1080 x 1350",
      "slide-0: background-image gradient on <div.sky> (no gradients, shadows, glow or blur)",
      "slide-0: typeface Arial is not one of Cormorant Garamond, Jost, Urbanist, Epilogue",
      "slide-0: text at 14 px, the least is 24 px",
      "slide-0: colours outside the palette: rgb(212, 175, 55)",
      "slide-0: words nobody asked for: book now",
      "slide-1: the frame is blank",
    ]);
    expect(stillGate([clean[0] ?? report("x", 1, 1, "")], frames, allowed)).toBe(
      "gate_failed: slide-1: not drawn",
    );
  });

  it("takes a palette colour at any alpha as a flat tint, and nothing else", () => {
    expect([
      inPalette("rgb(17, 17, 15)"),
      inPalette("rgba(17, 17, 15, 0.45)"),
      inPalette("rgba(0, 0, 0, 0)"),
      inPalette("rgb(255, 255, 255)"),
      inPalette("rgb(0, 0, 0)"),
      inPalette("oklch(0.5 0.1 80)"),
    ]).toEqual([true, true, true, false, false, false]);
  });

  it("reads the words a frame shows past the allowed lines, whatever their case and line breaks", () => {
    expect(
      strayWords("A QUIETER\nWAY  matterofplace.com/california", [
        "A quieter way",
        "matterofplace.com/california",
      ]),
    ).toEqual([]);
    expect(strayWords("Hear about homes here. 1/3", ["Hear about homes here."])).toEqual([
      "1",
      "3",
    ]);
  });

  it("reads the page's files for what a canvas draws and for anything from outside the site", () => {
    expect(
      sourceGate([
        { name: "post.html", text: '<p style="text-shadow: none">x</p>' },
        { name: "post.mjs", text: 'ctx.fillStyle = "#11110F"; ctx.globalAlpha = 0.5;' },
      ]),
    ).toBeNull();
    expect(
      sourceGate([
        {
          name: "post.mjs",
          text: 'const g = ctx.createLinearGradient(0, 0, 1, 1); ctx.shadowBlur = 8; ctx.fillStyle = "#D4AF37";',
        },
        { name: "post.html", text: '<link href="https://fonts.googleapis.com/css2?family=Jost">' },
      ])?.split("; "),
    ).toEqual([
      "gate_failed: post.mjs: a canvas gradient",
      "post.mjs: a shadow or glow",
      "post.mjs: colour #D4AF37 is not in the palette",
      "post.html: a file from outside the site (use the served paths only)",
    ]);
  });

  it("reads the designer's alt text, and for a carousel one per slide", () => {
    expect(readDesign(`ok ${DESIGN}`, 2)?.slide_alts).toHaveLength(2);
    expect(readDesign(`ok ${DESIGN}`, 3)).toBeNull();
    expect(readDesign('{"alt": "A story."}', 0)?.alt).toBe("A story.");
    expect(readDesign("no object", 0)).toBeNull();
  });
});

describe("no two posts share a layout", () => {
  it("shows the designer and the reviewer the newest earlier posts, never this one's own", () => {
    const root = studio();
    const write = (name: string, at: string, state: Brief["state"], skill: "post" | "reel") => {
      const folder = join(root, name);
      mkdirSync(join(folder, "out"), { recursive: true });
      const request =
        skill === "post" ? comingSoon : { skill, name: "r", kind: "brand", titles: ["a"] };
      writeFileSync(
        join(folder, "brief.json"),
        JSON.stringify({ id: "00000000-0000-4000-8000-000000000001", at, request, from, state }),
      );
      writeFileSync(join(folder, "out", "slide-0.png"), `first of ${name}`);
      return folder;
    };
    write("old", "2026-10-18T08:00:00Z", "done", "post");
    write("new", "2026-10-19T08:00:00Z", "done", "post");
    write("failed", "2026-10-19T09:00:00Z", "failed", "post");
    write("reel", "2026-10-19T09:30:00Z", "done", "reel");
    const own = write("own", "2026-10-19T10:00:00Z", "working", "post");
    expect(copyEarlier(root, own)).toBe(2);
    expect([
      readFileSync(join(own, "reference", "earlier", "1.png"), "utf8"),
      readFileSync(join(own, "reference", "earlier", "2.png"), "utf8"),
    ]).toEqual(["first of new", "first of old"]);
    const asked = postRequestSchema.parse(comingSoon);
    const queued: Brief = {
      id: "00000000-0000-4000-8000-000000000002",
      at: "",
      request: asked,
      from,
      state: "working",
    };
    const post = { ...queued, request: asked };
    const frames = framesFor("carousel", asked.titles);
    expect([
      postPrompt(post, frames, [], 2).includes("Yours must share no layout with any of them"),
      postReviewPrompt(post, frames, 0, 2).includes(
        "Refuse it if its layout repeats one of the earlier posts",
      ),
      postPrompt(post, frames, [], 2).includes(
        "a gate of code reads the page's text and refuses any word beyond these",
      ),
    ]).toEqual([true, true, true]);
  });

  it("tells the designer the one smallest text size the gate lets through", () => {
    const asked = postRequestSchema.parse(comingSoon);
    const post = {
      id: "00000000-0000-4000-8000-000000000002",
      at: "",
      request: asked,
      from,
      state: "working" as const,
    };
    const prompt = postPrompt(post, framesFor("carousel", asked.titles), [], 0);
    expect(prompt).toContain(`at least ${String(MIN_TEXT_PX)} px tall`);
    // no other size is named for text
    expect(prompt.match(/at least \d+ px tall/g)).toEqual([
      `at least ${String(MIN_TEXT_PX)} px tall`,
    ]);
    // the page loads nothing the post's guard refuses (launch/engine/post-guard.mjs)
    expect(prompt).not.toContain("/app/src/");
  });
});

describe("the post pass", () => {
  it("designs, gates, has it reviewed, uploads each frame under requested/<id>/ and records a pending visual of its subject", async () => {
    const root = studio();
    const folder = queueReel(comingSoon, from, root);
    const log: string[] = [];
    const db = recording();
    expect(await postPass(deps({}, log, db), root)).toBe("post Coming soon: done (asset-9)");
    const { id } = brief(folder);
    expect(log.slice(0, 3).map((line) => line.split(" ")[0])).toEqual([
      "design",
      "render",
      "review",
    ]);
    expect(log.filter((line) => line.startsWith("upload ")).map((line) => line.slice(7))).toEqual([
      expect.stringMatching(new RegExp(`^requested/${id}/slide-0\\.[0-9a-f]{8}\\.jpg$`)),
      expect.stringMatching(new RegExp(`^requested/${id}/slide-1\\.[0-9a-f]{8}\\.jpg$`)),
    ]);
    expect(db.calls).toMatchObject([
      {
        kind: "rpc",
        name: "record_requested_asset",
        args: [
          {
            p_subject: "brand",
            p_kind: "carousel",
            p_files: [
              { role: "slide", index: 0, w: 1080, h: 1350 },
              { role: "slide", index: 1, w: 1080, h: 1350 },
            ],
            p_caption: comingSoon.caption,
            p_alt_text: "Two lines of type over Bone, the emblem below.",
            p_meta: {
              request_id: id,
              // the folder's name, never the laptop's path with its user name
              studio: basename(folder),
              caption_lint: "passed",
              slide_alts: ["The first line.", "The second line."],
              captions: { x: expect.stringContaining("utm_campaign=coming-soon") as unknown },
            },
          },
        ],
      },
    ]);
    expect(brief(folder)).toMatchObject({ state: "done", asset_id: "asset-9" });
    expect(log.at(-1)).toContain("waits in Visuals as a pending visual");
    expect(existsSync(join(folder, "reference", "DIRECTION.md"))).toBe(true);
  });

  it("gives the designer the gate's refusal, and makes the post when the revision passes", async () => {
    const root = studio();
    queueReel(comingSoon, from, root);
    const log: string[] = [];
    let shots = 0;
    const base = deps({}, log);
    const pass = await postPass(
      deps(
        {
          render: async (folder, frames) => {
            shots += 1;
            const reports = await base.render(folder, frames, {});
            return shots === 1 ? reports.map((one) => ({ ...one, families: ["Inter"] })) : reports;
          },
        },
        log,
      ),
      root,
    );
    expect(pass).toBe("post Coming soon: done (asset-9)");
    expect(log.filter((line) => line.startsWith("design ")).map((line) => line.slice(7))).toEqual([
      "You are the designer of Matter of Place'",
      "Your post in post/ was refused by the ga",
    ]);
  });

  it("stops when the reviewer still refuses it after its revisions, uploads nothing and says why", async () => {
    const root = studio();
    const folder = queueReel(comingSoon, from, root);
    const log: string[] = [];
    const db = recording();
    const refused = deps(
      {
        review: () => Promise.resolve('{"pass": false, "reasons": ["it repeats earlier post 1"]}'),
      },
      log,
      db,
    );
    expect(await postPass(refused, root)).toBe(
      "post Coming soon: failed (review_refused: it repeats earlier post 1)",
    );
    expect(log.filter((line) => line.startsWith("design "))).toHaveLength(3);
    expect(log.some((line) => line.startsWith("upload "))).toBe(false);
    expect(db.calls).toEqual([]);
    expect(brief(folder).state).toBe("failed");
    expect(log.at(-1)).toContain("Nothing was uploaded");
    // the thread is told the folder's name, never the laptop's path with its user name
    expect(log.at(-1)?.split("Its folder: ")[1]).toBe(basename(folder));
    expect(log.at(-1)).not.toContain(root);
  });

  it("refuses a caption that breaks the voice before any design", async () => {
    const root = studio();
    queueReel({ ...comingSoon, caption: "Opening soon!" }, from, root);
    const log: string[] = [];
    expect(await postPass(deps({}, log), root)).toBe(
      "post Coming soon: failed (caption_refused: instagram: Use no exclamation marks.)",
    );
    expect(log.some((line) => line.startsWith("design "))).toBe(false);
  });

  it("draws an interest post from its market's own picture and records it as the market's", async () => {
    const root = studio();
    const folder = queueReel(interest, from, root);
    const log: string[] = [];
    const db = recording();
    const story = (frames: Readonly<ReturnType<typeof framesFor>>, dir: string) =>
      frames.map((frame) => {
        const file = join(dir, "out", `${frame.name}.png`);
        mkdirSync(join(dir, "out"), { recursive: true });
        writeFileSync(file, "png");
        return {
          ...report(
            frame.name,
            frame.width,
            frame.height,
            "Hear about homes here. matterofplace.com/california",
          ),
          file,
        };
      });
    const made = deps(
      {
        design: (dir) => {
          writeFileSync(join(dir, "post", "post.html"), "<html></html>");
          return Promise.resolve('{"alt": "A coast road at dusk under one line of type."}');
        },
        render: (dir, frames) => Promise.resolve(story(frames, dir)),
      },
      log,
      db,
    );
    expect(await postPass(made, root)).toBe("post Hear about homes in California: done (asset-9)");
    expect(log[0]).toBe("download markets/california.webp");
    expect(existsSync(join(folder, "shots", "0.webp"))).toBe(true);
    expect(db.calls.filter((call) => call.kind === "rpc")).toMatchObject([
      {
        name: "record_requested_asset",
        args: [
          {
            p_subject: "market",
            p_kind: "story",
            p_market: "california",
            p_files: [{ role: "main", w: 1080, h: 1920 }],
          },
        ],
      },
    ]);
  });

  it("refuses a story card of a story nobody can read yet", async () => {
    const root = studio();
    queueReel(
      {
        ...comingSoon,
        kind: "story_card",
        titles: ["A house by the water"],
        story_id: "00000000-0000-4000-8000-000000000003",
      },
      from,
      root,
    );
    const db = fakeDb({
      tables: {
        stories: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            title: "By the water",
            image: null,
            editorial_state: "draft",
            category: "Places",
            created_at: "",
            deck: "x",
            image_variants: {},
            market_slug: "california",
            properties: [],
            published_at: null,
            slug: "by-the-water",
            updated_at: "",
            archived_at: null,
            author_id: null,
            body: [],
          },
        ],
      },
    });
    expect(await postPass(deps({}, [], db), root)).toBe(
      "post Coming soon: failed (story_not_published)",
    );
  });

  it("removes what it uploaded when the visual cannot be recorded", async () => {
    const root = studio();
    queueReel(comingSoon, from, root);
    const log: string[] = [];
    const db = fakeDb({ rpc: { record_requested_asset: () => new Error("asset_incomplete") } });
    expect(await postPass(deps({}, log, db), root)).toBe(
      "post Coming soon: failed (record_failed: asset_incomplete)",
    );
    const removed = log.find((line) => line.startsWith("remove "));
    expect(removed?.split(",")).toHaveLength(2);
    expect(log.at(-1)).toContain("Its uploaded files were removed again.");
    queueReel(comingSoon, from, root);
    const kept: string[] = [];
    await postPass(
      deps({ remove: () => Promise.reject(new Error("storage down")) }, kept, db),
      root,
    );
    expect(kept.at(-1)).toMatch(
      /These uploaded files could not be removed: requested\/.+slide-0.+, requested\/.+slide-1/,
    );
  });

  it("leaves a post to the post pass and a reel to the reel pass", async () => {
    const root = studio();
    const queued = queueReel(comingSoon, from, root);
    expect(
      await reelPass(
        {
          ...deps({}, [], fakeDb({ rpc: { studio_piece_put: () => undefined } })),
          desk: () => new Uint8Array(),
          voice: null,
          readFile: () => new Uint8Array(),
          render: () => Promise.reject(new Error("no")),
          review: () => Promise.reject(new Error("no")),
          preview: () => new Uint8Array(),
          uploadPreview: () => Promise.reject(new Error("no")),
          tellMatter: () => Promise.reject(new Error("no")),
        },
        root,
      ),
    ).toBeNull();
    expect(brief(queued).state).toBe("queued");
    const reels = studio();
    queueReel({ skill: "reel", name: "r", kind: "brand", titles: ["a"] }, from, reels);
    expect(await postPass(deps(), reels)).toBeNull();
  });
});

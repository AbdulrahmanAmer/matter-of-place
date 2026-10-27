import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { matterPrompt } from "../../scripts/matter/run.ts";
import { childLimit, setPassDeadline } from "../../scripts/lib/pass-deadline.mjs";
import { spawnLimited } from "../../scripts/render-reel.mjs";
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import {
  copyEarlier,
  errorLines,
  inPalette,
  MIN_TEXT_PX,
  PALETTE,
  postCaptions,
  postPass,
  postPrompt,
  postReviewPrompt,
  postRevisePrompt,
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
import {
  claimStudioLock,
  fontFaces,
  mediaFor,
  PASS_LIMIT_MS,
  queueReel,
  readStudioLock,
  reelPass,
  scenePrompt,
  STALE_MS,
  startStudioPass,
  studioPass,
  type Brief,
} from "../../scripts/workforce/reel.ts";
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

  // Round 8, 2026-10-27: the reviewer, never told the palette, took the reference film's sands for the house's.
  it("names the house palette from PALETTE to the designer, the reviser and the reviewer, and the film's colours as the film's own", () => {
    const asked = postRequestSchema.parse(comingSoon);
    const post = {
      id: "00000000-0000-4000-8000-000000000002",
      at: "",
      request: asked,
      from,
      state: "working" as const,
    };
    const frames = framesFor("carousel", asked.titles);
    const prompts = {
      design: postPrompt(post, frames, [], 0),
      revise: postRevisePrompt("review_refused: Slide 1: a colour", true),
      review: postReviewPrompt(post, frames, 0, 0),
    };
    for (const prompt of Object.values(prompts)) {
      for (const [name, hex] of Object.entries(PALETTE)) expect(prompt).toContain(`${name} ${hex}`);
      expect(prompt).toContain("are the film's, not the house palette");
      // the film's own sandstone and plinth sand (launch/brand-film-kit/reference/product-launch/DIRECTION.md)
      expect([prompt.includes("#C6B8A0"), prompt.includes("#C9BBA2")]).toEqual([false, false]);
    }
    expect(prompts.review).toContain("Sandstone #C9C0B2");
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

// The live proof of 2026-10-27: three queued posts sat for 30 minutes while every pass hung in silence, and the one made
// by hand failed on fonts the designer guessed, its reason keeping only the stack.
describe("the live proof's failures (W8 item 1, 2026-10-27)", () => {
  const workforce = join(process.cwd(), "scripts", "workforce");

  it("gives the post and reel designers the site's own @font-face rule for every file in public/fonts", () => {
    const asked = postRequestSchema.parse(comingSoon);
    const post = { id: "x", at: "", request: asked, from, state: "working" as const };
    const prompts = [
      postPrompt(post, framesFor("carousel", asked.titles), [], 0),
      postRevisePrompt("gate_failed: the page did not render", true),
      scenePrompt(
        { ...post, request: { skill: "reel", name: "r", kind: "brand", titles: ["a"] } },
        [],
      ),
    ];
    const files = readdirSync(join(process.cwd(), "public", "fonts")).filter((name) =>
      name.endsWith(".woff2"),
    );
    expect(files).toHaveLength(5);
    const rules = fontFaces().split("\n");
    expect(rules).toHaveLength(files.length);
    for (const file of files) {
      const rule = rules.find((line) => line.includes(`url("/app/public/fonts/${file}")`));
      expect(rule).toBeDefined();
      expect(rule).toMatch(
        /^@font-face \{ font-family: "[A-Za-z ]+"; font-style: (normal|italic); font-weight: \d+ \d+;/,
      );
      for (const prompt of prompts) expect(prompt).toContain(rule);
    }
    for (const prompt of prompts)
      expect(prompt).not.toMatch(/url\("\/fonts\/|from \/app\/public\/fonts\//);
  });

  it("keeps the engine's message lines in a failed render's reason, never its stack, excerpt or Node version", () => {
    const stderr = [
      "file:///E:/mop/launch/engine/still.mjs:134",
      '        throw new Error("Page errors in frame " + frame.name + ":\\n" + errors.join("\\n"));',
      "              ^",
      "",
      "Error: Page errors in frame slide-0:",
      "HTTP 404 http://127.0.0.1:4173/app/public/fonts/CormorantGaramond-Light.woff2",
      "HTTP 404 http://127.0.0.1:4173/app/public/fonts/Jost-Medium.woff2",
      "    at shoot (file:///E:/mop/launch/engine/still.mjs:134:15)",
      "    at async main (file:///E:/mop/launch/engine/still.mjs:160:3)",
      "",
      "Node.js v24.22.1",
    ].join("\r\n");
    expect(errorLines(stderr)).toBe(
      "Error: Page errors in frame slide-0: HTTP 404 http://127.0.0.1:4173/app/public/fonts/CormorantGaramond-Light.woff2 HTTP 404 http://127.0.0.1:4173/app/public/fonts/Jost-Medium.woff2",
    );
    // a long one is capped, from its start
    const long = errorLines(
      Array.from({ length: 40 }, (_, at) => `HTTP 404 /app/f${String(at)}.woff2`).join("\n"),
    );
    expect(long).toMatch(/^HTTP 404 \/app\/f0\.woff2 HTTP 404 \/app\/f1\.woff2 .*\.\.\.$/);
    expect(long.length).toBe(803);
  });

  it("writes each line of a studio pass with its time: a start, the reel's and the post's lines, an end, or why it failed", async () => {
    const lines: string[] = [];
    const log = (line: string) => {
      lines.push(line);
    };
    await studioPass(
      {
        reel: () => Promise.resolve(null),
        postNext: () => true,
        post: () => Promise.resolve("post Coming soon: done (a1)"),
      },
      log,
    );
    const at = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /;
    expect(lines.every((line) => at.test(line))).toBe(true);
    expect(lines.map((line) => line.replace(at, ""))).toEqual([
      "studio pass started",
      "reel: nothing to do",
      "post Coming soon: done (a1)",
      "studio pass ended",
    ]);
    lines.length = 0;
    await expect(
      studioPass(
        {
          reel: () => Promise.resolve("reel r: made"),
          postNext: () => true,
          post: () => Promise.reject(new Error("record_failed: no")),
        },
        log,
      ),
    ).rejects.toThrow("record_failed: no");
    expect(lines.map((line) => line.replace(at, ""))).toEqual([
      "studio pass started",
      "reel r: made",
      "studio pass failed: record_failed: no",
    ]);
  });

  it("is started by the runner with its output and errors appended to the studio log", () => {
    const folder = studio();
    const log = join(folder, "logs", "studio.log");
    let started: { args: string[]; stdio: unknown } | null = null;
    const lines = startStudioPass(
      (_command, args, options) => {
        const { stdio } = options;
        started = { args, stdio };
        const [, out, errors] = Array.isArray(stdio) ? stdio : [];
        if (typeof out === "number") writeSync(out, "a line\n");
        if (typeof errors === "number") writeSync(errors, "an error\n");
        return { unref: () => undefined, pid: 4242 };
      },
      log,
      join(folder, "studio.lock"),
      () => null,
    );
    expect(started).toEqual({
      args: [join(workforce, "reel.ts"), "--pass"],
      stdio: ["ignore", expect.any(Number) as unknown, expect.any(Number) as unknown],
    });
    expect(readFileSync(log, "utf8")).toBe("a line\nan error\n");
    // round 6: the pass claims its own lock, so one that ends at once leaves no id of its own behind
    expect(existsSync(join(folder, "studio.lock"))).toBe(false);
    expect(lines).toEqual([`reel pass started (its lines: ${log})`]);
  });

  // Round 5 (2026-10-27): a pass that hung before its piece was `working` was started again every minute, 262 of them.
  it("starts no second studio pass while the first one's process lives, and takes over the lock of one that ended", () => {
    const folder = studio();
    const lock = join(folder, "studio.lock");
    const log = join(folder, "studio.log");
    const started = Date.now() - 60_000;
    writeFileSync(lock, JSON.stringify({ pid: 4242, started }));
    let spawned = 0;
    const run = () => {
      spawned += 1;
      return { unref: () => undefined, pid: 5151 };
    };
    // Windows records the start 18 ms before the pass reads its own (claimStudioLock)
    expect(startStudioPass(run, log, lock, (pid) => (pid === 4242 ? started - 18 : null))).toEqual([
      "reel pass 4242 still running, none started",
    ]);
    expect(spawned).toBe(0);
    expect(readFileSync(lock, "utf8")).toBe(JSON.stringify({ pid: 4242, started }));
    expect(startStudioPass(run, log, lock, () => null)).toEqual([
      "reel pass 4242 has ended without its lock; the lock is taken over",
      `reel pass started (its lines: ${log})`,
    ]);
    expect(spawned).toBe(1);
    // the new pass claims the lock itself, so the runner leaves none for it
    expect(existsSync(lock)).toBe(false);
  });

  // Round 6 (2026-10-27): a lock past its limit was taken over while its pass still ran, so a hung pass gained a twin
  // every 6 h 10 min. Only the sweep ends a pass.
  it("starts no second pass beside a live one past its limit, says so once, and kills nothing", () => {
    const folder = studio();
    const lock = join(folder, "studio.lock");
    const log = join(folder, "studio.log");
    const started = Date.now() - 4 * 60 * 60_000;
    writeFileSync(lock, JSON.stringify({ pid: 4242, started }));
    let spawned = 0;
    const run = () => {
      spawned += 1;
      return { unref: () => undefined, pid: 5151 };
    };
    const kill = vi.spyOn(process, "kill");
    try {
      const live = (pid: number) => (pid === 4242 ? started - 18 : null);
      expect(startStudioPass(run, log, lock, live)).toEqual([
        "reel pass 4242 has run 240 min, past its limit of 195 min; none started, the sweep ends it",
      ]);
      expect(startStudioPass(run, log, lock, live)).toEqual([
        "reel pass 4242 still running, none started",
      ]);
      // a live process whose start cannot be read is taken for the pass, never twinned
      expect(startStudioPass(run, log, lock, () => Number.NaN)).toEqual([
        "reel pass 4242 still running, none started",
      ]);
      expect(spawned).toBe(0);
      expect(kill).not.toHaveBeenCalled();
      expect(readFileSync(lock, "utf8")).toBe(JSON.stringify({ pid: 4242, started }));
    } finally {
      kill.mockRestore();
    }
  });

  it("takes over the lock when its id belongs to a process started later (an id given again)", () => {
    const folder = studio();
    const lock = join(folder, "studio.lock");
    const log = join(folder, "studio.log");
    const started = Date.now() - 4 * 60 * 60_000;
    writeFileSync(lock, JSON.stringify({ pid: 4242, started }));
    let spawned = 0;
    const lines = startStudioPass(
      () => {
        spawned += 1;
        return { unref: () => undefined, pid: 5151 };
      },
      log,
      lock,
      () => started + 60 * 60_000,
    );
    expect(lines).toEqual([
      "reel pass 4242 has ended and its id is another process's; the lock is taken over",
      `reel pass started (its lines: ${log})`,
    ]);
    expect(spawned).toBe(1);
    expect(existsSync(lock)).toBe(false);
  });

  it("lets the pass claim the lock once, with its id and start, and refuses a second claim", () => {
    const folder = studio();
    const lock = join(folder, "studio.lock");
    expect(claimStudioLock(lock, 4242, 1_000)).toBeNull();
    expect(readStudioLock(lock)).toEqual({ pid: 4242, started: 1_000 });
    const refused = claimStudioLock(lock, 5151, 2_000);
    expect(refused).not.toBeNull();
    expect(refused).toMatch(/EEXIST/);
    expect(readStudioLock(lock)).toEqual({ pid: 4242, started: 1_000 });
  });

  // Round 6: a lock read after its pass removed it ended the runner's tick before its calls and its mail.
  it("counts a lock that cannot be read as none, and never throws on it", () => {
    const folder = studio();
    // a lock that is a folder cannot be read, as one removed between two reads cannot
    const lock = join(folder, "studio.lock");
    mkdirSync(lock);
    let lines: string[] = [];
    expect(() => {
      lines = startStudioPass(() => ({ unref: () => undefined }), join(folder, "studio.log"), lock);
    }).not.toThrow();
    expect(lines.at(-1)).toBe(`reel pass started (its lines: ${join(folder, "studio.log")})`);
    expect(readStudioLock(join(folder, "missing.lock"))).toBeNull();
    writeFileSync(join(folder, "old.lock"), "4242");
    expect(readStudioLock(join(folder, "old.lock"))).toBeNull();
  });

  // Round 6: the watchdog is a timer, and a spawnSync with no limit held the event loop, so it never fired.
  // the child ends by itself after 2 s, so with no limit the step passes on an assertion, inside the 15 s given here
  it("ends a step whose blocking child runs past its limit as a failed step, with why", async () => {
    const lines: string[] = [];
    await expect(
      studioPass(
        {
          reel: () => {
            spawnLimited(
              process.execPath,
              ["-e", "setTimeout(() => {}, 2000)"],
              { encoding: "utf8" },
              300,
            );
            return Promise.resolve("reel r: made");
          },
          postNext: () => false,
          post: () => Promise.resolve(null),
        },
        (line) => {
          lines.push(line);
        },
      ),
    ).rejects.toThrow("timed out after 0.3 s and was ended");
    expect(lines.at(-1)).toMatch(/ studio pass failed: \S+ timed out after 0\.3 s and was ended$/);
  }, 15_000);

  // Round 7: a render runs its children back to back with no turn of the event loop, so the watchdog alone could act
  // up to two hours late; each child's limit is cut to what is left of the pass, and none starts once it is out of time.
  it("cuts a child's limit to what is left of the studio pass, and starts no child once it is out of time", () => {
    const folder = mkdtempSync(join(tmpdir(), "pass-deadline-"));
    const marker = join(folder, "started.txt");
    setPassDeadline(1_000);
    try {
      expect(childLimit(900_000, 400)).toBe(600);
      expect(childLimit(300, 400)).toBe(300);
      expect(() => childLimit(300, 1_000)).toThrow(
        "the studio pass reached its limit; no further step was started",
      );
      // the deadline (1 s after the epoch) is long past, so spawnLimited refuses before it starts the child
      expect(() =>
        spawnLimited(
          process.execPath,
          ["-e", "require('node:fs').writeFileSync(process.argv[1], 'x')", marker],
          { encoding: "utf8" },
          60_000,
        ),
      ).toThrow("the studio pass reached its limit");
      expect(existsSync(marker)).toBe(false);
    } finally {
      setPassDeadline(Number.POSITIVE_INFINITY);
    }
  });

  it("holds the pass's own limit as the deadline of every child while the pass runs, and lets go after", async () => {
    const lines: string[] = [];
    let during = 0;
    await studioPass(
      {
        reel: () => {
          during = childLimit(10 * 3_600_000);
          return Promise.resolve(null);
        },
        postNext: () => false,
        post: () => Promise.resolve(null),
      },
      (line) => {
        lines.push(line);
      },
      60_000,
    );
    expect(during).toBeGreaterThan(0);
    expect(during).toBeLessThanOrEqual(60_000);
    expect(childLimit(10 * 3_600_000)).toBe(10 * 3_600_000);
    expect(lines.at(-1)).toMatch(/ studio pass ended$/);
  });

  it("names the program, not its first flag, when a child times out", () => {
    // ffprobe and ffmpeg are called with "-v" first; the reason named "-v" before round 7
    const program = basename(process.execPath).split(".").join("\\.");
    const reason = new RegExp(`^${program} timed out after 0\\.3 s`);
    expect(() =>
      spawnLimited(
        process.execPath,
        ["-e", "setTimeout(() => {}, 2000)"],
        { encoding: "utf8" },
        300,
      ),
    ).toThrow(reason);
  }, 15_000);

  it("starts the studio pass without its lines when the log cannot be opened, and says why to the runner", () => {
    const folder = studio();
    // a log whose folder is a file cannot be opened
    writeFileSync(join(folder, "taken"), "");
    let stdio: unknown = null;
    let lines: string[] = [];
    // a log that cannot be opened is said, never thrown (round 6: asserted, so its mutation fails here, not by a throw)
    expect(() => {
      lines = startStudioPass(
        (_command, _args, options) => {
          stdio = options.stdio;
          return { unref: () => undefined };
        },
        join(folder, "taken", "studio.log"),
        join(folder, "studio.lock"),
        () => null,
      );
    }).not.toThrow();
    expect(stdio).toBe("ignore");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^studio log not opened, the pass runs without its lines: \S/);
    expect(lines[1]).toBe("reel pass started (its lines: none)");
  });

  it("ends a studio pass that hangs past its limit, saying so in its log, and gives a reel its three hours", async () => {
    expect(PASS_LIMIT_MS).toBe(3 * 60 * 60_000);
    // past STALE_MS its piece is called abandoned, so the pass's limit is that same span
    expect(PASS_LIMIT_MS).toBe(STALE_MS);
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const codes: number[] = [];
      // the reel step takes 40 s, the post step hangs: the pass has one limit, so it ends by the sweep's cap (round 6)
      void studioPass(
        {
          reel: () =>
            new Promise<string | null>((done) => {
              setTimeout(() => {
                done("reel r: made");
              }, 40_000);
            }),
          postNext: () => true,
          post: () => new Promise<string | null>(() => undefined),
        },
        (line) => {
          lines.push(line);
        },
        60_000,
        (code) => {
          codes.push(code);
        },
      );
      await vi.advanceTimersByTimeAsync(59_999);
      expect(codes).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(codes).toEqual([1]);
      expect(lines.map((line) => line.replace(/^\S+ /, ""))).toEqual([
        "studio pass started",
        "reel r: made",
        "studio pass timed out after 1 min",
      ]);
    } finally {
      vi.useRealTimers();
      // the hung post never reaches studioPass's finally, so its deadline is let go here (round 7 review)
      setPassDeadline(Number.POSITIVE_INFINITY);
    }
  });

  it("never hangs on an import() of a runnable script while that script's top-level await is pending", () => {
    // `reel.ts --pass` awaits brand-post.ts; an import() of reel.ts from there never settled, and the pass hung
    expect(importBackCycles(join(process.cwd(), "scripts"))).toEqual([]);
  });

  it("finds an import() back into a runnable script through a third module, and allows a static import back", () => {
    // measured on bun 1.4.3 (P-4647): import() back hung, static import back exited 0
    const folder = studio();
    const write = (name: string, lines: string[]) => {
      writeFileSync(join(folder, name), `${lines.join("\n")}\n`);
    };
    write("a.ts", [
      "export const x = 1;",
      "if (import.meta.main) {",
      '  const m = await import("./b.ts");',
      "  await m.f();",
      "}",
    ]);
    write("b.ts", ['import { g } from "./c.ts";', "export const f = () => g();"]);
    write("c.ts", ["export async function g() {", '  await import("./a.ts");', "}"]);
    expect(importBackCycles(folder)).toEqual(["a.ts -> b.ts -> c.ts -> import(a.ts)"]);
    write("c.ts", [
      'import { x } from "./a.ts";',
      "export async function g() {",
      "  return x;",
      "}",
    ]);
    expect(importBackCycles(folder)).toEqual([]);
  });
});

type ImportEdge = { to: string; dynamic: boolean };

/** Every .ts and .mjs module under `root` with its relative imports: static (`from`, side effect) or import(). */
function importGraph(root: string): Map<string, { text: string; edges: ImportEdge[] }> {
  const graph = new Map<string, { text: string; edges: ImportEdge[] }>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules") walk(path);
      if (!entry.isFile() || !/\.(ts|mjs)$/.test(entry.name)) continue;
      const text = readFileSync(path, "utf8");
      const edge = (spec: string | undefined, dynamic: boolean) => ({
        to: resolve(dir, spec ?? ""),
        dynamic,
      });
      graph.set(path, {
        text,
        edges: [
          // a type-only import is erased and loads nothing
          ...[
            ...text.matchAll(
              /^\s*(?:import|export)\s+(type\s+)?[^;()]*?\bfrom\s+"(\.{1,2}\/[^"]+)"/gm,
            ),
          ]
            .filter((found) => found[1] === undefined)
            .map((found) => edge(found[2], false)),
          ...[...text.matchAll(/^\s*import\s+"(\.{1,2}\/[^"]+)"/gm)].map((found) =>
            edge(found[1], false),
          ),
          ...[...text.matchAll(/(?<!typeof\s)\bimport\(\s*"(\.{1,2}\/[^"]+)"\s*\)/g)].map((found) =>
            edge(found[1], true),
          ),
        ],
      });
    }
  };
  walk(root);
  return graph;
}

/**
 * Each chain from a runnable script with a top-level await (`import.meta.main`, an `await` in its main block or at
 * the top) back into it whose closing edge is an import(): that import() waits on the evaluation that waits on it.
 */
function importBackCycles(root: string): string[] {
  const graph = importGraph(root);
  const name = (path: string) => relative(root, path).split(sep).join("/");
  const awaitsAtTop = (text: string) => {
    const main = text.indexOf("if (import.meta.main)");
    return (
      main !== -1 &&
      (/\bawait\b/.test(text.slice(main)) ||
        /^(?:await\b|(?:export\s+)?(?:const|let)\s[^\n]*=\s*await\b)/m.test(text))
    );
  };
  return [...graph]
    .filter(([, { text }]) => awaitsAtTop(text))
    .flatMap(([entry]) => {
      // breadth first over every edge, each module reached once, remembering where from
      const via = new Map<string, string>();
      const queue = [entry];
      const chain = (at: string): string[] =>
        at === entry ? [name(entry)] : [...chain(via.get(at) ?? entry), name(at)];
      const found: string[] = [];
      for (const at of queue) {
        for (const { to, dynamic } of graph.get(at)?.edges ?? []) {
          if (to === entry) {
            if (dynamic) found.push([...chain(at), `import(${name(entry)})`].join(" -> "));
          } else if (graph.has(to) && !via.has(to)) {
            via.set(to, at);
            queue.push(to);
          }
        }
      }
      return found;
    });
}

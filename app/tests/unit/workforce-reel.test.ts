import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import {
  briefId,
  COPY_RULE,
  decidePiece,
  deskPhoto,
  GATE_RULES,
  mediaFor,
  nextReel,
  queueReel,
  reelWork,
  REEL_TOOL_LINE,
  syncPieces,
  withReel,
  REVISIONS,
  reelPass,
  reelRequestSchema,
  reelWorking,
  reviewPrompt,
  scenePrompt,
  shotsFor,
  studioArgs,
  STALE_MS,
  type Brief,
  type ReelDeps,
  type ReelRequest,
} from "../../scripts/workforce/reel.ts";
import { PREVIEW_MAX_BYTES, studioDecisionSchema } from "../../scripts/workforce/studio.ts";
import { mediaRow, propertyRow } from "../fixtures/asset-rows.ts";
import { fakeDb, type FakeDb } from "../fixtures/fake-db.ts";

// W7 item 19, slice E2: a reel request waits in the studio, and one pass makes it end to end or stops and says why.

const from = { agent: "social", thread: "social" };
const brand: ReelRequest = {
  skill: "reel",
  name: "The door",
  kind: "brand",
  titles: ["Not every home", "is accepted."],
};

const recording = (): FakeDb =>
  fakeDb({ rpc: { record_requested_reel: () => "asset-1", studio_piece_put: () => undefined } });

function deps(
  over: Partial<ReelDeps> = {},
  log: string[] = [],
  db: FakeDb = recording(),
): ReelDeps {
  return {
    db,
    download: () => Promise.resolve(new Uint8Array([1])),
    desk: () => new Uint8Array([2]),
    design: (folder) => {
      log.push("design");
      for (const file of ["scene.html", "scene.mjs", "cues.mjs"]) {
        writeFileSync(join(folder, "scene", file), "x");
      }
      return Promise.resolve('{"duration_s": 18}');
    },
    render: (folder) => {
      log.push("render");
      mkdirSync(join(folder, "out"), { recursive: true });
      writeFileSync(join(folder, "out", "reel.mp4"), "video");
      return Promise.resolve({
        mp4: join(folder, "out", "reel.mp4"),
        poster: new Uint8Array([9]),
        gate: { cuts: 4 },
      });
    },
    voice: null,
    review: () => {
      log.push("review");
      return Promise.resolve('Looks right. {"pass": true, "reasons": []}');
    },
    upload: (key) => {
      log.push(`upload ${key}`);
      return Promise.resolve();
    },
    preview: () => new Uint8Array([7, 7]),
    uploadPreview: (key) => {
      log.push(`preview ${key}`);
      return Promise.resolve();
    },
    say: (thread, body) => {
      log.push(`say ${thread}: ${body}`);
      return Promise.resolve();
    },
    tellMatter: (body) => {
      log.push(`matter: ${body}`);
      return Promise.resolve();
    },
    readFile: (path) => readFileSync(path),
    ...over,
  };
}

const studio = () => mkdtempSync(join(tmpdir(), "studio-"));
const briefRead = z.object({ id: z.string() }).passthrough();
const brief = (folder: string) =>
  briefRead.parse(JSON.parse(readFileSync(join(folder, "brief.json"), "utf8")));

describe("a reel request (W7 item 19)", () => {
  it("names the subject its kind needs, and is read from an answer beside a voice-over", () => {
    expect(reelRequestSchema.safeParse({ ...brand, kind: "market" }).success).toBe(false);
    expect(
      reelRequestSchema.safeParse({ ...brand, kind: "market", market: "florida" }).success,
    ).toBe(true);
    expect(reelRequestSchema.safeParse({ ...brand, kind: "campaign" }).success).toBe(false);
    expect(reelRequestSchema.safeParse(brand).success).toBe(true);
    const answer = readJsonAnswer(
      `Done. ${JSON.stringify({ reply: "ok", media: [brand, { skill: "qwen-voiceover", name: "v", lines: ["a"] }] })}`,
    );
    expect(answer.media.map((item) => item.skill)).toEqual(["reel", "qwen-voiceover"]);
  });

  it("waits in its own studio folder, oldest first, one at a time, and a stale one is let go", () => {
    const root = studio();
    const first = queueReel(brand, from, root, new Date("2026-10-15T08:00:00Z"));
    const second = queueReel(brand, from, root, new Date("2026-10-15T09:00:00Z"));
    expect([
      first.endsWith("2026-10-15-the-door"),
      second.endsWith("2026-10-15-the-door-2"),
    ]).toEqual([true, true]);
    expect(nextReel(root)?.folder).toBe(first);
    writeFileSync(
      join(first, "brief.json"),
      JSON.stringify({ ...brief(first), state: "working", started: "2026-10-15T08:00:00Z" }),
    );
    expect(nextReel(root, new Date("2026-10-15T09:00:00Z"))).toBeNull();
    const later = new Date(Date.parse("2026-10-15T08:00:00Z") + STALE_MS + 1);
    expect(nextReel(root, later)?.folder).toBe(second);
    expect(brief(first)).toMatchObject({
      state: "failed",
      reason: "abandoned: the process making it stopped",
    });
  });

  it("lets the designer write in its folder and the reviewer only read, and nothing else (P-3481)", () => {
    const allowed = (role: "designer" | "reviewer") => {
      const args = studioArgs("sonnet", role);
      return [args[args.indexOf("--allowedTools") + 1], args.includes("--restricted")];
    };
    expect(allowed("designer")).toEqual(["Read,Write,Edit,Glob,Grep", true]);
    expect(allowed("reviewer")).toEqual(["Read,Glob,Grep", true]);
    expect(studioArgs("opus", "reviewer")).toContain("Bash,WebFetch,WebSearch,NotebookEdit");
  });

  it("says a reel is being made while a brief is working, and not once it is stale (P-3480)", () => {
    const root = studio();
    expect(reelWorking(root)).toBe(false);
    const folder = queueReel(brand, from, root, new Date("2026-10-15T08:00:00Z"));
    expect(reelWorking(root)).toBe(false);
    writeFileSync(
      join(folder, "brief.json"),
      JSON.stringify({ ...brief(folder), state: "working", started: "2026-10-15T08:00:00Z" }),
    );
    expect(reelWorking(root, new Date("2026-10-15T09:00:00Z"))).toBe(true);
    expect(reelWorking(root, new Date(Date.parse("2026-10-15T08:00:00Z") + STALE_MS + 1))).toBe(
      false,
    );
  });
});

describe("the reel pass", () => {
  it("designs, films, has it reviewed, keeps a draft and uploads nothing until Matter approves it, then uploads under requested/<id>/ and records a pending visual", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const db = recording();
    expect(await reelPass(deps({}, log, db), root)).toBe("reel The door: draft 1");
    expect(log.filter((line) => line.startsWith("upload"))).toEqual([]);
    expect(brief(folder)).toMatchObject({ state: "draft", drafts: 1, film: "drafts/01/reel.mp4" });
    // the folder's name, never the laptop's path with its user name
    expect(log.find((line) => line.includes("waits for Matter's review"))).toContain(
      `(its status.md and drafts are in ${basename(folder)})`,
    );
    expect(
      decidePiece({ skill: "studio", piece: basename(folder), decision: "approve" }, root).ok,
    ).toBe(true);
    expect(await reelPass(deps({}, log, db), root)).toBe("reel The door: done (asset-1)");
    const { id } = brief(folder);
    expect(log.slice(0, 3)).toEqual(["design", "render", "review"]);
    const uploads = log.filter((line) => line.startsWith("upload ")).map((line) => line.slice(7));
    expect(uploads).toEqual([
      expect.stringMatching(new RegExp(`^requested/${id}/reel\\.[0-9a-f]{8}\\.mp4$`)),
      expect.stringMatching(new RegExp(`^requested/${id}/poster\\.[0-9a-f]{8}\\.jpg$`)),
    ]);
    expect(db.calls.filter((call) => call.name === "record_requested_reel")).toMatchObject([
      {
        kind: "rpc",
        name: "record_requested_reel",
        args: [
          {
            p_subject: "brand",
            p_caption: "Not every home is accepted.",
            p_files: [{ role: "video" }, { role: "poster" }],
          },
        ],
      },
    ]);
    expect(brief(folder)).toMatchObject({ state: "done", asset_id: "asset-1" });
    expect(log.at(-1)).toContain("uploaded once, and waits in Visuals");
    expect(existsSync(join(folder, "reference", "DIRECTION.md"))).toBe(true);
  });

  it("uploads nothing and says why when the reviewer refuses it", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const db = recording();
    const refused = deps(
      { review: () => Promise.resolve('{"pass": false, "reasons": ["a title is cut off"]}') },
      log,
      db,
    );
    expect(await reelPass(refused, root)).toBe(
      "reel The door: failed (review_refused: a title is cut off)",
    );
    expect([
      log.some((line) => line.startsWith("upload")),
      db.calls.filter((call) => call.name === "record_requested_reel"),
    ]).toEqual([false, []]);
    expect(brief(folder)).toMatchObject({ state: "failed" });
    expect(log.at(-1)).toContain(
      "was not made: review_refused: a title is cut off. Nothing was uploaded.",
    );
    // the folder's name, never the laptop's path with its user name
    expect(log.at(-1)?.split("Its folder: ")[1]).toBe(basename(folder));
    expect(log.filter((line) => line === "design")).toHaveLength(1 + REVISIONS);
  });

  it("gives the designer the reviewer's refusal, and makes the reel when the revised film is passed", async () => {
    const root = studio();
    queueReel(brand, from, root);
    const log: string[] = [];
    const prompts: string[] = [];
    const base = deps({}, log);
    let reviews = 0;
    const revised = deps(
      {
        design: (folder, prompt) => {
          prompts.push(prompt);
          return base.design(folder, prompt);
        },
        review: () => {
          reviews += 1;
          return Promise.resolve(
            reviews === 1
              ? '{"pass": false, "reasons": ["Frame 2: the title is cut off at the top edge."]}'
              : '{"pass": true, "reasons": []}',
          );
        },
      },
      log,
    );
    expect(await reelPass(revised, root)).toBe("reel The door: draft 2");
    expect([prompts.length, reviews]).toEqual([2, 2]);
    expect(prompts[1]).toContain(
      "a fresh reviewer looking at its stills refused it: review_refused: Frame 2: the title is cut off",
    );
  });

  it("refuses spoken lines before any work while the voice mix is not built", async () => {
    const root = studio();
    queueReel({ ...brand, voice: ["It's a matter of place."] }, from, root);
    const log: string[] = [];
    expect(await reelPass(deps({}, log), root)).toMatch(/^reel The door: failed \(voice_not_ready/);
    expect(log.some((line) => line === "design" || line === "render")).toBe(false);
  });

  it("gives the designer the gate's refusal once, and makes the reel when the second film passes", async () => {
    const root = studio();
    queueReel(brand, from, root);
    const log: string[] = [];
    const prompts: string[] = [];
    const base = deps({}, log);
    let films = 0;
    const revised = deps(
      {
        design: (folder, prompt) => {
          prompts.push(prompt);
          return base.design(folder, prompt);
        },
        render: (folder, spec) => {
          films += 1;
          return films === 1
            ? Promise.reject(new Error("gate_failed: coverage 46.3%"))
            : base.render(folder, spec);
        },
      },
      log,
    );
    expect(await reelPass(revised, root)).toBe("reel The door: draft 2");
    expect([prompts.length, films]).toEqual([2, 2]);
    expect(prompts[1]).toContain("the motion gate refused it: gate_failed: coverage 46.3%");
  });

  it("stops when the film is still refused after its revisions, and uploads nothing", async () => {
    const root = studio();
    queueReel(brand, from, root);
    const log: string[] = [];
    const refused = deps({ render: () => Promise.reject(new Error("gate_failed: cuts 1")) }, log);
    expect(await reelPass(refused, root)).toBe("reel The door: failed (gate_failed: cuts 1)");
    expect(log.filter((line) => line === "design")).toHaveLength(1 + REVISIONS);
    expect(log.some((line) => line.startsWith("upload"))).toBe(false);
  });

  it("tells the designer what the gate measures before the first film", () => {
    expect(GATE_RULES).toMatch(/85% of frames.*1\.0 s.*3 to 8 hard cuts.*-18 LUFS/);
    // the sixth reel cut three times and the gate saw two: the brief says how a cut is measured
    expect(GATE_RULES).toMatch(/scene score over 0\.30: flip the value at every cut/);
    const queued: Brief = {
      id: "8d5f2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f",
      at: "2026-10-15T09:00:00Z",
      request: brand,
      from,
      state: "queued",
    };
    expect(scenePrompt(queued, [])).toContain(GATE_RULES);
  });

  it("keeps the words to the request and teaches the reviewer to read stills from a moving film", () => {
    const queued: Brief = {
      id: "8d5f2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f",
      at: "2026-10-15T09:00:00Z",
      request: brand,
      from,
      state: "queued",
    };
    expect(scenePrompt(queued, [])).toContain(COPY_RULE);
    expect(COPY_RULE).toMatch(/only the requested titles.*No other words/);
    const review = reviewPrompt(queued);
    expect(review).toMatch(/partly risen inside its mask.*is motion, not a fault/);
    expect(review).toMatch(/flat lighter or darker shape.*is not a gradient/);
    expect(review).toContain("words beyond the requested titles and the closing lockup");
  });
});

describe("the subject's own photographs (H110)", () => {
  it("refuses a market reel with fewer than four published properties to show", async () => {
    const ids = ["a", "b", "c"];
    const db = fakeDb({
      tables: {
        properties: ids.map((id) => propertyRow({ id })),
        property_media: ids.map((id) => mediaRow(0, { property_id: id })),
      },
    });
    await expect(shotsFor(db, { ...brand, kind: "market", market: "florida" })).rejects.toThrow(
      "too_few_photos",
    );
  });

  it("takes a campaign's photographs in gallery order and a brand piece none", async () => {
    const db = fakeDb({ tables: { property_media: [mediaRow(2), mediaRow(1)] } });
    const campaign = { ...brand, kind: "campaign" as const, property_id: mediaRow(1).property_id };
    expect((await shotsFor(db, campaign)).map((shot) => shot.key)).toEqual([
      mediaRow(1).media_key,
      mediaRow(2).media_key,
    ]);
    expect(await shotsFor(fakeDb(), brand)).toEqual([]);
  });
});

describe("Social and Campaigns ask for a reel (W7 item 20)", () => {
  const voice = { skill: "qwen-voiceover", name: "v" };
  const reel = { skill: "reel", name: "r" };

  it("takes one reel from a colleague with request_reel, nothing from one without, and Matter's as before", () => {
    expect(mediaFor([voice, reel, reel], false, ["chat", "request_reel"])).toEqual([reel]);
    expect(mediaFor([reel], false, ["chat", "draft_post"])).toEqual([]);
    expect(mediaFor([voice, reel, reel], true, [])).toEqual([voice, reel]);
  });

  it("attaches the run's reel to a post or a plan only, and tells the colleague how to ask", () => {
    const asked = { request_id: "r1", name: "Coast" };
    expect(withReel("social_post", { body: "b" }, asked)).toEqual({ body: "b", reel: asked });
    expect(withReel("campaign_plan", { body: "b" }, asked)).toEqual({ body: "b", reel: asked });
    expect(withReel("reply_inquiry", { body: "b" }, asked)).toEqual({ body: "b" });
    expect(withReel("social_post", { body: "b" }, null)).toEqual({ body: "b" });
    expect(REEL_TOOL_LINE).toMatch(
      /needs motion, ask for a reel.*"skill": "reel".*shown beside your proposal/,
    );
    const folder = queueReel(brand, from, studio());
    expect(briefId(folder)).toBe(brief(folder).id);
  });
});

describe("a reel about a property shows that property's own photographs (H110)", () => {
  const own = {
    ...brand,
    name: "Fairfield",
    kind: "campaign" as const,
    photos: [
      "requests/r1/photos/1-front-from-the-street.jpg",
      "requests/r1/photos/2-entry-stair.jpg",
    ],
  };
  const sceneWith = (text: string): Partial<ReelDeps> => ({
    design: (folder) => {
      for (const file of ["scene.html", "cues.mjs"])
        writeFileSync(join(folder, "scene", file), "x");
      writeFileSync(join(folder, "scene", "scene.mjs"), text);
      return Promise.resolve('{"duration_s": 18}');
    },
  });

  it("takes the photographs of a property not on the site as the request's own, never for a brand piece", () => {
    expect(reelRequestSchema.safeParse(own).success).toBe(true);
    expect(reelRequestSchema.safeParse({ ...own, photos: undefined }).success).toBe(false);
    expect(reelRequestSchema.safeParse({ ...brand, photos: own.photos }).success).toBe(false);
    const property_id = "8d5f2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f";
    expect(
      [
        { ...own, property_id },
        { ...own, kind: "market" as const, market: "florida" as const },
        { ...own, kind: "story" as const, story_id: property_id },
      ].map((request) => reelRequestSchema.safeParse(request).success),
    ).toEqual([false, false, false]);
  });

  it("reads a picture from the requester's own work folder and refuses a path that leaves it or is no picture", () => {
    const home = mkdtempSync(join(tmpdir(), "home-"));
    const work = join(home, ".mop-workforce", "desks", "social", "work");
    mkdirSync(join(work, "requests", "r1", "photos"), { recursive: true });
    writeFileSync(join(work, "requests", "r1", "photos", "1-front.jpg"), "picture");
    writeFileSync(join(work, "requests", "r1", "notes.md"), "notes");
    writeFileSync(join(home, ".mop-workforce", "secret.jpg"), "not yours");
    expect(
      Buffer.from(deskPhoto("social", "requests/r1/photos/1-front.jpg", home)).toString(),
    ).toBe("picture");
    const refused = (agent: string, rel: string) => {
      try {
        deskPhoto(agent, rel, home);
        return "read";
      } catch (failure) {
        return failure instanceof Error ? failure.message.split(":")[0] : "other";
      }
    };
    expect([
      refused("social", "../../../secret.jpg"),
      refused("social", "requests/r1/notes.md"),
      refused("social", "requests/r1/photos"),
      refused("social/../editor", "requests/r1/photos/1-front.jpg"),
      refused("social", "requests/r1/photos/missing.jpg"),
    ]).toEqual([
      "photo_refused",
      "photo_refused",
      "photo_refused",
      "photo_refused",
      "photo_unavailable",
    ]);
  });

  it("films a property reel from the request's pictures, tells the reviewer to look for them, and keeps the film out of Visuals when the property is not on the site", async () => {
    const root = studio();
    const folder = queueReel(own, from, root);
    const log: string[] = [];
    const db = recording();
    const seen: string[] = [];
    const run = deps(
      {
        ...sceneWith("for (const shot of spec.shots) draw(shot.src)"),
        download: () => Promise.reject(new Error("the bucket is for the site's own pictures")),
        desk: (agent, rel) => {
          seen.push(`${agent} ${rel}`);
          return new Uint8Array([3]);
        },
        review: (_folder, _mp4, prompt) => {
          seen.push(prompt);
          return Promise.resolve('{"pass": true, "reasons": []}');
        },
      },
      log,
      db,
    );
    expect(await reelPass(run, root)).toBe("reel Fairfield: draft 1");
    expect(
      decidePiece({ skill: "studio", piece: basename(folder), decision: "approve" }, root).ok,
    ).toBe(true);
    expect(await reelPass(run, root)).toBe("reel Fairfield: done (kept in the studio)");
    expect(seen.slice(0, 2)).toEqual([
      "social requests/r1/photos/1-front-from-the-street.jpg",
      "social requests/r1/photos/2-entry-stair.jpg",
    ]);
    expect(seen[2]).toMatch(
      /2 of the subject's own photographs were supplied.*Refuse it if the stills show none/,
    );
    expect(readFileSync(join(folder, "shots", "0.jpg"))).toEqual(Buffer.from([3]));
    expect([
      db.calls.filter((call) => call.name === "record_requested_reel"),
      log.some((line) => line.startsWith("upload")),
    ]).toEqual([[], false]);
    expect(brief(folder)).toMatchObject({ state: "done", kept: true });
    expect(log.at(-1)).toContain("not on the site, so it is not in Visuals");
  });

  it("sends back a scene that draws none of the photographs, before any film is made", async () => {
    const root = studio();
    queueReel(own, from, root);
    const log: string[] = [];
    const run = deps(sceneWith("drawHouseModel()"), log);
    expect(await reelPass(run, root)).toMatch(
      /^reel Fairfield: failed \(gate_failed: scene\.mjs does not draw spec\.shots/,
    );
    expect(log.filter((line) => line === "render")).toEqual([]);
  });

  it("tells the designer to show the photographs and the reviewer to refuse a drawn house", () => {
    const queued: Brief = {
      id: "8d5f2c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f",
      at: "2026-10-15T09:00:00Z",
      request: own,
      from,
      state: "queued",
    };
    expect(
      scenePrompt(queued, [{ key: "k", alt: "front", orientation: "landscape", file: "0.jpg" }]),
    ).toMatch(/Never draw, model or imitate the house/);
    expect(scenePrompt({ ...queued, request: brand }, [])).not.toMatch(
      /Never draw, model or imitate/,
    );
    expect(reviewPrompt(queued, 5)).toMatch(
      /a drawing or a model of a house stands in for the subject \(a drawn house is not the house\)/,
    );
    expect(reviewPrompt({ ...queued, request: brand })).toMatch(/shows no property's photographs/);
    expect(REEL_TOOL_LINE).toMatch(/"photos".*a "brand" reel never shows a property/);
  });
});

describe("the studio folder (W8 0f)", () => {
  const rpcArgs = (db: FakeDb) =>
    db.calls.filter((call) => call.name === "studio_piece_put").map((call) => call.args[0]);
  const decide = (
    root: string,
    folder: string,
    decision: "approve" | "revise" | "ask_operator",
    note?: string,
  ) =>
    decidePiece(
      {
        skill: "studio",
        piece: basename(folder),
        decision,
        ...(note === undefined ? {} : { note }),
      },
      root,
    );

  it("keeps status.md beside the brief: who, state and next, and every step in its history", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const queued = readFileSync(join(folder, "status.md"), "utf8");
    expect(queued).toContain("# The door");
    expect(queued).toContain("- Who: social, asked in the social thread");
    expect(queued).toContain("- State: queued");
    await reelPass(deps(), root);
    const drafted = readFileSync(join(folder, "status.md"), "utf8");
    expect(drafted).toContain("- State: draft");
    expect(drafted).toContain("- Next: Matter reviews draft 1: approve it, ask for a revision");
    expect(drafted).toMatch(/draft 1 passed the motion gate and the review; it waits for Matter/);
  });

  it("keeps every render as a draft, a refused one with its scene and what refused it", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const base = deps({}, log);
    let films = 0;
    const run = deps(
      {
        render: (where, spec) => {
          films += 1;
          return films === 1
            ? Promise.reject(new Error("gate_failed: coverage 46.3%"))
            : base.render(where, spec);
        },
      },
      log,
    );
    expect(await reelPass(run, root)).toBe("reel The door: draft 2");
    expect(readdirSync(join(folder, "drafts")).sort()).toEqual(["01", "02"]);
    expect(existsSync(join(folder, "drafts", "01", "scene", "scene.mjs"))).toBe(true);
    expect(existsSync(join(folder, "drafts", "01", "reel.mp4"))).toBe(false);
    expect(readdirSync(join(folder, "drafts", "02")).sort()).toEqual([
      "poster.jpg",
      "reel.mp4",
      "scene",
    ]);
    expect(readFileSync(join(folder, "status.md"), "utf8")).toContain(
      "draft 1 refused: gate_failed: coverage 46.3%",
    );
  });

  it("drafts a reel, revises it on Matter's word, approves it, uploads it once, and the row tracks it", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const prompts: string[] = [];
    const db = recording();
    const base = deps({}, log, db);
    const run = deps(
      {
        design: (where, prompt) => {
          prompts.push(prompt);
          return base.design(where, prompt);
        },
      },
      log,
      db,
    );
    expect(await reelPass(run, root)).toBe("reel The door: draft 1");
    // the draft wakes Matter in his own thread, not only the requester's
    expect(log.filter((line) => line.startsWith("matter: "))).toEqual([
      expect.stringContaining('the reel "The door"'),
    ]);
    const revised = decide(root, folder, "revise", "Hold the first title a beat longer.");
    expect(revised.ok).toBe(true);
    expect(revised.line).toContain("goes back to the designer");
    expect(brief(folder)).toMatchObject({
      state: "queued",
      revise: "Hold the first title a beat longer.",
    });
    expect(await reelPass(run, root)).toBe("reel The door: draft 2");
    expect(prompts[1]).toContain("Hold the first title a beat longer.");
    expect(brief(folder)).toMatchObject({ state: "draft", drafts: 2, film: "drafts/02/reel.mp4" });
    expect(brief(folder)["revise"]).toBeUndefined();
    // nothing has left the laptop yet
    expect(log.filter((line) => /^(upload|preview) /.test(line))).toEqual([]);
    expect(db.calls.some((call) => call.name === "record_requested_reel")).toBe(false);

    expect(reelWork(root)).toBe(false);
    expect(decide(root, folder, "approve").ok).toBe(true);
    // an approved piece is work of its own; the pass itself writes its row (W8 0f review: no sync by hand)
    expect(reelWork(root)).toBe(true);
    expect(await reelPass(run, root)).toBe("reel The door: done (asset-1)");
    const { id } = brief(folder);
    const uploads = log.filter((line) => line.startsWith("upload ")).map((line) => line.slice(7));
    expect(uploads).toEqual([
      expect.stringMatching(new RegExp(`^requested/${id}/reel\\.[0-9a-f]{8}\\.mp4$`)),
      expect.stringMatching(new RegExp(`^requested/${id}/poster\\.[0-9a-f]{8}\\.jpg$`)),
    ]);
    // a later pass finds nothing to do and uploads nothing again
    expect(await reelPass(run, root)).toBeNull();
    expect(log.filter((line) => line.startsWith("upload "))).toHaveLength(2);
    expect(db.calls.filter((call) => call.name === "record_requested_reel")).toHaveLength(1);
    // the row followed the folder as the runner writes it, at the start of each pass, while the piece is made and at its
    // end: queued, working, draft; queued for the revision, working, draft; approved, done with the visual it became
    expect(rpcArgs(db)).toMatchObject([
      { p_state: "queued" },
      { p_state: "working" },
      { p_state: "draft" },
      { p_state: "queued" },
      { p_state: "working" },
      { p_state: "draft" },
      { p_state: "approved" },
      { p_state: "done" },
    ]);
    expect(rpcArgs(db).at(-1)).toMatchObject({
      p_id: id,
      p_title: "The door",
      p_owner: "social",
      p_folder: basename(folder),
      p_state: "done",
      p_asset_id: "asset-1",
    });
  });

  it("counts an approved piece as work of its own, even with its row in step", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const db = recording();
    await reelPass(deps({}, [], db), root);
    expect(decide(root, folder, "approve").ok).toBe(true);
    // nothing is out of step any more, so only the approval itself can make it work
    await syncPieces(db, root);
    expect(reelWork(root)).toBe(true);
  });

  it("keeps a recorded visual done when its thread line fails, so approving again records nothing more", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const db = recording();
    await reelPass(deps({}, [], db), root);
    expect(decide(root, folder, "approve").ok).toBe(true);
    const silent = deps({ say: () => Promise.reject(new Error("thread down")) }, [], db);
    expect(await reelPass(silent, root)).toBe(
      "reel The door: done (asset-1) (its thread line was not written)",
    );
    expect(brief(folder)).toMatchObject({ state: "done", asset_id: "asset-1" });
    expect(decide(root, folder, "approve").ok).toBe(false);
    expect(db.calls.filter((call) => call.name === "record_requested_reel")).toHaveLength(1);
  });

  it("holds a draft for the operator: only a small still goes to Storage, and approval still follows", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const db = recording();
    const run = deps({}, log, db);
    await reelPass(run, root);
    expect(
      decide(root, folder, "ask_operator", "Is the second title right for this owner?").ok,
    ).toBe(true);
    expect(brief(folder)).toMatchObject({ state: "waiting_operator" });
    // with its row in step, a piece waiting for its preview is work of its own
    await syncPieces(db, root);
    expect(reelWork(root)).toBe(true);
    expect(await reelPass(run, root)).toBe("reel The door: preview uploaded");
    const { id } = brief(folder);
    expect(log.filter((line) => line.startsWith("upload "))).toEqual([]);
    expect(log.filter((line) => line.startsWith("preview "))).toEqual([
      expect.stringMatching(new RegExp(`^preview studio/${id}/preview\\.[0-9a-f]{8}\\.jpg$`)),
    ]);
    const held = rpcArgs(db).at(-1);
    expect(held).toMatchObject({ p_state: "waiting_operator" });
    expect(z.object({ p_preview_key: z.string() }).parse(held).p_preview_key).toMatch(/^studio\//);
    expect(readFileSync(join(folder, "status.md"), "utf8")).toContain(
      "Waits for the operator (Is the second title right for this owner?)",
    );
    // one preview, not one a minute
    expect(await reelPass(run, root)).toBeNull();
    expect(log.filter((line) => line.startsWith("preview "))).toHaveLength(1);
    // the operator's word reaches the piece through Matter: now it uploads, once
    expect(decide(root, folder, "approve").ok).toBe(true);
    expect(await reelPass(run, root)).toBe("reel The door: done (asset-1)");
    expect(brief(folder)["preview"]).toBeUndefined();
  });

  it("sends no preview that is not small, and does not try again every minute", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const run = deps({ preview: () => new Uint8Array(PREVIEW_MAX_BYTES + 1) }, log);
    await reelPass(run, root);
    decide(root, folder, "ask_operator", "A question.");
    expect(await reelPass(run, root)).toBe("reel The door: no preview (preview_too_large)");
    expect(log.some((line) => line.startsWith("preview "))).toBe(false);
    expect(brief(folder)).toMatchObject({
      state: "waiting_operator",
      preview_error: "preview_too_large",
    });
    expect(await reelPass(run, root)).toBeNull();
  });

  it("refuses a decision on no piece, outside the studio, in the wrong state, or without a draft", () => {
    // a piece that could take the decision, one folder above the studio: a name that climbs to it is refused
    const outer = studio();
    const decoy = queueReel(brand, from, outer);
    writeFileSync(
      join(decoy, "brief.json"),
      JSON.stringify({ ...brief(decoy), state: "failed", reason: "x" }),
    );
    const root = join(outer, "pieces");
    mkdirSync(root);
    const folder = queueReel(brand, from, root);
    const refused = (piece: string, decision: "approve" | "revise" | "ask_operator") =>
      decidePiece({ skill: "studio", piece, decision, note: "n" }, root);
    expect(refused("nothing-here", "approve")).toEqual({
      ok: false,
      line: 'There is no piece "nothing-here" in the studio.',
    });
    expect(refused("..", "approve").ok).toBe(false);
    expect(refused(`../${basename(decoy)}`, "revise").ok).toBe(false);
    expect(brief(decoy)).toMatchObject({ state: "failed" });
    expect(refused(basename(folder), "approve")).toMatchObject({
      ok: false,
      line: 'The piece "The door" is queued, so it cannot be approved now.',
    });
    // a piece that failed before it had a draft has nothing to approve, but can be sent back
    writeFileSync(
      join(folder, "brief.json"),
      JSON.stringify({ ...brief(folder), state: "failed", reason: "scene_missing: scene.html" }),
    );
    expect(refused(basename(folder), "approve")).toEqual({
      ok: false,
      line: 'The piece "The door" has no finished draft to approve.',
    });
    expect(refused(basename(folder), "ask_operator").ok).toBe(false);
    expect(refused(basename(folder), "revise").ok).toBe(true);
    expect(brief(folder)).toMatchObject({ state: "queued" });
    expect(brief(folder)["reason"]).toBeUndefined();
  });

  it("reads a decision only whole: a revision or a question needs its note, and a piece is a folder name", () => {
    const ok = (value: unknown) => studioDecisionSchema.safeParse(value).success;
    expect(ok({ skill: "studio", piece: "2026-10-16-the-door", decision: "approve" })).toBe(true);
    expect(ok({ skill: "studio", piece: "2026-10-16-the-door", decision: "revise" })).toBe(false);
    expect(ok({ skill: "studio", piece: "x", decision: "ask_operator" })).toBe(false);
    expect(ok({ skill: "studio", piece: "../desks", decision: "approve" })).toBe(false);
    expect(ok({ skill: "studio", piece: "a/b", decision: "approve" })).toBe(false);
    const answer = readJsonAnswer(
      `Reviewed. ${JSON.stringify({ reply: "ok", media: [{ skill: "studio", piece: "p1", decision: "approve" }] })}`,
    );
    expect(answer.media).toEqual([{ skill: "studio", piece: "p1", decision: "approve" }]);
  });

  it("keeps the decision on a draft to Matter: a colleague asking for a reel gets no studio entry through", () => {
    const decision = { skill: "studio", piece: "p1" };
    const reel = { skill: "reel", name: "r" };
    expect(mediaFor([decision, reel], false, ["chat", "request_reel"])).toEqual([reel]);
    expect(mediaFor([decision], false, ["chat", "request_reel"])).toEqual([]);
    expect(mediaFor([decision, reel], true, [])).toEqual([decision, reel]);
  });

  it("writes a row only when the folder changed, names a row it could not write, and tries it again later", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    writeFileSync(
      join(folder, "brief.json"),
      JSON.stringify({ ...brief(folder), state: "done", asset_id: "asset-9" }),
    );
    const at = new Date("2026-10-19T10:00:00Z");
    expect(reelWork(root, at)).toBe(true);
    const failing = fakeDb({
      rpc: { studio_piece_put: () => new Error("relation does not exist") },
    });
    expect(await syncPieces(failing, root, at)).toEqual([
      `${basename(folder)}: studio_row_failed: relation does not exist`,
    ]);
    expect(reelWork(root, new Date(at.getTime() + 60_000))).toBe(false);
    expect(await syncPieces(failing, root, new Date(at.getTime() + 60_000))).toEqual([]);
    expect(failing.calls).toHaveLength(1);
    const later = new Date(at.getTime() + 11 * 60_000);
    expect(reelWork(root, later)).toBe(true);
    const working = recording();
    expect(await syncPieces(working, root, later)).toEqual([]);
    expect(reelWork(root, later)).toBe(false);
    expect(await syncPieces(working, root, later)).toEqual([]);
    expect(rpcArgs(working)).toEqual([
      expect.objectContaining({
        p_state: "done",
        p_asset_id: "asset-9",
        p_folder: basename(folder),
      }),
    ]);
  });

  it("keeps a decision made while the row was being written, and writes the row again for it", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    await reelPass(deps(), root);
    // Matter approves while the pass's write of the draft's row is still on its way
    const racing = fakeDb({
      rpc: {
        studio_piece_put: () => {
          decide(root, folder, "approve");
          return undefined;
        },
      },
    });
    writeFileSync(
      join(folder, "brief.json"),
      JSON.stringify({ ...brief(folder), synced: undefined }),
    );
    expect(await syncPieces(racing, root)).toEqual([]);
    expect(brief(folder)).toMatchObject({ state: "approved" });
    // the row said "draft", so the next pass writes "approved"
    const next = recording();
    expect(await syncPieces(next, root)).toEqual([]);
    expect(rpcArgs(next)).toMatchObject([{ p_state: "approved" }]);
  });

  it("does not put a preview into a piece that was decided while the still was going up", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    await reelPass(deps({}, log), root);
    decide(root, folder, "ask_operator", "A question.");
    const run = deps(
      {
        uploadPreview: () => {
          decide(root, folder, "approve");
          return Promise.resolve();
        },
      },
      log,
    );
    expect(await reelPass(run, root)).toBe("reel The door: preview uploaded");
    expect(brief(folder)["preview"]).toBeUndefined();
    expect(brief(folder)).toMatchObject({ state: "approved" });
    // the approval was kept, and the next pass uploads the film once
    expect(await reelPass(run, root)).toBe("reel The door: done (asset-1)");
  });

  it("stops a pass at an approved piece whose draft is missing, and says so without uploading", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    writeFileSync(
      join(folder, "brief.json"),
      JSON.stringify({ ...brief(folder), state: "approved" }),
    );
    expect(await reelPass(deps({}, log), root)).toMatch(/^reel The door: upload failed \(no_draft/);
    expect(log.some((line) => line.startsWith("upload"))).toBe(false);
    expect(log.at(-1)).toContain("was approved but not uploaded");
    expect(log.at(-1)?.split("Its folder: ")[1]).toBe(basename(folder));
    expect(brief(folder)).toMatchObject({ state: "failed" });
  });
});

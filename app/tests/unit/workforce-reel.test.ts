import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import {
  briefId,
  COPY_RULE,
  deskPhoto,
  GATE_RULES,
  mediaFor,
  nextReel,
  queueReel,
  REEL_TOOL_LINE,
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

const recording = (): FakeDb => fakeDb({ rpc: { record_requested_reel: () => "asset-1" } });

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
    say: (thread, body) => {
      log.push(`say ${thread}: ${body}`);
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

  it("names an MCP config outside the studio, written afresh on every use (review of 2026-10-19)", () => {
    const home = mkdtempSync(join(tmpdir(), "reel-mcp-"));
    // what a run could have planted where the config lives
    writeFileSync(
      join(home, "studio-no-mcp.json"),
      JSON.stringify({ mcpServers: { planted: { command: "x" } } }),
    );
    const args = studioArgs("sonnet", "designer", home);
    const file = args[args.indexOf("--mcp-config") + 1] ?? "";
    expect(file).toBe(join(home, "studio-no-mcp.json"));
    expect(relative(join(home, "studio"), file).startsWith("..")).toBe(true);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ mcpServers: {} });
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
  it("designs, films, has it reviewed, uploads under requested/<id>/ and records a pending visual", async () => {
    const root = studio();
    const folder = queueReel(brand, from, root);
    const log: string[] = [];
    const db = recording();
    expect(await reelPass(deps({}, log, db), root)).toBe("reel The door: done (asset-1)");
    const { id } = brief(folder);
    expect(log.slice(0, 3)).toEqual(["design", "render", "review"]);
    const uploads = log.filter((line) => line.startsWith("upload ")).map((line) => line.slice(7));
    expect(uploads).toEqual([
      expect.stringMatching(new RegExp(`^requested/${id}/reel\\.[0-9a-f]{8}\\.mp4$`)),
      expect.stringMatching(new RegExp(`^requested/${id}/poster\\.[0-9a-f]{8}\\.jpg$`)),
    ]);
    expect(db.calls).toMatchObject([
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
    expect(log.at(-1)).toContain("waits in Visuals");
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
    expect([log.some((line) => line.startsWith("upload")), db.calls]).toEqual([false, []]);
    expect(brief(folder)).toMatchObject({ state: "failed" });
    expect(log.at(-1)).toContain(
      "was not made: review_refused: a title is cut off. Nothing was uploaded.",
    );
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
    expect(await reelPass(revised, root)).toBe("reel The door: done (asset-1)");
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
    expect(await reelPass(revised, root)).toBe("reel The door: done (asset-1)");
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
    expect(await reelPass(run, root)).toBe("reel Fairfield: done (kept in the studio)");
    expect(seen.slice(0, 2)).toEqual([
      "social requests/r1/photos/1-front-from-the-street.jpg",
      "social requests/r1/photos/2-entry-stair.jpg",
    ]);
    expect(seen[2]).toMatch(
      /2 of the subject's own photographs were supplied.*Refuse it if the stills show none/,
    );
    expect(readFileSync(join(folder, "shots", "0.jpg"))).toEqual(Buffer.from([3]));
    expect([db.calls, log.some((line) => line.startsWith("upload"))]).toEqual([[], false]);
    expect(brief(folder)).toMatchObject({ state: "done" });
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

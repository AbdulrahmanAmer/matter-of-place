import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonAnswer } from "../../scripts/workforce/answer.ts";
import {
  nextReel,
  queueReel,
  reelPass,
  reelRequestSchema,
  shotsFor,
  STALE_MS,
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
  });

  it("refuses spoken lines before any work while the voice mix is not built", async () => {
    const root = studio();
    queueReel({ ...brand, voice: ["It's a matter of place."] }, from, root);
    const log: string[] = [];
    expect(await reelPass(deps({}, log), root)).toMatch(/^reel The door: failed \(voice_not_ready/);
    expect(log.some((line) => line === "design" || line === "render")).toBe(false);
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

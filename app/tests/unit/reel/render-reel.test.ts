// B12 step 7: the step `render_reel`. A fake database answers the rows and records every call; a fetch stub takes the
// one render.yml dispatch (R50). Invariants 1, 8 and 9 of the plan, SEC-02, R28.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Tables } from "../../../src/db";
import { buildReelSpec } from "../../../src/server/assets/reel-spec";
import { specHash } from "../../../src/server/assets/spec";
import { getStep } from "../../../src/server/jobs/steps/index";
import type { StepDefinition } from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  ASSET_ID,
  JOB_ID,
  NOW,
  PROPERTY_ID,
  VARIANTS,
  assetRow,
  context,
  dispatchedJob,
  mediaRow,
  propertyRow,
  stubDispatch,
} from "../../fixtures/asset-rows";
import { fakeDb, type FakeDb } from "../../fixtures/fake-db";

const DISPATCH_LIMIT = 65_535;
const DATA = { property_id: PROPERTY_ID, slug: "oak-hill", tier: "Campaign", market: "california" };
const campaign = propertyRow({ campaign_tier: "Campaign" });
const gallery = (count: number) => Array.from({ length: count }, (_, n) => mediaRow(n));

let spy: ReturnType<typeof stubDispatch>;

beforeEach(() => {
  spy = stubDispatch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function step(): StepDefinition {
  const found = getStep("render_reel");
  if (found === undefined) throw new Error("no step render_reel");
  return found;
}

interface ReelRows {
  property?: Tables<"properties">;
  media?: Tables<"property_media">[];
  asset?: Tables<"assets">;
}

function reelDb(rows: ReelRows = {}): FakeDb {
  return fakeDb({
    rpc: { upsert_asset_stub: () => rows.asset ?? assetRow({ kind: "reel" }) },
    tables: { properties: [rows.property ?? campaign], property_media: rows.media ?? gallery(6) },
  });
}

const run = (db: FakeDb, data: Record<string, unknown> = DATA) =>
  step().run(context(db, "render_reel"), {}, { ...DATA, ...data });
const rpcNames = (db: FakeDb) => db.calls.filter((c) => c.kind === "rpc").map((c) => c.name);

const dispatchedData = z.object({
  spec: z.object({ kind: z.literal("reel"), shots: z.array(z.object({ key: z.string() })) }),
  spec_hash: z.string(),
  revision: z.number(),
  asset_id: z.string(),
});

describe("render_reel run", () => {
  it("getStep returns a heavy module with onResult", () => {
    expect(step()).toMatchObject({ type: "render_reel", heavy: true });
    expect(typeof step().onResult).toBe("function");
  });

  it("refuses a Feature property by campaign_tier although the job says Campaign", async () => {
    const db = reelDb({ property: propertyRow({ campaign_tier: "Feature" }) });
    await expect(run(db)).rejects.toThrow(new NonRetryableError("not_campaign"));
    expect(rpcNames(db)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses an unpublished Campaign property", async () => {
    const db = reelDb({
      property: propertyRow({ campaign_tier: "Campaign", editorial_state: "archived" }),
    });
    await expect(run(db)).rejects.toThrow(new NonRetryableError("not_published"));
    expect(rpcNames(db)).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("upserts the reel stub with its job id and dispatches spec, hash, revision and asset id", async () => {
    const db = reelDb({ media: gallery(40) });
    const result = await run(db);
    expect(db.calls.find((c) => c.name === "upsert_asset_stub")?.args).toEqual([
      { p_property: PROPERTY_ID, p_kind: "reel", p_job_id: JOB_ID },
    ]);
    const job = dispatchedJob(spy);
    const data = dispatchedData.parse(job.payload.data);
    const hash = await specHash(buildReelSpec(campaign, gallery(40)));
    expect(data).toMatchObject({ spec_hash: hash, revision: 1, asset_id: ASSET_ID });
    expect(data.spec.shots).toHaveLength(10);
    expect(result).toEqual({
      status: "dispatched",
      result: { spec: job.payload.data["spec"], spec_hash: hash, revision: 1, asset_id: ASSET_ID },
    });
    expect(JSON.stringify(job).length).toBeLessThan(DISPATCH_LIMIT);
  });

  it("a recipe job whose stub is approved ends already_approved and dispatches nothing", async () => {
    const db = reelDb({ asset: assetRow({ kind: "reel", status: "approved" }) });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "already_approved" } });
    expect(rpcNames(db)).toEqual(["upsert_asset_stub"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a re-render job with data.revision dispatches even when a stub is approved", async () => {
    const db = reelDb({ asset: assetRow({ kind: "reel", status: "approved", revision: 2 }) });
    expect(await run(db, { revision: 2 })).toMatchObject({ status: "dispatched" });
    expect(db.calls.find((c) => c.name === "upsert_asset_stub")?.args).toEqual([
      { p_property: PROPERTY_ID, p_kind: "reel", p_job_id: JOB_ID, p_revision: 2 },
    ]);
    expect(dispatchedJob(spy).payload.data["revision"]).toBe(2);
  });

  it("three photographs end in too_few_photos without waiting for a size", async () => {
    const db = reelDb({ media: [...gallery(2), mediaRow(2, { variants: {} })] });
    await expect(run(db)).rejects.toThrow(new NonRetryableError("too_few_photos"));
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    { size: "hero", variants: { carousel: VARIANTS.carousel } },
    { size: "carousel", variants: { hero: VARIANTS.hero } },
  ])("waits two minutes for the $size size and keeps its attempts", async ({ variants }) => {
    const db = reelDb({ media: [...gallery(4), mediaRow(4, { variants })] });
    const ctx = context(db, "render_reel");
    const result = await step().run(ctx, {}, DATA);
    expect(result).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 2 * 60 * 1000),
      reason: "variants_pending",
    });
    expect(ctx.job.attempts).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ends in variants_missing when its stub is older than 60 minutes", async () => {
    const created_at = new Date(NOW.getTime() - 61 * 60 * 1000).toISOString();
    const db = reelDb({
      asset: assetRow({ kind: "reel", created_at }),
      media: [...gallery(4), mediaRow(4, { variants: {} })],
    });
    await expect(run(db)).rejects.toThrow(new NonRetryableError("variants_missing"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("render_reel runs twice without a second outside effect", async () => {
    const ctx = context(reelDb(), "render_reel");
    await step().run(ctx, {}, DATA);
    await step().run(ctx, {}, DATA);
    expect(dispatchedJob(spy, 1)).toEqual(dispatchedJob(spy, 0));
    expect(dispatchedJob(spy, 0).job_id).toBe(JOB_ID);
  });
});

describe("render_reel onResult", () => {
  const HASH = "a".repeat(64);
  const files = [
    {
      role: "video",
      media_key: `assets/${PROPERTY_ID}/reel/r1/reel.bbbbbbbb.mp4`,
      w: 1080,
      h: 1920,
      bytes: 9_000_000,
    },
    {
      role: "poster",
      media_key: `assets/${PROPERTY_ID}/reel/r1/poster.bbbbbbbb.jpg`,
      w: 1080,
      h: 1920,
      bytes: 200_000,
    },
  ];
  const gate = {
    coverage: 0.97,
    longest_static_s: 0.6,
    cuts: 5,
    avg_shot_s: 3.1,
    lufs: -18.2,
    true_peak: -1.4,
    flatness: 0.31,
  };
  // The render's meta carries a hash of its own, so a step that took it from there would write the wrong one.
  const rendered = { files, meta: { duration_s: 18, fps: 30, gate, spec_hash: "m".repeat(64) } };
  const dispatched = { spec_hash: HASH, revision: 1, asset_id: ASSET_ID };

  interface StoredAsset {
    status: string;
    caption: string | null;
    alt_text: string | null;
    render_error: string | null;
    files: unknown;
    meta: Record<string, unknown>;
  }

  /** The asset row as the two SQL functions change it: files and hash, then text with a null keeping the stored value. */
  function assetStore(): { db: FakeDb; row: () => StoredAsset } {
    const row: StoredAsset = {
      status: "pending",
      caption: "A house above the water.",
      alt_text: "A white house over the bay.",
      render_error: "gate_failed: cuts 2",
      files: [],
      meta: { captions: { instagram: "A house above the water." } },
    };
    const db = fakeDb({
      rpc: {
        set_asset_files: ({ p_files, p_spec_hash }) => {
          Object.assign(row, { files: p_files, render_error: null });
          row.meta["spec_hash"] = p_spec_hash;
          return undefined;
        },
        set_asset_text: ({ p_caption, p_alt_text, p_meta }) => {
          row.caption = p_caption ?? row.caption;
          row.alt_text = p_alt_text ?? row.alt_text;
          Object.assign(row.meta, z.record(z.string(), z.unknown()).parse(p_meta ?? {}));
          return undefined;
        },
      },
    });
    return { db, row: () => row };
  }

  const callback = (db: FakeDb) => {
    const ctx = context(db, "render_reel");
    return step().onResult?.(ctx, { ...ctx.job, result: dispatched }, rendered);
  };

  it("writes the files with the dispatched hash, then the numbers, and calls nothing else", async () => {
    const { db } = assetStore();
    await callback(db);
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "set_asset_files",
        args: [{ p_asset: ASSET_ID, p_files: files, p_spec_hash: HASH }],
      },
      {
        kind: "rpc",
        name: "set_asset_text",
        args: [{ p_asset: ASSET_ID, p_meta: { duration_s: 18, fps: 30, gate } }],
      },
    ]);
  });

  it("takes spec_hash from the dispatched job, not from the render's meta", async () => {
    const { db, row } = assetStore();
    await callback(db);
    expect(row().meta).toMatchObject({ spec_hash: HASH });
  });

  it("leaves the asset pending with its caption and alt text, clears render_error, posts nothing", async () => {
    const { db, row } = assetStore();
    await callback(db);
    expect(row()).toMatchObject({
      status: "pending",
      caption: "A house above the water.",
      alt_text: "A white house over the bay.",
      render_error: null,
      files,
      meta: {
        captions: { instagram: "A house above the water." },
        spec_hash: HASH,
        duration_s: 18,
        fps: 30,
        gate,
      },
    });
    expect(db.calls.filter((c) => c.kind !== "rpc" || !c.name.startsWith("set_asset_"))).toEqual(
      [],
    );
  });

  it("refuses a render with no duration before it writes", async () => {
    const { db } = assetStore();
    const ctx = context(db, "render_reel");
    await expect(
      step().onResult?.(
        ctx,
        { ...ctx.job, result: dispatched },
        { files, meta: { fps: 30, gate } },
      ),
    ).rejects.toThrow();
    expect(db.calls).toEqual([]);
  });
});

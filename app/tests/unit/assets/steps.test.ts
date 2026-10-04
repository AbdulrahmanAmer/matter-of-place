// B9 step 8: the five render steps in the registry. A fake database answers the rows and records every call; a fetch
// stub takes the one render.yml dispatch (R50). Invariants 1, 10, 11 and 12 of the plan, G62, JOB-03, SEC-02.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Tables } from "../../../src/db";
import { ogStaticKeys, type AssetKind } from "../../../src/domain/assets";
import { propertyLink } from "../../../src/server/assets/links";
import { mediaUrl } from "../../../src/server/lib/media-store";
import { runWriteCaptions } from "../../../src/server/jobs/steps/write-captions";
import { getStep } from "../../../src/server/jobs/steps/index";
import type { JsonObject, StepDefinition } from "../../../src/server/jobs/types";
import { NonRetryableError } from "../../../src/server/jobs/types";
import {
  ASSET_ID,
  JOB_ID,
  MEDIA_BASE,
  NOW,
  PROPERTY_ID,
  VARIANTS,
  assetRow,
  context,
  dispatchedJob,
  mediaRow,
  propertyRow,
  stagedRow,
  stubDispatch,
} from "../../fixtures/asset-rows";
import { fakeDb, type FakeCall, type FakeDb, type FakeDbOptions } from "../../fixtures/fake-db";

const DISPATCH_LIMIT = 65_535;
const DATA = {
  property_id: PROPERTY_ID,
  slug: "oak-hill",
  tier: "Editorial",
  market: "california",
};

let spy: ReturnType<typeof stubDispatch>;

beforeEach(() => {
  spy = stubDispatch();
  vi.stubEnv("MEDIA_PUBLIC_BASE", MEDIA_BASE);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function step(type: string): StepDefinition {
  const found = getStep(type);
  if (found === undefined) throw new Error(`no step ${type}`);
  return found;
}

const names = (db: FakeDb): string[] => db.calls.map((call) => `${call.kind}:${call.name}`);
const argsOf = (call: FakeCall | undefined): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(call?.args[0]);
const rpcCall = (db: FakeDb, name: string) =>
  db.calls.filter((call) => call.kind === "rpc" && call.name === name);

interface RenderRows {
  property?: ReturnType<typeof propertyRow>;
  media?: ReturnType<typeof mediaRow>[];
  asset?: ReturnType<typeof assetRow>;
  assets?: ReturnType<typeof assetRow>[];
}

function renderDb(rows: RenderRows = {}): FakeDb {
  return fakeDb({
    rpc: {
      upsert_asset_stub: () => rows.asset ?? assetRow(),
      set_asset_text: () => undefined,
    },
    tables: {
      properties: [rows.property ?? propertyRow()],
      property_media: rows.media ?? [mediaRow(0), mediaRow(1), mediaRow(2)],
      assets: rows.assets ?? [],
    },
  });
}

const gallery = (count: number) => Array.from({ length: count }, (_, n) => mediaRow(n));

const renderTypes = [
  { type: "render_cover", kind: "cover" },
  { type: "render_carousel", kind: "carousel" },
  { type: "render_story", kind: "story" },
] as const;

describe("the registry", () => {
  it.each([
    "render_variants",
    "render_cover",
    "render_carousel",
    "render_story",
    "render_og_static",
  ])("getStep returns a heavy module for %s", (type) => {
    const found = step(type);
    expect(found.type).toBe(type);
    expect(found.heavy).toBe(true);
    expect(typeof found.onResult).toBe("function");
  });
});

describe("the render steps", () => {
  it.each(renderTypes)(
    "$type dispatches the spec and its hash for the asset stub",
    async ({ type, kind }) => {
      const db = renderDb({ asset: assetRow({ kind }) });
      const result = await step(type).run(context(db, type), {}, DATA);
      const job = dispatchedJob(spy);
      const data = z
        .object({
          spec: z.object({
            kind: z.string(),
            images: z.array(z.object({ url: z.string() })),
            out: z.object({ key_prefix: z.string() }),
          }),
          spec_hash: z.string(),
          revision: z.number(),
          asset_id: z.string(),
        })
        .parse(job.payload.data);
      expect(data.spec.kind).toBe(kind);
      expect(data.spec.out.key_prefix).toBe(`assets/${PROPERTY_ID}/${kind}/r1/`);
      expect(data.spec.images[0]?.url.startsWith(`${MEDIA_BASE}/v/oak-hill/0-aaaaaaaa/`)).toBe(
        true,
      );
      expect(data.spec_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(data).toMatchObject({ revision: 1, asset_id: ASSET_ID });
      expect(result).toEqual({
        status: "dispatched",
        result: expect.objectContaining({
          spec_hash: data.spec_hash,
          revision: 1,
          asset_id: ASSET_ID,
        }) as unknown,
      });
      expect(rpcCall(db, "upsert_asset_stub")[0]?.args).toEqual([
        { p_property: PROPERTY_ID, p_kind: kind, p_job_id: JOB_ID },
      ]);
    },
  );

  it.each(renderTypes)(
    "$type keeps its serialized job under the dispatch limit for 40 photographs",
    async ({ type, kind }) => {
      const db = renderDb({ asset: assetRow({ kind }), media: gallery(40) });
      await step(type).run(context(db, type), {}, DATA);
      expect(JSON.stringify(dispatchedJob(spy)).length).toBeLessThan(DISPATCH_LIMIT);
    },
  );

  it.each(renderTypes)(
    "$type refuses an unpublished property and dispatches nothing",
    async ({ type }) => {
      const db = renderDb({ property: propertyRow({ editorial_state: "archived" }) });
      const result = await step(type).run(context(db, type), {}, DATA);
      expect(result).toEqual({ status: "done", result: { skipped: "not_published" } });
      expect(spy).not.toHaveBeenCalled();
      expect(rpcCall(db, "upsert_asset_stub")).toHaveLength(0);
    },
  );

  it("render_cover stops on a property row with no price", async () => {
    const db = renderDb({ property: propertyRow({ price: null }) });
    await expect(step("render_cover").run(context(db, "render_cover"), {}, DATA)).rejects.toThrow(
      new NonRetryableError("publish_incomplete"),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("render_cover names a missing property and a missing property id", async () => {
    const empty = fakeDb({ tables: { properties: [] } });
    await expect(
      step("render_cover").run(context(empty, "render_cover"), {}, DATA),
    ).rejects.toThrow(new NonRetryableError("property_not_found"));
    await expect(
      step("render_cover").run(context(renderDb(), "render_cover"), {}, {}),
    ).rejects.toThrow(new NonRetryableError("property_id_missing"));
  });

  it.each(renderTypes)(
    "$type waits two minutes for a photograph that lacks the size",
    async ({ type, kind }) => {
      const stale = mediaRow(1, { variants: { hero: VARIANTS.hero } });
      const db = renderDb({ asset: assetRow({ kind }), media: [mediaRow(0), stale] });
      const result = await step(type).run(context(db, type), {}, DATA);
      expect(result).toEqual({
        status: "retry_at",
        at: new Date(NOW.getTime() + 2 * 60 * 1000),
        reason: "variants_pending",
      });
      expect(spy).not.toHaveBeenCalled();
      expect(names(db)).not.toContain("rpc:set_asset_files");
    },
  );

  it("render_cover ends in variants_missing when its stub is older than 60 minutes and still waits before", async () => {
    const stale = mediaRow(1, { variants: {} });
    const old = assetRow({ created_at: new Date(NOW.getTime() - 61 * 60 * 1000).toISOString() });
    const young = assetRow({ created_at: new Date(NOW.getTime() - 59 * 60 * 1000).toISOString() });
    await expect(
      step("render_cover").run(
        context(renderDb({ asset: old, media: [stale] }), "render_cover"),
        {},
        DATA,
      ),
    ).rejects.toThrow(new NonRetryableError("variants_missing"));
    const waiting = await step("render_cover").run(
      context(renderDb({ asset: young, media: [stale] }), "render_cover"),
      {},
      DATA,
    );
    expect(waiting).toMatchObject({ status: "retry_at", reason: "variants_pending" });
  });

  it.each(renderTypes)(
    "$type throws media_public_base_missing and dispatches nothing without MEDIA_PUBLIC_BASE",
    async ({ type, kind }) => {
      vi.stubEnv("MEDIA_PUBLIC_BASE", undefined);
      const db = renderDb({ asset: assetRow({ kind }) });
      await expect(step(type).run(context(db, type), {}, DATA)).rejects.toThrow(
        new NonRetryableError("media_public_base_missing"),
      );
      expect(spy).not.toHaveBeenCalled();
    },
  );

  it.each(renderTypes)("approved $type untouched by a second publish", async ({ type, kind }) => {
    const db = renderDb({ asset: assetRow({ kind, status: "approved" }) });
    const result = await step(type).run(context(db, type), {}, DATA);
    expect(result).toEqual({ status: "done", result: { skipped: "already_approved" } });
    expect(spy).not.toHaveBeenCalled();
    expect(names(db).filter((name) => name.startsWith("rpc:"))).toEqual(["rpc:upsert_asset_stub"]);
  });

  it("a re-render job names its revision and is not skipped as approved work", async () => {
    const db = renderDb({ asset: assetRow({ revision: 2, status: "pending" }) });
    await step("render_cover").run(context(db, "render_cover"), {}, { ...DATA, revision: 2 });
    expect(rpcCall(db, "upsert_asset_stub")[0]?.args).toEqual([
      { p_property: PROPERTY_ID, p_kind: "cover", p_job_id: JOB_ID, p_revision: 2 },
    ]);
    expect(dispatchedJob(spy).payload.data["revision"]).toBe(2);
  });

  it("render_carousel with max_slides 6 dispatches 6 slides and stores the slide count", async () => {
    const db = renderDb({
      asset: assetRow({ kind: "carousel" }),
      media: gallery(12),
      assets: [assetRow({ kind: "carousel", meta: { max_slides: 6 } })],
    });
    await step("render_carousel").run(context(db, "render_carousel"), { max_slides: 6 }, DATA);
    const { spec } = z
      .object({ spec: z.object({ slides: z.array(z.unknown()) }) })
      .parse(dispatchedJob(spy).payload.data);
    expect(spec.slides).toHaveLength(6);
    expect(rpcCall(db, "set_asset_text")[0]?.args).toEqual([
      { p_asset: ASSET_ID, p_meta: { max_slides: 6 } },
    ]);
  });

  it("render_carousel follows the slide count the stub already holds", async () => {
    const db = renderDb({
      asset: assetRow({ kind: "carousel", meta: { max_slides: 6 } }),
      media: gallery(12),
      assets: [assetRow({ kind: "carousel", meta: { max_slides: 6 } })],
    });
    await step("render_carousel").run(context(db, "render_carousel"), { max_slides: 8 }, DATA);
    const { spec } = z
      .object({ spec: z.object({ slides: z.array(z.unknown()) }) })
      .parse(dispatchedJob(spy).payload.data);
    expect(spec.slides).toHaveLength(6);
  });

  it.each(renderTypes)(
    "$type onResult gives the files to the asset with the dispatched asset id and hash",
    async ({ type }) => {
      const files = [
        {
          media_key: `assets/${PROPERTY_ID}/cover/r1/cover.aaaaaaaa.jpg`,
          w: 1200,
          h: 630,
          bytes: 90_000,
          role: "main",
        },
      ];
      const db = fakeDb({ rpc: { set_asset_files: () => undefined } });
      const job = {
        ...context(db, type).job,
        result: { spec_hash: "h".repeat(64), revision: 1, asset_id: ASSET_ID },
      };
      await step(type).onResult?.(context(db, type), job, { files });
      expect(rpcCall(db, "set_asset_files")).toEqual([
        {
          kind: "rpc",
          name: "set_asset_files",
          args: [{ p_asset: ASSET_ID, p_files: files, p_spec_hash: "h".repeat(64) }],
        },
      ]);
      expect(names(db)).toEqual(["rpc:set_asset_files"]);
    },
  );

  it.each(renderTypes)(
    "$type onResult refuses a file the asset could not keep",
    async ({ type }) => {
      const db = fakeDb({ rpc: { set_asset_files: () => undefined } });
      const job = {
        ...context(db, type).job,
        result: { spec_hash: "h", revision: 1, asset_id: ASSET_ID },
      };
      await expect(
        step(type).onResult?.(context(db, type), job, {
          files: [{ media_key: "x.png", w: 1, h: 1, bytes: 1, role: "banner" }],
        }),
      ).rejects.toThrow();
      expect(names(db)).toEqual([]);
    },
  );

  it.each([...renderTypes, { type: "render_variants", kind: "variants" }] as const)(
    "$type runs twice without a second outside effect",
    async ({ type, kind }) => {
      const rows = renderDb({ asset: assetRow({ kind: kind === "variants" ? "cover" : kind }) });
      const staged = [stagedRow(0)];
      const db =
        type === "render_variants"
          ? fakeDb({
              rpc: { claim_media_for_render: () => staged },
              tables: { properties: [propertyRow()], property_media: staged },
              storage: { submissions: { createSignedUrls: signer } },
            })
          : rows;
      const ctx = context(db, type);
      await step(type).run(ctx, {}, DATA);
      await step(type).run(ctx, {}, DATA);
      const [first, second] = [dispatchedJob(spy, 0), dispatchedJob(spy, 1)];
      expect(second).toEqual(first);
      expect(first.job_id).toBe(JOB_ID);
    },
  );

  it("no render step creates, sends or posts anything: only stubs, text and one dispatch", async () => {
    const db = renderDb({
      asset: assetRow({ kind: "carousel" }),
      assets: [assetRow({ kind: "carousel", meta: { max_slides: 8 } })],
    });
    await step("render_carousel").run(context(db, "render_carousel"), {}, DATA);
    const writes = db.calls.filter((call) => call.kind === "rpc").map((call) => call.name);
    expect(new Set(writes)).toEqual(new Set(["upsert_asset_stub", "set_asset_text"]));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

function signer(...args: unknown[]): unknown {
  const paths = z.array(z.string()).parse(args[0]);
  return {
    data: paths.map((path) => ({
      error: null,
      path,
      signedUrl: `https://hbokkmpgpqhrnemgsqra.supabase.co/storage/v1/object/sign/submissions/${path}?token=${"x".repeat(220)}`,
    })),
    error: null,
  };
}

const signedOf = (rows: ReturnType<typeof stagedRow>[]) =>
  rows.map((row) => ({
    media_id: row.id,
    staging_path: row.staging_path ?? "",
    staged_url: `https://hbokkmpgpqhrnemgsqra.supabase.co/storage/v1/object/sign/submissions/${row.staging_path ?? ""}?token=${"x".repeat(220)}`,
    mime: "image/jpeg",
    owner: "oak-hill",
    n: row.sort_order,
  }));

const producedFor = (rows: ReturnType<typeof stagedRow>[]) => ({
  media: Object.fromEntries(
    rows.map((row) => [
      row.id,
      { media_key: `o/oak-hill/${String(row.sort_order)}-bbbbbbbb.webp`, variants: VARIANTS },
    ]),
  ),
});

describe("render_variants run", () => {
  function variantsDb(claimed: ReturnType<typeof stagedRow>[], table = claimed): FakeDb {
    return fakeDb({
      rpc: { claim_media_for_render: () => claimed },
      tables: { properties: [propertyRow()], property_media: table },
      storage: { submissions: { createSignedUrls: signer } },
    });
  }

  const mediaOf = (): z.infer<typeof mediaSchema> =>
    mediaSchema.parse(dispatchedJob(spy).payload.data["media"]);
  const mediaSchema = z.array(
    z.object({
      media_id: z.string(),
      staging_path: z.string(),
      staged_url: z.string(),
      mime: z.string(),
      owner: z.string(),
      n: z.number(),
    }),
  );

  it("claims the rows once with its own job id, signs them with one call and dispatches one address per row", async () => {
    const rows = [
      stagedRow(0),
      stagedRow(1, { staging_path: `staging/${PROPERTY_ID}/01-photo.PNG` }),
    ];
    const db = variantsDb(rows);
    const result = await step("render_variants").run(context(db, "render_variants"), {}, DATA);
    expect(rpcCall(db, "claim_media_for_render")).toEqual([
      {
        kind: "rpc",
        name: "claim_media_for_render",
        args: [{ p_property_id: PROPERTY_ID, p_job_id: JOB_ID }],
      },
    ]);
    const signs = db.calls.filter((call) => call.name === "submissions.createSignedUrls");
    expect(signs).toHaveLength(1);
    expect(signs[0]?.args).toEqual([rows.map((row) => row.staging_path), 7200]);
    expect(mediaOf()).toEqual([
      expect.objectContaining({
        media_id: rows[0]?.id,
        mime: "image/jpeg",
        owner: "oak-hill",
        n: 0,
      }) as unknown,
      expect.objectContaining({
        media_id: rows[1]?.id,
        mime: "image/png",
        owner: "oak-hill",
        n: 1,
      }) as unknown,
    ]);
    expect(mediaOf().every((item) => item.staged_url.startsWith("https://"))).toBe(true);
    expect(result.status).toBe("dispatched");
  });

  it("a batch job with its own key and data.property_id dispatches the same way", async () => {
    const rows = [stagedRow(0)];
    const db = variantsDb(rows);
    await step("render_variants").run(
      context(db, "render_variants"),
      {},
      { property_id: PROPERTY_ID, slug: "oak-hill" },
    );
    expect(mediaOf()).toHaveLength(1);
  });

  it("dispatches 40 rows under the dispatch limit", async () => {
    const rows = Array.from({ length: 40 }, (_, n) => stagedRow(n));
    await step("render_variants").run(context(variantsDb(rows), "render_variants"), {}, DATA);
    expect(mediaOf()).toHaveLength(40);
    expect(JSON.stringify(dispatchedJob(spy)).length).toBeLessThan(DISPATCH_LIMIT);
  });

  it("a property with nothing staged ends done with skipped nothing_staged and no dispatch", async () => {
    const db = variantsDb([], [mediaRow(0)]);
    const result = await step("render_variants").run(context(db, "render_variants"), {}, DATA);
    expect(result).toEqual({ status: "done", result: { skipped: "nothing_staged" } });
    expect(spy).not.toHaveBeenCalled();
    expect(names(db)).not.toContain("storage:submissions.createSignedUrls");
  });

  it("rows all claimed by a running job end done with skipped claimed_elsewhere and no dispatch", async () => {
    const db = variantsDb(
      [],
      [stagedRow(0, { render_job_id: "3f2a9c1d-0000-4000-8000-0000000000dd" })],
    );
    const result = await step("render_variants").run(context(db, "render_variants"), {}, DATA);
    expect(result).toEqual({ status: "done", result: { skipped: "claimed_elsewhere" } });
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses a staged file of a type it cannot make sizes of", async () => {
    const db = variantsDb([
      stagedRow(0, { staging_path: `staging/${PROPERTY_ID}/00-original.gif` }),
    ]);
    await expect(
      step("render_variants").run(context(db, "render_variants"), {}, DATA),
    ).rejects.toThrow(new NonRetryableError("unsupported_media_type"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("a target job dispatches one item named <target>:<slug> with the slug as owner and n 0", async () => {
    const db = fakeDb({
      tables: { regions: [regionRow] },
      storage: { submissions: { createSignedUrls: signer } },
    });
    const data = {
      target: "region",
      slug: "east-bay",
      staging_path: "staging/regions/east-bay.jpg",
    };
    await step("render_variants").run(context(db, "render_variants"), {}, data);
    expect(mediaOf()).toEqual([
      expect.objectContaining({
        media_id: "region:east-bay",
        staging_path: "staging/regions/east-bay.jpg",
        owner: "east-bay",
        n: 0,
        mime: "image/jpeg",
      }) as unknown,
    ]);
  });

  it("a target job whose staging_path does not start with staging/ ends in invalid_staging_path", async () => {
    const db = fakeDb({ tables: { regions: [regionRow] } });
    const data = { target: "region", slug: "east-bay", staging_path: "o/east-bay/0-aaaaaaaa.webp" };
    await expect(
      step("render_variants").run(context(db, "render_variants"), {}, data),
    ).rejects.toThrow(new NonRetryableError("invalid_staging_path"));
    expect(spy).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it("a target job for a row that does not exist ends in target_not_found", async () => {
    const db = fakeDb({ tables: { markets: [] } });
    const data = { target: "market", slug: "nowhere", staging_path: "staging/markets/nowhere.jpg" };
    await expect(
      step("render_variants").run(context(db, "render_variants"), {}, data),
    ).rejects.toThrow(new NonRetryableError("target_not_found"));
    expect(spy).not.toHaveBeenCalled();
  });
});

const regionRow = {
  created_at: "2026-10-03T09:00:00.000Z",
  image: null,
  image_variants: {},
  intro: "x",
  market_slug: "california",
  name: "East Bay",
  places: [],
  slug: "east-bay",
  sort_order: 0,
  updated_at: "2026-10-03T09:00:00.000Z",
};

describe("render_variants onResult", () => {
  const rows = Array.from({ length: 40 }, (_, n) => stagedRow(n));
  const itemsSchema = z.array(
    z.object({ media_id: z.string(), staging_path: z.string() }).passthrough(),
  );

  /** The Worker's callback: `answers` is what apply_media_variants says for each call, in order. */
  function callbackDb(
    answers: boolean[][] | ((index: number, ids: string[]) => boolean) = [[]],
    removeError = false,
  ): FakeDb {
    let call = 0;
    const options: FakeDbOptions = {
      rpc: {
        apply_media_variants: (args) => {
          const items = itemsSchema.parse(args.p_items);
          const flags =
            typeof answers === "function"
              ? undefined
              : (answers[Math.min(call, answers.length - 1)] ?? []);
          const answer = items.map((item, at) => ({
            media_id: item.media_id,
            staging_path: item.staging_path,
            stored:
              typeof answers === "function"
                ? answers(
                    call,
                    items.map((i) => i.media_id),
                  )
                : (flags?.[at] ?? true),
          }));
          call += 1;
          return answer;
        },
        clear_media_staging: (args) => itemsSchema.parse(args.p_items).length,
      },
      storage: {
        submissions: {
          remove: () => ({
            data: removeError ? null : [],
            error: removeError ? { message: "down" } : null,
          }),
        },
      },
    };
    return fakeDb(options);
  }

  const withResult = (db: FakeDb, signed = signedOf(rows)) => ({
    ctx: context(db, "render_variants"),
    job: { ...context(db, "render_variants").job, result: { media: signed } },
  });

  const run = (db: FakeDb, signed = signedOf(rows), produced = producedFor(rows)) => {
    const { ctx, job } = withResult(db, signed);
    return step("render_variants").onResult?.(ctx, job, produced);
  };

  it("makes exactly three calls for 40 photographs: record, remove, clear", async () => {
    const db = callbackDb(() => true);
    await run(db);
    expect(names(db)).toEqual([
      "rpc:apply_media_variants",
      "storage:submissions.remove",
      "rpc:clear_media_staging",
    ]);
    const items = itemsSchema.parse(argsOf(rpcCall(db, "apply_media_variants")[0])["p_items"]);
    expect(items).toHaveLength(40);
    expect(items[7]).toEqual({
      media_id: rows[7]?.id,
      staging_path: rows[7]?.staging_path,
      media_key: "o/oak-hill/7-bbbbbbbb.webp",
      variants: VARIANTS,
    });
    expect(items.every((item) => !("orientation" in item))).toBe(true);
    const removal = db.calls.find((call) => call.name === "submissions.remove");
    expect(removal?.args).toEqual([rows.map((row) => row.staging_path)]);
    expect(itemsSchema.parse(argsOf(rpcCall(db, "clear_media_staging")[0])["p_items"])).toEqual(
      rows.map((row) => ({ media_id: row.id, staging_path: row.staging_path })),
    );
  });

  it("an item that comes back stored false keeps its old object in the removal and out of the clear", async () => {
    const moved = rows[3];
    const db = callbackDb([rows.map((row) => row.id !== moved?.id)]);
    await run(db);
    const removal = db.calls.find((call) => call.name === "submissions.remove");
    expect(removal?.args[0]).toContain(moved?.staging_path);
    const cleared = itemsSchema
      .parse(argsOf(rpcCall(db, "clear_media_staging")[0])["p_items"])
      .map((item) => item.media_id);
    expect(cleared).toHaveLength(39);
    expect(cleared).not.toContain(moved?.id);
  });

  it("a result with no stored item makes no clear call", async () => {
    const db = callbackDb(() => false);
    await run(db);
    expect(names(db)).toEqual(["rpc:apply_media_variants", "storage:submissions.remove"]);
  });

  it("a second onResult for the same rows stores nothing and makes no clear call", async () => {
    const db = callbackDb((call) => call === 0);
    await run(db);
    await run(db);
    expect(names(db)).toEqual([
      "rpc:apply_media_variants",
      "storage:submissions.remove",
      "rpc:clear_media_staging",
      "rpc:apply_media_variants",
      "storage:submissions.remove",
    ]);
  });

  it("a remove error throws and makes no clear call", async () => {
    const db = callbackDb(() => true, true);
    await expect(run(db)).rejects.toThrow();
    expect(names(db)).toEqual(["rpc:apply_media_variants", "storage:submissions.remove"]);
  });

  it("a callback with no result for a signed photograph fails before it writes", async () => {
    const db = callbackDb(() => true);
    await expect(run(db, signedOf(rows), { media: {} })).rejects.toThrow("no result");
    expect(names(db)).toEqual([]);
  });

  it("a target job records the image and removes its one staged object", async () => {
    const signed = [
      {
        media_id: "region:east-bay",
        staging_path: "staging/regions/east-bay.jpg",
        staged_url: "https://x.supabase.co/sign",
        mime: "image/jpeg",
        owner: "east-bay",
        n: 0,
      },
    ];
    const db = fakeDb({
      rpc: { set_target_image: () => undefined },
      storage: { submissions: { remove: () => ({ data: [], error: null }) } },
    });
    const produced = {
      media: { "region:east-bay": { media_key: "o/east-bay/0-cccccccc.webp", variants: VARIANTS } },
    };
    const { ctx, job } = withResult(db, signed);
    await step("render_variants").onResult?.(ctx, job, produced);
    expect(db.calls).toEqual([
      {
        kind: "rpc",
        name: "set_target_image",
        args: [
          {
            p_target: "region",
            p_slug: "east-bay",
            p_image: "o/east-bay/0-cccccccc.webp",
            p_variants: VARIANTS,
          },
        ],
      },
      { kind: "storage", name: "submissions.remove", args: [["staging/regions/east-bay.jpg"]] },
    ]);
  });
});

describe("render_og_static", () => {
  it("dispatches its pages and records the seven cards it gets back", async () => {
    const db = fakeDb({ rpc: { set_og_static: () => undefined } });
    const ctx = context(db, "render_og_static");
    const params = { pages: [...ogStaticKeys] };
    await step("render_og_static").run(ctx, params, {});
    expect(dispatchedJob(spy).payload.params).toEqual(params);
    const files = ogStaticKeys.map((key) => ({
      key,
      media_key: `og/static/${key}.aaaaaaaa.png`,
      w: 1200,
      h: 630,
    }));
    await step("render_og_static").onResult?.(ctx, ctx.job, { files });
    const value = z
      .record(z.string(), z.unknown())
      .parse(argsOf(rpcCall(db, "set_og_static")[0])["p_value"]);
    expect(Object.keys(value).sort()).toEqual([...ogStaticKeys].sort());
    expect(value["home"]).toEqual({ media_key: "og/static/home.aaaaaaaa.png", w: 1200, h: 630 });
  });

  it("render_og_static runs twice without a second outside effect", async () => {
    const ctx = context(fakeDb(), "render_og_static");
    await step("render_og_static").run(ctx, {}, {});
    await step("render_og_static").run(ctx, {}, {});
    expect(dispatchedJob(spy, 1)).toEqual(dispatchedJob(spy, 0));
  });

  it("refuses a page that has no card", () => {
    const parsed = step("render_og_static").paramsSchema.safeParse({ pages: ["nowhere"] });
    expect(parsed.success).toBe(false);
  });
});

// B9 step 9: write_captions (class local, ASSUMED H34) and build_newsletter_block.
const EVENT_ID = "3f2a9c1d-0000-4000-8000-0000000000ee";
const MODEL = "claude-haiku-4-5-20251001";
const GOOD_CAPTIONS = {
  instagram: "A quiet house in the hills. Five bedrooms, built in 2021. $8,950,000.",
  x: `A quiet house in the hills. ${propertyLink("oak-hill", "x")}`,
  linkedin: "A house selected for its setting. The dossier is ready for an agent to share.",
  alt_text: "A stone house under an oak.",
  slide_alts: ["one", "two", "three", "four", "five", "six", "seven", "eight"],
};

interface Answer {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}
const answered = (body: unknown, input = 900, output = 300): Answer => ({
  text: JSON.stringify(body),
  usage: { input_tokens: input, output_tokens: output },
});

function stubComplete(...answers: Answer[]) {
  const complete = vi.fn<(prompt: string, model: string, signal: AbortSignal) => Promise<Answer>>();
  for (const next of answers) complete.mockResolvedValueOnce(next);
  return complete;
}

function jobRow(payload: Tables<"jobs">["payload"]): Tables<"jobs"> {
  return {
    attempts: 0,
    created_at: NOW.toISOString(),
    error: null,
    event_id: EVENT_ID,
    finished_at: null,
    heavy: true,
    id: "3f2a9c1d-0000-4000-8000-0000000000ff",
    idempotency_key: `${EVENT_ID}:render_carousel`,
    job_event_entity_id: null,
    locked_at: null,
    locked_by: null,
    max_attempts: 12,
    msg_id: null,
    payload,
    recipe_id: null,
    result: null,
    run_after: NOW.toISOString(),
    run_local: false,
    status: "queued",
    step_id: null,
    type: "render_carousel",
    updated_at: NOW.toISOString(),
  };
}

interface TextRows {
  property?: ReturnType<typeof propertyRow>;
  media?: ReturnType<typeof mediaRow>[];
  stubs?: Partial<Record<AssetKind, Partial<Tables<"assets">>>>;
  jobs?: Tables<"jobs">[];
  assets?: Tables<"assets">[];
}

const captionModel = {
  key: "caption_model",
  value: MODEL,
  updated_at: NOW.toISOString(),
  updated_by: null,
};

function textDb(rows: TextRows = {}): FakeDb {
  return fakeDb({
    rpc: {
      upsert_asset_stub: ({ p_kind, p_revision }) =>
        assetRow({
          id: `asset-${p_kind}`,
          kind: p_kind,
          revision: p_revision ?? 1,
          ...rows.stubs?.[p_kind],
        }),
      set_asset_text: () => undefined,
    },
    tables: {
      properties: [rows.property ?? propertyRow()],
      property_media: rows.media ?? [mediaRow(0), mediaRow(1), mediaRow(2)],
      assets: rows.assets ?? [assetRow({ kind: "carousel" })],
      jobs: rows.jobs ?? [],
      settings: [captionModel],
    },
  });
}

const stubKinds = (db: FakeDb) => rpcCall(db, "upsert_asset_stub").map((c) => argsOf(c)["p_kind"]);
const textCalls = (db: FakeDb) => rpcCall(db, "set_asset_text").map((call) => argsOf(call));
const textFor = (db: FakeDb, kind: AssetKind) =>
  textCalls(db).filter((args) => args["p_asset"] === `asset-${kind}`);
const campaign = propertyRow({ campaign_tier: "Campaign" });

async function runCaptions(
  db: FakeDb,
  complete = stubComplete(answered(GOOD_CAPTIONS)),
  params: { alt_text?: boolean } = {},
) {
  const ctx = context(db, "write_captions", { eventId: EVENT_ID });
  const result = await runWriteCaptions(ctx, params, DATA, complete);
  return { result, complete };
}

describe("write_captions", () => {
  it("write_captions is the only registered step of the local class and none is local and heavy", () => {
    const types = [
      "render_variants",
      "render_cover",
      "render_carousel",
      "render_story",
      "render_og_static",
      "write_captions",
      "build_newsletter_block",
    ];
    const local = types.filter((type) => step(type).local === true);
    expect(local).toEqual(["write_captions"]);
    expect(types.filter((type) => step(type).local === true && step(type).heavy)).toEqual([]);
  });

  it("getStep returns a local module whose run throws local_step", async () => {
    const found = step("write_captions");
    expect(found).toMatchObject({ type: "write_captions", heavy: false, local: true });
    await expect(found.run(context(textDb(), "write_captions"), {}, DATA)).rejects.toThrow(
      new NonRetryableError("local_step"),
    );
  });

  it("runWriteCaptions creates the stubs of the Editorial tier, with no job id, and fills the captions", async () => {
    const db = textDb();
    const { result } = await runCaptions(db);
    expect(stubKinds(db)).toEqual(["cover", "carousel", "story", "newsletter_block"]);
    expect(rpcCall(db, "upsert_asset_stub").every((c) => !("p_job_id" in argsOf(c)))).toBe(true);
    expect(textFor(db, "cover")).toEqual([
      {
        p_asset: "asset-cover",
        p_caption: GOOD_CAPTIONS.instagram,
        p_alt_text: GOOD_CAPTIONS.alt_text,
        p_meta: {
          captions: {
            instagram: GOOD_CAPTIONS.instagram,
            x: GOOD_CAPTIONS.x,
            linkedin: GOOD_CAPTIONS.linkedin,
          },
          caption_lint: "passed",
        },
      },
    ]);
    expect(textFor(db, "newsletter_block")).toEqual([
      { p_asset: "asset-newsletter_block", p_alt_text: GOOD_CAPTIONS.alt_text },
    ]);
    expect(result).toMatchObject({ status: "done" });
  });

  it("the Campaign tier adds the reel and the standalone email stubs, and the reel gets captions", async () => {
    const db = textDb({ property: campaign });
    await runCaptions(db);
    expect(stubKinds(db)).toEqual([
      "cover",
      "carousel",
      "story",
      "newsletter_block",
      "reel",
      "standalone_email",
    ]);
    expect(textFor(db, "reel")).toHaveLength(1);
    expect(textFor(db, "standalone_email")).toEqual([]);
  });

  it("re-checks the tier on the row, so a recipe that names Campaign still makes no reel", async () => {
    const db = textDb();
    const ctx = context(db, "write_captions");
    const complete = stubComplete(answered(GOOD_CAPTIONS));
    await runWriteCaptions(ctx, {}, { ...DATA, tier: "Campaign" }, complete);
    expect(stubKinds(db)).not.toContain("reel");
    expect(stubKinds(db)).not.toContain("standalone_email");
  });

  it("the stub complete's usage reaches the result summed over the first answer and the lint retry", async () => {
    const bad = { ...GOOD_CAPTIONS, instagram: "A stunning house." };
    const { result, complete } = await runCaptions(
      textDb(),
      stubComplete(answered(bad, 900, 300), answered(GOOD_CAPTIONS, 1100, 250)),
    );
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[1]).toBe(MODEL);
    expect(result).toEqual({
      status: "done",
      result: { usage: { model: MODEL, input_tokens: 2000, output_tokens: 550 } },
    });
  });

  it("a caption that fails twice is stored flagged on every kind it writes", async () => {
    const bad = { ...GOOD_CAPTIONS, instagram: "A stunning house." };
    const db = textDb();
    await runCaptions(db, stubComplete(answered(bad), answered(bad)));
    expect(textFor(db, "cover")[0]).toMatchObject({ p_meta: { caption_lint: "failed" } });
  });

  it("with the event's render_carousel job holding max_slides 6, meta.slide_alts has 6 entries", async () => {
    const db = textDb({
      media: Array.from({ length: 12 }, (_, n) => mediaRow(n)),
      jobs: [jobRow({ params: { max_slides: 6 }, data: {} })],
    });
    await runCaptions(db);
    expect(textFor(db, "carousel").at(-1)).toMatchObject({
      p_meta: { slide_alts: ["one", "two", "three", "four", "five", "six"] },
    });
    expect(textFor(db, "carousel")[0]).toEqual({
      p_asset: "asset-carousel",
      p_meta: { max_slides: 6 },
    });
  });

  it("a kind whose caption_lint is edited keeps its caption (human caption kept)", async () => {
    const db = textDb({ stubs: { carousel: { meta: { caption_lint: "edited" } } } });
    await runCaptions(db);
    expect(textFor(db, "cover")).toHaveLength(1);
    expect(textFor(db, "story")).toHaveLength(1);
    expect(textFor(db, "carousel").every((args) => !("p_caption" in args))).toBe(true);
  });

  it("a caption typed by hand while the model answers is not overwritten", async () => {
    const assets = [assetRow({ kind: "carousel" })];
    const db = textDb({ assets });
    const complete = stubComplete();
    complete.mockImplementationOnce(() => {
      assets.push(assetRow({ id: "asset-cover", kind: "cover", meta: { caption_lint: "edited" } }));
      return Promise.resolve(answered(GOOD_CAPTIONS));
    });
    await runCaptions(db, complete);
    expect(textFor(db, "cover")).toEqual([]);
    expect(textFor(db, "story")).toHaveLength(1);
  });

  it("approved work is untouched by a second publish and the model is not asked", async () => {
    const approved = { status: "approved" } as const;
    const db = textDb({
      stubs: { cover: approved, carousel: approved, story: approved, newsletter_block: approved },
    });
    const { result, complete } = await runCaptions(db);
    expect(result).toEqual({ status: "done", result: { skipped: "already_approved" } });
    expect(complete).not.toHaveBeenCalled();
    expect(textCalls(db)).toEqual([]);
  });

  it("when every caption was typed by hand the step ends done and asks nothing", async () => {
    const edited = { meta: { caption_lint: "edited" } };
    const db = textDb({
      stubs: { cover: edited, carousel: edited, story: edited, newsletter_block: edited },
    });
    const { result, complete } = await runCaptions(db);
    expect(result).toEqual({ status: "done", result: { skipped: "caption_edited" } });
    expect(complete).not.toHaveBeenCalled();
  });

  it("waits two minutes for the carousel size, and after 60 minutes since its stub ends in variants_missing", async () => {
    const media = [mediaRow(0), mediaRow(1, { variants: { hero: VARIANTS.hero } })];
    const { result, complete } = await runCaptions(textDb({ media }));
    expect(result).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 2 * 60 * 1000),
      reason: "variants_pending",
    });
    expect(complete).not.toHaveBeenCalled();
    const created_at = new Date(NOW.getTime() - 61 * 60 * 1000).toISOString();
    const old = { cover: { created_at }, carousel: { created_at }, story: { created_at } };
    await expect(runCaptions(textDb({ media, stubs: old }))).rejects.toThrow(
      new NonRetryableError("variants_missing"),
    );
  });

  it("params.alt_text false writes captions only and leaves every alt text untouched", async () => {
    const db = textDb();
    await runCaptions(db, stubComplete(answered(GOOD_CAPTIONS)), { alt_text: false });
    expect(textFor(db, "cover")[0]).not.toHaveProperty("p_alt_text");
    expect(textFor(db, "newsletter_block")).toEqual([]);
    expect(textFor(db, "carousel").at(-1)?.["p_meta"]).not.toHaveProperty("slide_alts");
  });

  it("a property that is not published is skipped and a missing property id throws", async () => {
    const draft = textDb({ property: propertyRow({ editorial_state: "archived" }) });
    const { result } = await runCaptions(draft);
    expect(result).toEqual({ status: "done", result: { skipped: "not_published" } });
    expect(rpcCall(draft, "upsert_asset_stub")).toEqual([]);
    const ctx = context(textDb(), "write_captions");
    await expect(runWriteCaptions(ctx, {}, {}, stubComplete())).rejects.toThrow(
      new NonRetryableError("property_id_missing"),
    );
  });

  it("creates, sends and posts nothing: only stubs and text", async () => {
    const db = textDb({ property: campaign });
    await runCaptions(db);
    const names = new Set(db.calls.map((call) => `${call.kind}:${call.name}`));
    expect([...names].filter((name) => name.startsWith("rpc:")).sort()).toEqual([
      "rpc:set_asset_text",
      "rpc:upsert_asset_stub",
    ]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a render onResult before or after it leaves the captions and the files intact", async () => {
    const store = new Map<string, Tables<"assets">>();
    const kindOf = (asset: string) => asset.replace("asset-", "");
    const db = fakeDb({
      rpc: {
        upsert_asset_stub: ({ p_kind }) => {
          const row = store.get(p_kind) ?? assetRow({ id: `asset-${p_kind}`, kind: p_kind });
          store.set(p_kind, row);
          return row;
        },
        set_asset_text: ({ p_asset, p_caption }) => {
          const row = store.get(kindOf(p_asset));
          if (row !== undefined && p_caption !== undefined) {
            store.set(kindOf(p_asset), { ...row, caption: p_caption });
          }
          return undefined;
        },
        set_asset_files: ({ p_asset, p_files }) => {
          const row = store.get(kindOf(p_asset));
          if (row !== undefined) store.set(kindOf(p_asset), { ...row, files: p_files ?? [] });
          return undefined;
        },
      },
      tables: {
        properties: [propertyRow()],
        property_media: [mediaRow(0), mediaRow(1), mediaRow(2)],
        assets: [assetRow({ kind: "carousel" })],
        jobs: [],
        settings: [captionModel],
      },
    });
    const file = { media_key: "assets/cover.jpg", w: 1200, h: 630, bytes: 9, role: "main" };
    store.set("cover", assetRow({ id: "asset-cover", kind: "cover" }));
    const ctx = context(db, "render_cover");
    const job = { ...ctx.job, result: { spec_hash: "h", revision: 1, asset_id: "asset-cover" } };
    await step("render_cover").onResult?.(ctx, job, { files: [file] });
    const complete = stubComplete(answered(GOOD_CAPTIONS));
    await runWriteCaptions(context(db, "write_captions"), {}, DATA, complete);
    expect(store.get("cover")).toMatchObject({ caption: GOOD_CAPTIONS.instagram, files: [file] });
    await step("render_cover").onResult?.(ctx, job, { files: [file] });
    expect(store.get("cover")).toMatchObject({ caption: GOOD_CAPTIONS.instagram, files: [file] });
  });
});

describe("build_newsletter_block", () => {
  const run = (db: FakeDb, data: JsonObject = DATA) =>
    step("build_newsletter_block").run(context(db, "build_newsletter_block"), {}, data);

  it("getStep returns a light module", () => {
    expect(step("build_newsletter_block")).toMatchObject({
      type: "build_newsletter_block",
      heavy: false,
    });
  });

  it("Feature tier gets no standalone", async () => {
    const db = textDb({ property: propertyRow({ campaign_tier: "Feature" }) });
    await run(db);
    expect(stubKinds(db)).toEqual(["newsletter_block"]);
    expect(textCalls(db)).toHaveLength(1);
    expect(rpcCall(db, "upsert_asset_stub")[0]?.args).toEqual([
      { p_property: PROPERTY_ID, p_kind: "newsletter_block", p_job_id: JOB_ID },
    ]);
  });

  it("Campaign creates both, with the same block", async () => {
    const db = textDb({ property: campaign });
    await run(db);
    expect(stubKinds(db)).toEqual(["newsletter_block", "standalone_email"]);
    const meta = z.object({ block: z.unknown() });
    const block = meta.parse(textFor(db, "newsletter_block")[0]?.["p_meta"]).block;
    expect(textFor(db, "standalone_email")[0]?.["p_meta"]).toEqual({
      block,
      subject: "A residence",
      preheader: "A quiet street under old oaks.",
    });
  });

  it("a job with data.kind standalone_email and revision 2 upserts no newsletter_block row", async () => {
    const db = textDb({ property: campaign });
    await run(db, { ...DATA, kind: "standalone_email", revision: 2 });
    expect(rpcCall(db, "upsert_asset_stub").map((call) => call.args[0])).toEqual([
      { p_property: PROPERTY_ID, p_kind: "standalone_email", p_job_id: JOB_ID, p_revision: 2 },
    ]);
    expect(textFor(db, "newsletter_block")).toEqual([]);
  });

  it("a standalone re-render on a Feature property builds nothing", async () => {
    const db = textDb({ property: propertyRow({ campaign_tier: "Feature" }) });
    const result = await run(db, { ...DATA, kind: "standalone_email", revision: 2 });
    expect(result).toEqual({ status: "done", result: { skipped: "kind_not_built" } });
    expect(stubKinds(db)).toEqual([]);
  });

  it("a missing og variant returns retry_at and, after 60 minutes since the stub, variants_missing", async () => {
    const media = [mediaRow(0, { variants: { hero: VARIANTS.hero } })];
    expect(await run(textDb({ media }))).toEqual({
      status: "retry_at",
      at: new Date(NOW.getTime() + 2 * 60 * 1000),
      reason: "variants_pending",
    });
    const created_at = new Date(NOW.getTime() - 61 * 60 * 1000).toISOString();
    await expect(
      run(textDb({ media, stubs: { newsletter_block: { created_at } } })),
    ).rejects.toThrow(new NonRetryableError("variants_missing"));
  });

  it("the block holds the og JPEG as an absolute address, its own link and the first sentence of the place", async () => {
    const db = textDb();
    await run(db);
    const meta = z
      .object({
        block: z.object({
          title: z.string(),
          deck: z.string(),
          image_key: z.string(),
          image_url: z.string(),
          link: z.string(),
        }),
      })
      .parse(textFor(db, "newsletter_block")[0]?.["p_meta"]);
    expect(meta.block.image_key).toBe("v/oak-hill/0-aaaaaaaa/og.jpg");
    expect(meta.block.image_url).toBe(mediaUrl(meta.block.image_key, { absolute: true }));
    expect(meta.block.image_url.startsWith(MEDIA_BASE)).toBe(true);
    expect(meta.block.image_url.endsWith(".jpg")).toBe(true);
    expect(meta.block.link).toBe(propertyLink("oak-hill", "newsletter"));
    expect(meta.block.title).toBe("A residence");
    expect(meta.block.deck).toBe("A quiet street under old oaks.");
  });

  it("a property with no place paragraph gets its city and state as the deck", async () => {
    const db = textDb({ property: propertyRow({ place: null }) });
    await run(db);
    expect(textFor(db, "newsletter_block")[0]).toMatchObject({
      p_meta: { block: { deck: "Los Altos Hills, California" } },
    });
  });

  it("throws media_public_base_missing and writes no block without MEDIA_PUBLIC_BASE", async () => {
    vi.stubEnv("MEDIA_PUBLIC_BASE", undefined);
    const db = textDb();
    await expect(run(db)).rejects.toThrow(new NonRetryableError("media_public_base_missing"));
    expect(textCalls(db)).toEqual([]);
  });

  it("approved work is untouched by a second publish and a re-render is not skipped", async () => {
    const approved = { status: "approved" } as const;
    const db = textDb({ stubs: { newsletter_block: approved } });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "already_approved" } });
    expect(textCalls(db)).toEqual([]);
    const again = textDb({ stubs: { newsletter_block: approved } });
    await run(again, { ...DATA, kind: "newsletter_block", revision: 2 });
    expect(textFor(again, "newsletter_block")).toHaveLength(1);
  });

  it("a property that is not published is skipped", async () => {
    const db = textDb({ property: propertyRow({ editorial_state: "archived" }) });
    expect(await run(db)).toEqual({ status: "done", result: { skipped: "not_published" } });
    expect(stubKinds(db)).toEqual([]);
  });
});

// B9 step 8: the five render steps in the registry. A fake database answers the rows and records every call; a fetch
// stub takes the one render.yml dispatch (R50). Invariants 1, 10, 11 and 12 of the plan, G62, JOB-03, SEC-02.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ogStaticKeys } from "../../../src/domain/assets";
import { getStep } from "../../../src/server/jobs/steps/index";
import type { StepDefinition } from "../../../src/server/jobs/types";
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

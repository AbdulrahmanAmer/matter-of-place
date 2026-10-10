import { z } from "zod";
import {
  comingSoonAnswerSchema,
  marketGuideEntrySchema,
  marketNoteSchema,
  marketRegionSchema,
  marketSavedSchema,
  type ComingSoonAnswer,
  type MarketDetail,
  type MarketInterest,
  type MarketListRow,
  type MarketSaved,
  type MarketUpdateInput,
} from "../../domain/admin-markets";
import { marketSlugSchema, type MarketSlug } from "../../domain/market";
import { isImplemented, type StepRegistry } from "../automation/catalog";
import { fromRpcError } from "../lib/admin-errors";
import type { AdminActor } from "../lib/admin-route";
import { auditContext } from "../lib/audit";
import { authorize } from "../lib/authz";
import type { Db } from "../lib/db";
import { AppError } from "../lib/errors";
import { getStep } from "../jobs/steps/index";
import { getSystemJob } from "../jobs/system/index";
import { sniffStaged } from "../media/staging";

// Screen 15 (B7 step 13). Each function authorizes before it touches the database (SEC-04). The three markets are
// read with plain selects, as `getStory` reads a story; each write is one RPC that locks the market and audits in the
// same transaction.

const mediaAddress = (key: string | null) => (key === null ? null : `/media/${key}`);

const marketRowSchema = z.object({
  slug: marketSlugSchema,
  name: z.string(),
  intro: z.string(),
  places: z.array(z.string()),
  image: z.string().nullable(),
  sort_order: z.number().int(),
  coming_soon: z.boolean(),
  interest_copy: z.string().nullable(),
  updated_at: z.string(),
});

const regionRowSchema = marketRegionSchema
  .omit({ image_url: true })
  .extend({ image: z.string().nullable() });

const interestRowSchema = z.object({
  market_slug: marketSlugSchema,
  confirmed: z.number().int(),
  pending: z.number().int(),
});

/** The signups of one market; a market nobody wrote to has none of either. */
async function interestOf(db: Db): Promise<ReadonlyMap<MarketSlug, MarketInterest>> {
  const { data, error } = await db
    .from("market_interest_counts")
    .select("market_slug, confirmed, pending");
  if (error !== null) throw fromRpcError(error);
  return new Map(
    z
      .array(interestRowSchema)
      .parse(data)
      .map((row) => [row.market_slug, { confirmed: row.confirmed, pending: row.pending }]),
  );
}

const noInterest: MarketInterest = { confirmed: 0, pending: 0 };

/** `GET /api/admin/markets`: the three markets, in site order, each with its interest signups. */
export async function listMarkets(actor: AdminActor, db: Db): Promise<{ items: MarketListRow[] }> {
  authorize(actor, "markets.list");
  const [markets, interest] = await Promise.all([
    db
      .from("markets")
      .select("slug, name, image, sort_order, coming_soon")
      .order("sort_order")
      .order("slug"),
    interestOf(db),
  ]);
  if (markets.error !== null) throw fromRpcError(markets.error);
  const rows = z
    .array(
      marketRowSchema.pick({
        slug: true,
        name: true,
        image: true,
        sort_order: true,
        coming_soon: true,
      }),
    )
    .parse(markets.data);
  return {
    items: rows.map(({ image, ...row }) => ({
      ...row,
      image_url: mediaAddress(image),
      interest: interest.get(row.slug) ?? noInterest,
    })),
  };
}

/** `GET /api/admin/markets/:slug`: the market with its regions, notes and guide entries in display order. */
export async function getMarket(
  actor: AdminActor,
  db: Db,
  slug: MarketSlug,
): Promise<MarketDetail> {
  authorize(actor, "markets.get");
  const [market, regions, notes, guide, interest] = await Promise.all([
    db
      .from("markets")
      .select(
        "slug, name, intro, places, image, sort_order, coming_soon, interest_copy, updated_at",
      )
      .eq("slug", slug)
      .maybeSingle(),
    db
      .from("regions")
      .select("slug, name, intro, places, image, sort_order")
      .eq("market_slug", slug)
      .order("sort_order")
      .order("slug"),
    db
      .from("market_notes")
      .select("label, text")
      .eq("market_slug", slug)
      .order("sort_order")
      .order("id"),
    db
      .from("market_guide_entries")
      .select("section, region_slug, label, text")
      .eq("market_slug", slug)
      .order("sort_order")
      .order("id"),
    interestOf(db),
  ]);
  for (const answer of [market, regions, notes, guide]) {
    if (answer.error !== null) throw fromRpcError(answer.error);
  }
  if (market.data === null)
    throw new AppError("not_found", undefined, "This market does not exist.");
  const { image, ...row } = marketRowSchema.parse(market.data);
  return {
    ...row,
    image_url: mediaAddress(image),
    interest: interest.get(slug) ?? noInterest,
    regions: z
      .array(regionRowSchema)
      .parse(regions.data)
      .map(({ image: regionImage, ...region }) => ({
        ...region,
        image_url: mediaAddress(regionImage),
      })),
    notes: z.array(marketNoteSchema).parse(notes.data),
    guide_entries: z.array(marketGuideEntrySchema).parse(guide.data),
  };
}

const invalidImage = () =>
  new AppError("invalid_image", undefined, "The file is not the one this upload was made for.");

/** A staged path is the market's or the region's own folder, then its bytes are read (G51). */
async function checkStaged(db: Db, path: string, folder: string): Promise<void> {
  if (!path.startsWith(`${folder}/`)) throw invalidImage();
  await sniffStaged(db, path);
}

/**
 * `PATCH /api/admin/markets/:slug`. Every staged image is checked by its name and then its first bytes before the one
 * `update_market` call, which queues the renders in the same transaction, so a file that is not a photograph leaves
 * no row changed and no job (G51). A region is sent without an `image`: it keeps the one it has.
 */
export async function updateMarket(
  actor: AdminActor,
  db: Db,
  input: MarketUpdateInput,
): Promise<MarketSaved> {
  authorize(actor, "markets.edit");
  const regions = input.regions ?? null;
  await Promise.all([
    ...(input.image_staging_path === undefined
      ? []
      : [checkStaged(db, input.image_staging_path, `staging/market/${input.slug}`)]),
    ...(regions ?? []).flatMap((region) =>
      region.image_staging_path === undefined
        ? []
        : [checkStaged(db, region.image_staging_path, `staging/region/${region.slug}`)],
    ),
  ]);
  const { data, error } = await db.rpc("update_market", {
    p_slug: input.slug,
    p_patch: input.patch,
    p_regions: regions,
    p_notes: input.notes ?? null,
    p_guide_entries: input.guide_entries ?? null,
    ...auditContext(actor),
    ...(input.image_staging_path === undefined
      ? {}
      : { p_image_staging_path: input.image_staging_path }),
  });
  if (error !== null) throw fromRpcError(error);
  return marketSavedSchema.parse(data);
}

/** A job type has a handler when the step catalog or the system jobs hold it, as the runner looks one up. */
const runnable: StepRegistry = (type) => getStep(type) ?? getSystemJob(type);

/**
 * `POST /api/admin/markets/:slug/coming-soon`. Opening a market queues its one `market_open_notice` (key
 * `market_open:<market>`) only once that job type has a handler, the rule B8b's `open_market_on_publish` follows, so
 * until then the key stays free for the real notice (G37).
 */
export async function setComingSoon(
  actor: AdminActor,
  db: Db,
  input: { slug: MarketSlug; coming_soon: boolean },
  registry: StepRegistry = runnable,
): Promise<ComingSoonAnswer> {
  authorize(actor, "markets.coming_soon");
  const { data, error } = await db.rpc("set_market_coming_soon", {
    p_slug: input.slug,
    p_coming_soon: input.coming_soon,
    p_notify: isImplemented("market_open_notice", registry),
    ...auditContext(actor),
  });
  if (error !== null) throw fromRpcError(error);
  return comingSoonAnswerSchema.parse(data);
}

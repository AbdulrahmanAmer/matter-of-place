import { z } from "zod";
import { marketSlugSchema, regionSlugSchema } from "./market.ts";

// Screen 15 (B7 step 13): the three markets an editor writes, and the coming-soon toggle. API JSON is the snake_case
// row shape of the generated types.

const text = (max: number) => z.string().trim().min(1).max(max);
const updatedAt = z.string().datetime({ offset: true });
const places = z.array(text(120)).max(40);
const sortOrder = z.number().int().min(0).max(1000);

/** The sections of a market guide; `market_guide_entries.section` holds one of them. */
export const marketGuideSections = ["neighborhood", "need", "service"] as const;

/** The path parameter of every `markets/:slug` route. */
export const marketSlugInputSchema = z.object({ slug: marketSlugSchema });

/** The interest signups of a market, from the view `market_interest_counts`. */
const marketInterestSchema = z.object({
  confirmed: z.number().int().min(0),
  pending: z.number().int().min(0),
});

export type MarketInterest = z.infer<typeof marketInterestSchema>;

/** One row of `GET markets`. A market has an address and an image; `image_url` is null until a render has run (G55). */
const marketListRowSchema = z.object({
  slug: marketSlugSchema,
  name: z.string(),
  coming_soon: z.boolean(),
  sort_order: z.number().int(),
  image_url: z.string().nullable(),
  interest: marketInterestSchema,
});

export type MarketListRow = z.infer<typeof marketListRowSchema>;

/** The markets are the three the table's check constraint allows, so the list is never paged. */
export const marketListSchema = z.object({ items: z.array(marketListRowSchema) });

export const marketRegionSchema = z.object({
  slug: regionSlugSchema,
  name: z.string(),
  intro: z.string(),
  places: z.array(z.string()),
  sort_order: z.number().int(),
  image_url: z.string().nullable(),
});

export const marketNoteSchema = z.object({ label: z.string(), text: z.string() });

export const marketGuideEntrySchema = z.object({
  section: z.enum(marketGuideSections),
  region_slug: regionSlugSchema.nullable(),
  label: z.string(),
  text: z.string(),
});

/** `GET markets/:slug`: the market with its regions, notes and guide entries, each in display order. */
export const marketDetailSchema = marketListRowSchema.extend({
  intro: z.string(),
  places: z.array(z.string()),
  interest_copy: z.string().nullable(),
  updated_at: z.string(),
  regions: z.array(marketRegionSchema),
  notes: z.array(marketNoteSchema),
  guide_entries: z.array(marketGuideEntrySchema),
});

export type MarketDetail = z.infer<typeof marketDetailSchema>;

/**
 * The market fields an editor writes. `image`, `image_variants` and `coming_soon` are not among them: the image is
 * written once B9's render has run on the staged file (G55) and the toggle has its own route.
 */
const marketPatchSchema = z
  .object({
    name: text(120),
    intro: text(2000),
    places,
    interest_copy: text(600).nullable(),
    sort_order: sortOrder,
  })
  .partial()
  .strict();

export type MarketPatch = z.infer<typeof marketPatchSchema>;

/** The object name `createStagingUpload` made, in the bucket `submissions` (G51). */
const imageStagingPath = z.string().min(1).max(300);

/** A region as the editor saves it. It carries no `image`: a region keeps its image until a new one has rendered. */
const regionInputSchema = z
  .object({
    slug: regionSlugSchema,
    name: text(120),
    intro: text(2000),
    places,
    sort_order: sortOrder,
    image_staging_path: imageStagingPath.optional(),
  })
  .strict();

export type RegionInput = z.infer<typeof regionInputSchema>;

const noteInputSchema = z.object({ label: text(120), text: text(2000) }).strict();

const guideEntryInputSchema = z
  .object({
    section: z.enum(marketGuideSections),
    region_slug: regionSlugSchema.nullable(),
    label: text(120),
    text: text(2000),
  })
  .strict()
  .refine((entry) => entry.section !== "neighborhood" || entry.region_slug !== null, {
    message: "A neighborhood belongs to a region.",
    path: ["region_slug"],
  });

/**
 * `PATCH markets/:slug`: the changed fields and, for each part the editor opened, the whole list. A part left out is
 * left as it is; a notes or guide list replaces the stored rows in array order.
 */
export const marketUpdateInputSchema = marketSlugInputSchema.extend({
  patch: marketPatchSchema.default({}),
  regions: z
    .array(regionInputSchema)
    .max(12)
    .refine((regions) => new Set(regions.map((region) => region.slug)).size === regions.length, {
      message: "A region appears once.",
    })
    .optional(),
  notes: z.array(noteInputSchema).max(20).optional(),
  guide_entries: z.array(guideEntryInputSchema).max(100).optional(),
  image_staging_path: imageStagingPath.optional(),
});

export type MarketUpdateInput = z.infer<typeof marketUpdateInputSchema>;

/** What `PATCH markets/:slug` answers. */
export const marketSavedSchema = z.object({ slug: marketSlugSchema, updated_at: updatedAt });

export type MarketSaved = z.infer<typeof marketSavedSchema>;

/** `POST markets/:slug/coming-soon`: `false` opens the market. */
export const comingSoonInputSchema = marketSlugInputSchema.extend({ coming_soon: z.boolean() });

export const comingSoonAnswerSchema = marketSavedSchema.extend({ coming_soon: z.boolean() });

export type ComingSoonAnswer = z.infer<typeof comingSoonAnswerSchema>;

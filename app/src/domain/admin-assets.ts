import { z } from "zod";
import { assetFileSchema, assetKinds, assetStatuses } from "./assets.ts";

// Screen 10 (B9 step 10, admin-screens 10): the six `/api/admin/assets*` routes. API JSON is the snake_case row shape
// of the generated types; `files[].url` and `captions_waiting` are computed by the service.

const uuid = z.string().uuid();

/** `GET /api/admin/assets/:id` and every write's path parameter. */
export const assetIdInputSchema = z.object({ id: uuid });

/** `POST /api/admin/assets/:id/reject`: the note is required (trigger `assets_reject_note`). */
export const assetRejectInputSchema = assetIdInputSchema.extend({
  note: z.string().trim().min(1).max(2000),
});
export type AssetRejectInput = z.infer<typeof assetRejectInputSchema>;

const captionText = z.string().trim().min(1).max(3000);

/** `PUT /api/admin/assets/:id/caption`: any of the three variants and the alt text, at least one of them. */
export const assetCaptionInputSchema = assetIdInputSchema
  .extend({
    captions: z
      .object({
        instagram: captionText.optional(),
        x: captionText.optional(),
        linkedin: captionText.optional(),
      })
      .strict()
      .optional(),
    alt_text: z.string().trim().min(1).max(1000).optional(),
  })
  .refine(
    (input) =>
      input.alt_text !== undefined ||
      Object.values(input.captions ?? {}).some((text) => text !== undefined),
    { message: "Send a caption or an alt text." },
  );
export type AssetCaptionInput = z.infer<typeof assetCaptionInputSchema>;

/** One file of an asset with its relative `/media/<key>` address, built in the Worker (A10). */
const adminAssetFileSchema = assetFileSchema.extend({ url: z.string() });

export const adminAssetSchema = z.object({
  id: uuid,
  /** W7 item 19 (H107): what the asset is about; only a property's asset has `property_id`. */
  subject: z.enum(["property", "market", "story", "brand"]).default("property"),
  property_id: uuid.nullable(),
  market_slug: z.string().nullable().default(null),
  story_id: uuid.nullable().default(null),
  /** What a requested reel is about, by name ("California", a story's title, "Matter of Place"); null for a property's. */
  subject_label: z.string().nullable().default(null),
  kind: z.enum(assetKinds),
  revision: z.number().int(),
  status: z.enum(assetStatuses),
  caption: z.string().nullable(),
  alt_text: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()),
  files: z.array(adminAssetFileSchema),
  rejection_note: z.string().nullable(),
  render_error: z.string().nullable(),
  job_id: uuid.nullable(),
  approved_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  /** The caption is null and a `write_captions` job of the property waits for the laptop runner (H34 (2)). */
  captions_waiting: z.boolean(),
});
export type AdminAsset = z.infer<typeof adminAssetSchema>;

/** `GET /api/admin/assets`: one page of 50 and the count of every row the filters match. */
export const assetListSchema = z.object({
  items: z.array(adminAssetSchema),
  total: z.number().int().nonnegative(),
});

/** Approve and reject answer the event they emitted. */
export const assetDecisionSchema = z.object({ asset_id: uuid, event_id: uuid });

/** Re-render answers the pending revision and its job. */
export const assetRerenderSchema = z.object({ asset_id: uuid, job_id: uuid.nullable() });

export const assetCaptionAnswerSchema = z.object({ asset_id: uuid });

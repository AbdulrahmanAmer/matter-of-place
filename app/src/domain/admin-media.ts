import { z } from "zod";
import { slugPattern, uploadLimits } from "./contracts.ts";

// Screen 9 and the Sequence tab (B7 step 8, invariant 21). API JSON is the snake_case row shape.

const uuid = z.string().uuid();
const slug = new RegExp(slugPattern);
const stagingPath = z.string().min(1).max(300);
const alt = z.string().trim().max(300);

/** What an upload is for: a property's photograph, or the one image of a story, a market or a region (G51). */
const mediaScopes = ["property", "story", "market", "region"] as const;

export type MediaScope = (typeof mediaScopes)[number];

export type UploadType = (typeof uploadLimits.types)[number];

/**
 * `POST /api/admin/media/upload-url`. `target` is the property id, or the story, market or region slug; `media_id`
 * names the photograph a replace is for. The type and size limits are the public form's (`uploadLimits`).
 */
export const uploadUrlInputSchema = z
  .object({
    scope: z.enum(mediaScopes),
    target: z.string().min(1).max(120),
    media_id: uuid.optional(),
    mime: z.enum(uploadLimits.types),
    size: z.number().int().positive().max(uploadLimits.maxBytes),
  })
  .superRefine((input, ctx) => {
    const named =
      input.scope === "property" ? uuid.safeParse(input.target).success : slug.test(input.target);
    if (!named) ctx.addIssue({ code: "custom", path: ["target"], message: "Unknown target." });
    if (input.media_id !== undefined && input.scope !== "property") {
      ctx.addIssue({
        code: "custom",
        path: ["media_id"],
        message: "Only a photograph is replaced.",
      });
    }
  });

/** The object name in the private bucket `submissions` and its signed upload URL; `media_id` for a property only. */
export const uploadUrlAnswerSchema = z.object({
  media_id: uuid.optional(),
  path: z.string(),
  url: z.string().url(),
});

export type StagedUpload = z.infer<typeof uploadUrlAnswerSchema>;

/** `POST /api/admin/media/attach`, after the browser's PUT to the signed upload URL. */
export const attachInputSchema = z.object({
  property_id: uuid,
  media_id: uuid,
  staging_path: stagingPath,
  alt: alt.optional(),
});

export const attachAnswerSchema = z.object({
  media_id: uuid,
  sort_order: z.number().int(),
  render_job_id: uuid.nullable(),
});

/** `GET /api/admin/media?property_id=` and `GET /api/admin/media/variants-status?property_id=`. */
export const propertyMediaInputSchema = z.object({ property_id: uuid });

/**
 * One photograph: `url` is `/media/<media_key>` once stored (H33 (4)), else the staged file signed for 600 s, or null
 * while the staged file is not there yet (the copy job of an accepted request has not reached it).
 */
export const mediaItemSchema = z.object({
  id: uuid,
  sort_order: z.number().int(),
  alt: z.string().nullable(),
  orientation: z.enum(["landscape", "portrait"]).nullable(),
  media_key: z.string().nullable(),
  staging_path: z.string().nullable(),
  url: z.string().nullable(),
});

export type MediaItem = z.infer<typeof mediaItemSchema>;

export const mediaListSchema = z.object({ items: z.array(mediaItemSchema) });

/** `POST /api/admin/media/reorder`: every photograph of the property once, the first being the hero (G66). */
export const reorderInputSchema = z.object({
  property_id: uuid,
  order: z.array(uuid).min(1).max(200),
});

export const reorderAnswerSchema = z.object({ count: z.number().int() });

/** `PATCH /api/admin/media/:id`: alt text, empty to clear it. */
export const altInputSchema = z.object({ id: uuid, alt });

export const mediaIdInputSchema = z.object({ id: uuid });

export const mediaIdAnswerSchema = z.object({ id: uuid });

/** `POST /api/admin/media/:id/replace`: the suffixed path of `createStagingUpload` with `media_id` (G54). */
export const replaceInputSchema = z.object({ id: uuid, staging_path: stagingPath });

export const replaceAnswerSchema = z.object({ render_job_id: uuid.nullable() });

/** `uploading` is the browser's own state, before `media/attach` answers. */
const variantStates = ["staged", "processing", "ready", "failed"] as const;

export type VariantState = (typeof variantStates)[number];

export const variantsStatusSchema = z.object({
  items: z.array(
    z.object({
      media_id: uuid,
      state: z.enum(variantStates),
      job_id: uuid.nullable(),
    }),
  ),
});

export type VariantsStatus = z.infer<typeof variantsStatusSchema>;

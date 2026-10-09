import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { editorialStates, slugPattern } from "./contracts.ts";
import { marketSlugSchema } from "./market.ts";
import { storySchema } from "./story.ts";

// Screen 14 (B7 step 12): the stories an editor writes and publishes. API JSON is the snake_case row shape of the
// generated types.

const uuid = z.string().uuid();
const slug = z.string().regex(new RegExp(slugPattern)).max(120);
const text = (max: number) => z.string().trim().min(1).max(max);
/** The time exactly as the database stored it, which the next write sends back (409 `stale` otherwise). */
const updatedAt = z.string().datetime({ offset: true });

export const storyCategories = storySchema.shape.category.options;

/** `GET /api/admin/stories`. The cursor names the last row of the page before: its `updated_at` and its id. */
export const storyListInputSchema = adminPageSchema.extend({
  editorial_state: z.enum(editorialStates).optional(),
});

export type StoryListInput = z.infer<typeof storyListInputSchema>;

/** One row of `list_stories`. */
export const storyListRowSchema = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  category: z.enum(storyCategories),
  market_slug: marketSlugSchema,
  editorial_state: z.enum(editorialStates),
  image: z.string().nullable(),
  published_at: z.string().nullable(),
  updated_at: z.string(),
});

export type StoryListRow = z.infer<typeof storyListRowSchema>;

export const storyListSchema = adminPageAnswer(storyListRowSchema);

/** The path parameter of every `stories/:id` route. */
export const storyIdInputSchema = z.object({ id: uuid });

/** `GET stories/:id`: the row the editor shows, with the address of its image on the site (null until it is rendered). */
export const storyDetailSchema = storyListRowSchema.extend({
  deck: z.string(),
  body: z.array(z.string()),
  properties: z.array(z.string()),
  archived_at: z.string().nullable(),
  image_url: z.string().nullable(),
});

export type StoryDetail = z.infer<typeof storyDetailSchema>;

/**
 * The fields an editor writes. `image` is not one of them: it is written once B9's render has run on the staged file
 * (G55). A new story needs all of the first five, which `save_story` checks (422 `invalid_key`).
 */
const storyFieldsSchema = z.object({
  slug,
  title: text(200),
  deck: text(400),
  category: z.enum(storyCategories),
  market_slug: marketSlugSchema,
  body: z.array(text(5000)).max(60),
  properties: z.array(slug).max(12),
});

const storyPatchSchema = storyFieldsSchema.partial().strict();

export type StoryPatch = z.infer<typeof storyPatchSchema>;

/** The object name `createStagingUpload` made, in the bucket `submissions` (G51). */
const imageStagingPath = z.string().min(1).max(300);

/** `POST /api/admin/stories`: a draft from the fields, and the staged image to render when there is one. */
export const storyCreateInputSchema = z.object({
  patch: storyPatchSchema,
  image_staging_path: imageStagingPath.optional(),
});

/** `PATCH /api/admin/stories/:id`: the changed fields at the `updated_at` the editor read. */
export const storyUpdateInputSchema = storyIdInputSchema.extend({
  expected_updated_at: updatedAt,
  patch: storyPatchSchema,
  image_staging_path: imageStagingPath.optional(),
});

/** `POST stories/:id/publish`. */
export const storyPublishInputSchema = storyIdInputSchema.extend({
  expected_updated_at: updatedAt,
});

/** What every write of a story answers: its id and the `updated_at` the next write sends back. */
export const storySavedSchema = z.object({ id: uuid, updated_at: updatedAt });

export type StorySaved = z.infer<typeof storySavedSchema>;

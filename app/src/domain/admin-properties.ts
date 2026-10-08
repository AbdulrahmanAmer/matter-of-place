import { z } from "zod";
import { adminPageAnswer, adminPageSchema } from "./admin-page.ts";
import { decisionAnswerSchema } from "./admin-submissions.ts";
import { editorialStates, slugPattern, submissionStates, submitterKinds } from "./contracts.ts";
import { marketSlugSchema } from "./market.ts";
import { propertySchema } from "./property.ts";

// Screens 7 and 8 (B7 step 7, invariants 7 and 8). API JSON is the snake_case row shape of the generated types.

const uuid = z.string().uuid();
const version = z.number().int().min(1);
const status = propertySchema.shape.status;
const type = propertySchema.shape.type;
const campaignTier = propertySchema.shape.campaignTier.unwrap();
const text = (max: number) => z.string().trim().min(1).max(max);

/** `GET /api/admin/properties`. The cursor names the last row of the page before: its `updated_at` and its id. */
export const propertyListInputSchema = adminPageSchema.extend({
  editorial_state: z.enum(editorialStates).optional(),
  market: marketSlugSchema.optional(),
});

export type PropertyListInput = z.infer<typeof propertyListInputSchema>;

/** One row of `list_properties`. */
export const propertyListRowSchema = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  market_slug: z.string(),
  region_slug: z.string().nullable(),
  editorial_state: z.enum(editorialStates),
  campaign_tier: campaignTier,
  hero_rank: z.number().int().nullable(),
  featured_rank: z.number().int().nullable(),
  published_at: z.string().nullable(),
  source: z.enum(["Editorial", "Submission"]),
  updated_at: z.string(),
});

export type PropertyListRow = z.infer<typeof propertyListRowSchema>;

export const propertyListSchema = adminPageAnswer(propertyListRowSchema);

/** The path parameter of every `properties/:id` route. */
export const propertyIdInputSchema = z.object({ id: uuid });

/** The row as `property_detail` returns it: the columns screen 8 edits or shows, with the lock's `version`. */
const propertyRecordSchema = z.object({
  id: uuid,
  slug: z.string(),
  title: z.string(),
  market_slug: marketSlugSchema,
  region_slug: z.string().nullable(),
  city: z.string(),
  neighborhood: z.string().nullable(),
  state: z.string(),
  country: z.string().nullable(),
  address: z.string(),
  price: z.number().nullable(),
  beds: z.number().int().nullable(),
  baths: z.number().nullable(),
  interior_sq_ft: z.number().int().nullable(),
  lot_acres: z.number().nullable(),
  year_built: z.number().int().nullable(),
  type,
  style: z.string().nullable(),
  architect: z.string().nullable(),
  designer: z.string().nullable(),
  status,
  story: z.array(z.string()),
  place: z.string().nullable(),
  representative_id: uuid.nullable(),
  presented_by_owner: z.boolean(),
  listing_url: z.string().nullable(),
  hero_rank: z.number().int().nullable(),
  featured_rank: z.number().int().nullable(),
  hero_image: z.string().nullable(),
  campaign_tier: campaignTier,
  source: z.enum(["Editorial", "Submission"]),
  submission_id: uuid.nullable(),
  editorial_state: z.enum(editorialStates),
  published_at: z.string().nullable(),
  first_published_at: z.string().nullable(),
  updated_at: z.string(),
  version,
});

export type PropertyRecord = z.infer<typeof propertyRecordSchema>;

/** One photograph in sequence: stored once `media_key` is set, staged while `staging_path` is. */
const propertyMediaSchema = z.object({
  id: uuid,
  media_key: z.string().nullable(),
  staging_path: z.string().nullable(),
  alt: z.string().nullable(),
  orientation: z.enum(["landscape", "portrait"]).nullable(),
  sort_order: z.number().int(),
});

export type PropertyMedia = z.infer<typeof propertyMediaSchema>;

export const representativeSchema = z.object({
  id: uuid,
  name: z.string(),
  brokerage: z.string(),
  license: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});

export type Representative = z.infer<typeof representativeSchema>;

/** `GET /api/admin/properties/:id`: one `property_detail` call. */
export const propertyDetailSchema = z.object({
  property: propertyRecordSchema,
  media: z.array(propertyMediaSchema),
  features: z.array(z.string()),
  related: z.array(z.string()),
  representative: representativeSchema.nullable(),
  submission: z
    .object({
      id: uuid,
      workflow_state: z.enum(submissionStates),
      submitter_kind: z.enum(submitterKinds),
    })
    .nullable(),
});

export type PropertyDetail = z.infer<typeof propertyDetailSchema>;

const nullableNumber = z.number().positive().nullable();
const nullableInt = z.number().int().min(0).nullable();
const nullableText = (max: number) => z.string().trim().max(max).nullable();

/**
 * The fields `PATCH properties/:id` may change: B2's `save_property` allow-list without the ranks (`properties/:id/rank`),
 * and `editorial_state`, which moves between draft and review only (publish and unpublish have their own routes).
 */
const propertyFieldsSchema = z.object({
  slug: z.string().regex(new RegExp(slugPattern)).max(120),
  title: text(200),
  region_slug: nullableText(80),
  city: text(120),
  neighborhood: nullableText(120),
  country: nullableText(80),
  address: text(200),
  price: nullableNumber,
  beds: nullableInt,
  baths: z.number().min(0).max(99).nullable(),
  interior_sq_ft: nullableInt,
  lot_acres: z.number().min(0).nullable(),
  year_built: z.number().int().min(1600).max(2100).nullable(),
  type,
  style: nullableText(120),
  architect: nullableText(120),
  designer: nullableText(120),
  status,
  story: z.array(z.string().max(4000)).max(20),
  place: nullableText(4000),
  representative_id: uuid.nullable(),
  presented_by_owner: z.boolean(),
  listing_url: z.string().url().max(500).nullable(),
  editorial_state: z.enum(["draft", "review"]),
});

/** Every field, as screen 8 holds them. */
export type PropertyFields = z.infer<typeof propertyFieldsSchema>;

const propertyPatchSchema = propertyFieldsSchema.partial().strict();

export type PropertyPatch = z.infer<typeof propertyPatchSchema>;

/** `PATCH properties/:id`: the changed fields and the `version` the editor read (GD-01, 409 `stale` otherwise). */
export const propertyUpdateInputSchema = propertyIdInputSchema.extend({
  expected_version: version,
  patch: propertyPatchSchema,
});

/** What every write of the dossier answers: the row's version after it, which the next write sends back. */
export const versionAnswerSchema = z.object({ version });

export const publishInputSchema = propertyIdInputSchema.extend({ expected_version: version });

/** `POST properties/:id/publish`: the decision answer (invariant 1) with the row's new version. */
export const publishAnswerSchema = decisionAnswerSchema.extend({ version });

export const rankInputSchema = propertyIdInputSchema.extend({
  expected_version: version,
  hero_rank: z.number().int().min(1).max(100).nullable(),
  featured_rank: z.number().int().min(1).max(100).nullable(),
});

export const relatedInputSchema = propertyIdInputSchema.extend({
  expected_version: version,
  related: z.array(z.string().regex(new RegExp(slugPattern)).max(120)).max(12),
});

export const featuresInputSchema = propertyIdInputSchema.extend({
  expected_version: version,
  features: z.array(text(120)).max(40),
});

/** `GET properties/representatives?q=`: the cursor is the last row's id and name. */
export const representativeListInputSchema = adminPageSchema.extend({
  cursor: z.string().min(1).max(240).optional(),
  q: z.string().trim().max(120).optional(),
});

export type RepresentativeListInput = z.infer<typeof representativeListInputSchema>;

export const representativeListSchema = adminPageAnswer(representativeSchema);

/** `POST properties/representatives`: a new row without `id`, an edit with it. */
export const representativePutInputSchema = z.object({
  id: uuid.optional(),
  name: text(120),
  brokerage: z.string().trim().max(120),
  license: nullableText(80).optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  phone: nullableText(40).optional(),
});

export type RepresentativePut = z.infer<typeof representativePutInputSchema>;

export const representativePutAnswerSchema = z.object({ id: uuid });

export const createFromSubmissionInputSchema = z.object({ submission_id: uuid });

/** The RPC's answer; `copy_job_id` is null once B8's prune has removed the finished copy job. */
export const createFromSubmissionAnswerSchema = z.object({
  property_id: uuid,
  copy_job_id: uuid.nullable(),
});

/** `POST properties/:id/preview-token`: the public page with a 15 minute draft token, for the Preview tab. */
export const previewTokenAnswerSchema = z.object({ url: z.string(), expires_at: z.string() });

/**
 * The fields the public page needs that a draft may leave empty (invariant 8, G62). `hero_image` has its own checklist
 * item, so the hero fails alone.
 */
export const factFields = [
  "region_slug",
  "neighborhood",
  "country",
  "price",
  "beds",
  "baths",
  "interior_sq_ft",
  "lot_acres",
  "year_built",
  "style",
  "place",
] as const satisfies readonly (keyof PropertyRecord)[];

/** A live listing needs its representation shown: an agent, or the owner's own (S55). */
const liveStatuses: readonly PropertyRecord["status"][] = ["Active", "Under offer"];

const MIN_IMAGES = 6;
const MIN_PARAGRAPHS = 2;

export const checklistItems = [
  { id: "hero", label: "Hero image set" },
  { id: "images", label: "At least 6 images with alt text" },
  { id: "narrative", label: "Narrative of at least 2 paragraphs" },
  { id: "representation", label: "Representation for live listings" },
  { id: "facts", label: "Facts complete" },
] as const;

type ChecklistId = (typeof checklistItems)[number]["id"];

export interface ChecklistResult {
  id: ChecklistId;
  label: string;
  passed: boolean;
  /** The empty fields, for "Facts complete". */
  missing: string[];
}

type ChecklistProperty = Pick<
  PropertyRecord,
  (typeof factFields)[number] | "hero_image" | "story" | "status" | "presented_by_owner"
>;

/** The publish checklist of screen 8; `publish_property` enforces the same gate in SQL. */
export function publishChecklist(
  property: ChecklistProperty,
  media: readonly Pick<PropertyMedia, "media_key" | "alt">[],
  representative: Pick<Representative, "id"> | null,
): ChecklistResult[] {
  const missing = factFields.filter((field) => property[field] === null);
  const withAlt = media.filter((row) => row.media_key !== null && (row.alt ?? "").trim() !== "");
  const paragraphs = property.story.filter((paragraph) => paragraph.trim() !== "");
  const passed: Record<ChecklistId, boolean> = {
    hero: property.hero_image !== null,
    images: withAlt.length >= MIN_IMAGES,
    narrative: paragraphs.length >= MIN_PARAGRAPHS,
    representation:
      !liveStatuses.includes(property.status) ||
      representative !== null ||
      property.presented_by_owner,
    facts: missing.length === 0,
  };
  return checklistItems.map((item) => ({
    ...item,
    passed: passed[item.id],
    missing: item.id === "facts" ? missing : [],
  }));
}

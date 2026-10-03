import { z } from "zod";
import { marketSlugSchema } from "./market.ts";
import { propertySchema } from "./property.ts";

/**
 * Write-side contracts shared by the frontend and the API.
 *
 * Each schema validates in the browser before a request leaves, and again on
 * the server when the backend is built (the same file can be imported by a
 * Cloudflare Worker). Field names match the columns in supabase/migrations (G-004).
 */

const inquiryIntents = ["showing", "ask", "similar", "sell", "invest", "agent", "general"] as const;
const inquiryIntentSchema = z.enum(inquiryIntents);
export type InquiryIntent = z.infer<typeof inquiryIntentSchema>;

export const contactTopics = [
  "General inquiry",
  "About a property",
  "Selling or presenting a property",
  "Property Exposure",
  "Press and partnerships",
] as const;
const contactTopicSchema = z.enum(contactTopics);
export type ContactTopic = z.infer<typeof contactTopicSchema>;

const email = z.string().trim().email().max(254);
const shortText = z.string().trim().max(200);
const longText = z.string().trim().max(5000);
const optionalShort = shortText.optional().or(z.literal("").transform(() => undefined));

/** What the inquiry is about; absent for general messages. */
const inquirySubjectSchema = z.object({
  kind: z.enum(["property"]),
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
});
export type InquirySubject = z.infer<typeof inquirySubjectSchema>;

export const inquirySchema = z.object({
  intent: inquiryIntentSchema,
  topic: contactTopicSchema.optional(),
  subject: inquirySubjectSchema.optional(),
  name: shortText.min(1),
  email,
  phone: optionalShort,
  location: optionalShort,
  message: longText.min(1),
  /** Intent-specific answers (preferred timing, budget, current property). */
  details: z.record(z.string().max(60), z.string().trim().max(500)).default({}),
  /** Path the visitor was on when they wrote, for attribution. */
  sourcePath: z.string().max(300),
});
export type Inquiry = z.infer<typeof inquirySchema>;

/** Matter of Place accepts submissions from these three states only. */
export const acceptedStates = ["California", "New York", "Florida"] as const;
export const propertyTypes = [
  "Residence",
  "Estate",
  "Townhouse",
  "Apartment",
  "Penthouse",
  "Waterfront",
  "Farmhouse",
] as const;
/** Preferred exposure, chosen at submission and confirmed after editorial review. */
export const exposurePackages = [
  "The Feature",
  "The Reach",
  "The Campaign",
  "Five Features",
  "Not sure yet",
] as const;
const supportedCurrencies = ["USD"] as const;

/**
 * Who submits a request (operator decision S55): a real estate agent or the property owner.
 * @public
 */
export const submitterKinds = ["agent", "owner"] as const;
/** @public */
export type SubmitterKind = (typeof submitterKinds)[number];
/** @public */
export const submitterKindLabels: Record<SubmitterKind, string> = {
  agent: "Real estate agent",
  owner: "Property owner",
};

/**
 * A property slug: lower-case letters and digits in words joined by single hyphens, at most 120 characters. The text
 * of the database checks `properties_slug_format` and `slug_history_slug_format`; `__e2e-` is reserved for fixtures.
 */
export const slugPattern = "^(__e2e-)?[a-z0-9]+(-[a-z0-9]+)*$";

/** The `:slug` of a detail read, bounded only: a slug that no row holds is not found (404), never a validation error. */
export const slugSchema = z.string().min(1).max(120);

/**
 * Internal workflow. Never shown publicly; editorial acceptance must precede
 * any commercial state (Invoice Issued onwards). `Withdrawn` is terminal (DL-04).
 * @public
 */
export const submissionStates = [
  "Submitted",
  "Under Review",
  "Accepted",
  "Declined",
  "Awaiting Assets",
  "Invoice Issued",
  "Scheduled",
  "Published",
  "Distribution Active",
  "Completed",
  "Withdrawn",
] as const;
/** @public */
export type SubmissionState = (typeof submissionStates)[number];

/**
 * Internal roles, the values of the database enum `app_role`. Commercial roles cannot move a submission past
 * editorial review.
 * @public
 */
export const appRoles = [
  "chief_editor",
  "managing_editor",
  "visual_editor",
  "media_ops",
  "commercial",
  "admin",
] as const;
type AppRole = (typeof appRoles)[number];
/** @public */
export const roleLabels: Record<AppRole, string> = {
  chief_editor: "Chief Editorial Officer",
  managing_editor: "Managing Editor",
  visual_editor: "Visual Editor",
  media_ops: "Media Operations",
  commercial: "Commercial Partnerships",
  admin: "Administrator",
};

/**
 * Where a property or story stands in publication, the values of the database enum `editorial_state`.
 * `agent_review` is optional: `review` goes to `published` directly (GG-07).
 * @public
 */
export const editorialStates = [
  "draft",
  "review",
  "agent_review",
  "published",
  "archived",
] as const;
type EditorialState = (typeof editorialStates)[number];
/** @public */
export const editorialStateLabels: Record<EditorialState, string> = {
  draft: "Draft",
  review: "Review",
  agent_review: "Agent Review",
  published: "Published",
  archived: "Archived",
};

/** Invariant 13 (GQ-07): the same numbers sit in the buckets, `config.toml` and the checks on `submission_media`. */
export const uploadLimits = {
  maxBytes: 26_214_400,
  maxFiles: 40,
  types: ["image/jpeg", "image/png", "image/heic", "image/webp"],
} as const;

/**
 * The licence-terms version a submitter accepts; B3 writes it to `submissions.rights_version` (invariant 12).
 * @public
 */
export const currentRightsVersion = "2026-10-01";

/**
 * What a visitor may ask of their personal data: the values of the check on `subject_requests.kind` (G29).
 */
export const subjectRequestKinds = ["access", "deletion", "opt_out", "correction"] as const;

/**
 * The HTTP statuses a redirect row may carry, the check on `redirects.status`.
 * @public
 */
export const redirectStatuses = [301, 302, 307, 308] as const;

/** Metadata for a photograph the submitter selected, within the limits of `uploadLimits`. The bytes follow in a separate request. */
const submissionMediaSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative().max(uploadLimits.maxBytes),
  type: z.enum(uploadLimits.types),
});

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));
const optionalYear = z.number().int().min(1600).max(2100).optional();

/** The submitter fields `submitterRules` reads. */
interface SubmitterFields {
  submitterKind: SubmitterKind;
  brokerage?: string | undefined;
  listedWithAgent?: boolean | undefined;
  listingAgentName?: string | undefined;
  listingAgentBrokerage?: string | undefined;
}

/** A trimmed optional field counts as given when it is not empty. */
const isSet = (value: string | undefined): boolean => value !== undefined && value !== "";

/**
 * The rules the database holds as `submissions_brokerage_for_agent` and `submissions_listing_for_owner`, and
 * stricter where the form needs it: an agent names a brokerage and an owner does not, only an owner says whether the
 * home is listed, and a listing agent is named only when it is.
 */
export function submitterRules(value: SubmitterFields, ctx: z.RefinementCtx): void {
  const refuse = (path: keyof SubmitterFields, message: string) => {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
  };
  if (value.submitterKind === "agent" && !isSet(value.brokerage)) {
    refuse("brokerage", "Name your brokerage");
  }
  if (value.submitterKind === "owner" && isSet(value.brokerage)) {
    refuse("brokerage", "An owner has no brokerage");
  }
  if (value.submitterKind === "agent" && value.listedWithAgent !== undefined) {
    refuse("listedWithAgent", "Only an owner says whether the home is listed");
  }
  const listed = value.submitterKind === "owner" && value.listedWithAgent === true;
  if (!listed && isSet(value.listingAgentName)) {
    refuse("listingAgentName", "Name a listing agent only when the home is listed with one");
  }
  if (!listed && isSet(value.listingAgentBrokerage)) {
    refuse(
      "listingAgentBrokerage",
      "Name a listing brokerage only when the home is listed with an agent",
    );
  }
}

export const submissionSchema = z
  .object({
    address: shortText.min(1),
    city: shortText.min(1),
    state: z.enum(acceptedStates),
    zip: z
      .string()
      .trim()
      .regex(/^\d{5}$/),
    listingUrl: optionalUrl,
    sourceUrl: optionalUrl,
    price: z.number().positive().optional(),
    currency: z.enum(supportedCurrencies),
    propertyType: z.enum(propertyTypes),
    beds: z.number().int().nonnegative().optional(),
    baths: z.number().nonnegative().optional(),
    interiorSqFt: z.number().int().positive().optional(),
    architect: optionalShort,
    designer: optionalShort,
    yearBuilt: optionalYear,
    yearRenovated: optionalYear,
    submitterKind: z.enum(submitterKinds),
    submitterName: shortText.min(1),
    submitterEmail: email,
    submitterPhone: optionalShort,
    brokerage: optionalShort,
    listedWithAgent: z.boolean().optional(),
    listingAgentName: optionalShort,
    listingAgentBrokerage: optionalShort,
    photographyUrl: optionalUrl,
    videoUrl: optionalUrl,
    story: longText.min(1),
    significance: longText.min(1),
    package: z.enum(exposurePackages),
    mediaBudget: z.number().nonnegative().optional(),
    rightsConfirmed: z.literal(true),
    media: z.array(submissionMediaSchema).max(uploadLimits.maxFiles).default([]),
    sourcePath: z.string().max(300),
  })
  .superRefine(submitterRules);
export type Submission = z.infer<typeof submissionSchema>;

export const subscriberSchema = z.object({
  email,
  /** Where the visitor subscribed (home, stories, property slug). */
  source: z.string().max(120),
  /** The markets the visitor wants to hear about: the values of the check `subscribers_markets_subset`. */
  markets: z.array(marketSlugSchema).max(3).default([]),
});
export type SubscriberInput = z.input<typeof subscriberSchema>;

const searchQuerySchema = z.object({
  text: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(24).default(6),
});
export type SearchQuery = z.input<typeof searchQuerySchema>;

export const conciergeQuestions = [
  "Is the property still available?",
  "Can I request a private showing?",
  "Are there similar properties nearby?",
  "Can you send the full details?",
] as const;
const conciergeQuestionSchema = z.object({
  propertySlug: z.string().min(1).max(120),
  question: z.enum(conciergeQuestions),
});
export type ConciergeQuestion = z.infer<typeof conciergeQuestionSchema>;

/** Returned by every write service. */
export const receiptSchema = z.object({
  id: z.string(),
  receivedAt: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const submissionReceiptSchema = receiptSchema.extend({
  /** One signed PUT target per photograph named in `media`, valid for a short window. */
  uploads: z.array(z.object({ name: z.string(), url: z.string() })),
});

export const searchMatchSchema = z.object({
  property: propertySchema,
  score: z.number(),
  reasons: z.array(z.string()),
});
export type SearchMatch = z.infer<typeof searchMatchSchema>;

export const conciergeAnswerSchema = z.object({
  text: z.string(),
  link: z.object({ slug: z.string(), title: z.string() }).optional(),
  action: z.literal("showing").optional(),
});
export type ConciergeAnswer = z.infer<typeof conciergeAnswerSchema>;

/**
 * One row of `GET /properties` (PERF-06): the fields a card, the filters and the matcher read, and the hero's `card`
 * rendition. Never the gallery, the video or the long text. It is the Zod twin of `PropertyCard` in `property.ts`.
 */
export const propertyCardSchema = propertySchema
  .pick({
    slug: true,
    title: true,
    market: true,
    region: true,
    city: true,
    neighborhood: true,
    state: true,
    type: true,
    style: true,
    architect: true,
    status: true,
    price: true,
    currency: true,
    beds: true,
    baths: true,
    interiorSqFt: true,
    heroRank: true,
    featuredRank: true,
    heroImage: true,
  })
  .extend({
    heroVariants: propertySchema.shape.heroVariants.unwrap().pick({ card: true }).optional(),
  });

/** `POST /submissions/:id/uploads`: the next photographs to sign, with the token the first answer carried (E2E-02). */
export const submissionUploadsSchema = z.object({
  media_ids: z.array(z.string().uuid()).min(1).max(10),
  upload_token: z.string().max(200),
});

/** `POST /client-error`: one error the browser caught (FE-09). */
export const clientErrorSchema = z.object({
  message: z.string().max(500),
  stack: z.string().max(2048).optional(),
  route: z.string().max(200),
  release: z.string().max(100).optional(),
  requestId: z.string().max(100).optional(),
});

import { z } from "zod";

/**
 * Write-side contracts shared by the frontend and the API.
 *
 * Each schema validates in the browser before a request leaves, and again on
 * the server when the backend is built (the same file can be imported by a
 * Cloudflare Worker). Field names match the tables in docs/database/schema.sql.
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

/** Metadata for a photograph the submitter selected. Binary upload is a separate step (see docs). */
const submissionMediaSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().nonnegative(),
  type: z.string().max(100),
});

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));
const optionalYear = z.number().int().min(1600).max(2100).optional();

export const submissionSchema = z.object({
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
  brokerage: shortText.min(1),
  agentName: shortText.min(1),
  agentEmail: email,
  agentPhone: optionalShort,
  photographyUrl: optionalUrl,
  videoUrl: optionalUrl,
  story: longText.min(1),
  significance: longText.min(1),
  package: z.enum(exposurePackages),
  mediaBudget: z.number().nonnegative().optional(),
  rightsConfirmed: z.literal(true),
  media: z.array(submissionMediaSchema).max(20).default([]),
  sourcePath: z.string().max(300),
});
export type Submission = z.infer<typeof submissionSchema>;

export const subscriberSchema = z.object({
  email,
  /** Where the visitor subscribed (home, stories, property slug). */
  source: z.string().max(120),
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
export type Receipt = {
  id: string;
  receivedAt: string;
};

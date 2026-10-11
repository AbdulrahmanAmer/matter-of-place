import { z } from "zod";
import type { Market } from "../domain/market";
import type { Property, PropertyCard } from "../domain/property";
import type { PublicSite } from "../domain/settings";
import type { Story } from "../domain/story";
import type {
  ConciergeAnswer,
  ConciergeQuestion,
  Inquiry,
  Receipt,
  SearchMatch,
  SearchQuery,
  Submission,
  SubjectRequest,
  SubscriberInput,
} from "../domain/contracts";

/**
 * The service boundary.
 *
 * Components and route loaders talk only to these interfaces. Two adapter
 * sets implement them: `local` (static content, in-memory outbox) and `http`
 * (the Matter of Place API on Cloudflare backed by Supabase). Which set is
 * used depends solely on `VITE_API_BASE_URL`.
 */
type ServiceMode = "local" | "live";

export interface CatalogService {
  listProperties(): Promise<PropertyCard[]>;
  /** With `draftToken`, the draft a preview link opens (B7 invariant 17 f); the local adapter has no drafts. */
  getProperty(
    slug: string,
    opts?: { draftToken?: string },
  ): Promise<Property | { gone: true } | null>;
  listMarkets(): Promise<Market[]>;
  getMarket(slug: string): Promise<Market | null>;
  listStories(): Promise<Story[]>;
  getStory(slug: string): Promise<Story | null>;
}

export interface InquiryService {
  send(input: Inquiry): Promise<Receipt>;
}

/** Where the photographs of a received submission stand; `retry` sends the failed ones again (FE-04). */
export type UploadProgress = {
  done: number;
  total: number;
  failed: number;
  retry: () => Promise<void>;
};

export interface SubmissionService {
  /**
   * Sends the submission and resolves with its receipt once the API has it; the photographs then upload in the
   * background and report to `onProgress`, which the local adapter ignores.
   */
  send(
    input: Submission,
    files: File[],
    onProgress?: (progress: UploadProgress) => void,
  ): Promise<Receipt>;
}

export interface NewsletterService {
  subscribe(input: SubscriberInput): Promise<Receipt>;
}

export type { ConciergeAnswer, SearchMatch };

export interface SearchService {
  match(query: SearchQuery): Promise<SearchMatch[]>;
}

export interface ConciergeService {
  answer(question: ConciergeQuestion): Promise<ConciergeAnswer>;
}

/** A privacy request (GP-01); `website` is the honeypot value the form passes through. */
export interface SubjectsService {
  request(input: SubjectRequest & { website?: string }): Promise<{ ok: true }>;
}

export interface SiteService {
  get(): Promise<PublicSite>;
}

export type Services = {
  mode: ServiceMode;
  catalog: CatalogService;
  inquiries: InquiryService;
  submissions: SubmissionService;
  newsletter: NewsletterService;
  search: SearchService;
  concierge: ConciergeService;
  site: SiteService;
  subjects: SubjectsService;
};

export type ServiceErrorKind = "network" | "validation" | "server" | "not-found" | "gone";

/**
 * One refused field of a form, as the API's `error.issues` and a client-side Zod refusal both give it: where it
 * is (`path`), what Zod called it (`code`, and `type` or `received` for the two that say "empty") and its message.
 */
const serviceIssueSchema = z.object({
  path: z.array(z.union([z.string(), z.number()])),
  message: z.string(),
  code: z.string(),
  type: z.string().optional(),
  /** A string for a missing value ("undefined"), but a boolean or a number for `invalid_literal`: only read it for equality. */
  received: z.unknown(),
});
export type ServiceIssue = z.infer<typeof serviceIssueSchema>;

/** The issues of a refusal, each read on its own: one entry in an unexpected shape is left out, the rest stay. */
export function serviceIssues(value: unknown): ServiceIssue[] {
  const list = z.array(z.unknown()).safeParse(value);
  if (!list.success) return [];
  return list.data.flatMap((item) => {
    const one = serviceIssueSchema.safeParse(item);
    return one.success ? [one.data] : [];
  });
}

/** Thrown by adapters; forms map `kind` to a calm message. A refusal of the details (`validation`) lists the fields in `issues`. */
export class ServiceError extends Error {
  readonly kind: ServiceErrorKind;
  readonly status: number | undefined;
  readonly issues: readonly ServiceIssue[];

  constructor(
    kind: ServiceErrorKind,
    message: string,
    status?: number,
    issues: readonly ServiceIssue[] = [],
  ) {
    super(message);
    this.name = "ServiceError";
    this.kind = kind;
    this.status = status;
    this.issues = issues;
  }
}

import type { Market } from "../domain/market";
import type { Property, PropertyCard } from "../domain/property";
import type { Story } from "../domain/story";
import type {
  ConciergeAnswer,
  ConciergeQuestion,
  Inquiry,
  Receipt,
  SearchMatch,
  SearchQuery,
  Submission,
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
  getProperty(slug: string): Promise<Property | null>;
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

export type Services = {
  mode: ServiceMode;
  catalog: CatalogService;
  inquiries: InquiryService;
  submissions: SubmissionService;
  newsletter: NewsletterService;
  search: SearchService;
  concierge: ConciergeService;
};

export type ServiceErrorKind = "network" | "validation" | "server" | "not-found";

/** Thrown by adapters; forms map `kind` to a calm message. */
export class ServiceError extends Error {
  readonly kind: ServiceErrorKind;
  readonly status: number | undefined;

  constructor(kind: ServiceErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ServiceError";
    this.kind = kind;
    this.status = status;
  }
}

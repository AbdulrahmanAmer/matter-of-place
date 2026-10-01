import type { Market } from "../domain/market";
import type { Property } from "../domain/property";
import type { Story } from "../domain/story";
import type {
  ConciergeQuestion,
  Inquiry,
  Receipt,
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
export type ServiceMode = "local" | "live";

export interface CatalogService {
  listProperties(): Promise<Property[]>;
  getProperty(slug: string): Promise<Property | null>;
  listMarkets(): Promise<Market[]>;
  getMarket(slug: string): Promise<Market | null>;
  listStories(): Promise<Story[]>;
  getStory(slug: string): Promise<Story | null>;
}

export interface InquiryService {
  send(input: Inquiry): Promise<Receipt>;
}

export interface SubmissionService {
  /**
   * Sends the submission, then uploads any selected photographs. The API
   * answers with signed upload targets; the adapter streams each file to them.
   */
  send(input: Submission, files: File[]): Promise<Receipt>;
}

export interface NewsletterService {
  subscribe(input: SubscriberInput): Promise<Receipt>;
}

export type SearchMatch = {
  property: Property;
  score: number;
  reasons: string[];
};

export interface SearchService {
  match(query: SearchQuery): Promise<SearchMatch[]>;
}

export type ConciergeAnswer = {
  text: string;
  link?: { slug: string; title: string };
  action?: "showing";
};

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

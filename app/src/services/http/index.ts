import type { Market } from "../../domain/market";
import type { Property } from "../../domain/property";
import type { Story } from "../../domain/story";
import type { Receipt } from "../../domain/contracts";
import { createApiClient } from "./client";
import {
  ServiceError,
  type CatalogService,
  type ConciergeAnswer,
  type ConciergeService,
  type InquiryService,
  type NewsletterService,
  type SearchMatch,
  type SearchService,
  type SubmissionService,
} from "../types";

/**
 * HTTP adapters. Endpoint paths and payloads are the API contract documented
 * in docs/architecture/services.md; the backend implements them on Cloudflare
 * with Supabase behind an edge cache.
 */
type SubmissionReceipt = Receipt & {
  /** One signed PUT target per photograph named in `media`, valid for a short window. */
  uploads: { name: string; url: string }[];
};
const nullOnNotFound = async <T>(promise: Promise<T>): Promise<T | null> => {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof ServiceError && error.kind === "not-found") return null;
    throw error;
  }
};

export function createHttpServices(baseUrl: string) {
  const api = createApiClient(baseUrl);

  const catalog: CatalogService = {
    listProperties: () => api.get<Property[]>("/properties"),
    getProperty: (slug) =>
      nullOnNotFound(api.get<Property>(`/properties/${encodeURIComponent(slug)}`)),
    listMarkets: () => api.get<Market[]>("/markets"),
    getMarket: (slug) => nullOnNotFound(api.get<Market>(`/markets/${encodeURIComponent(slug)}`)),
    listStories: () => api.get<Story[]>("/stories"),
    getStory: (slug) => nullOnNotFound(api.get<Story>(`/stories/${encodeURIComponent(slug)}`)),
  };

  const inquiries: InquiryService = {
    send: (input) => api.post<Receipt>("/inquiries", input),
  };

  const submissions: SubmissionService = {
    async send(input, files) {
      const receipt = await api.post<SubmissionReceipt>("/submissions", input);
      await Promise.all(
        receipt.uploads.map(async (upload) => {
          const file = files.find((candidate) => candidate.name === upload.name);
          if (!file) return;
          const response = await fetch(upload.url, {
            method: "PUT",
            headers: { "content-type": file.type || "application/octet-stream" },
            body: file,
          });
          if (!response.ok) {
            throw new ServiceError("server", `Upload failed for ${file.name}`, response.status);
          }
        }),
      );
      return { id: receipt.id, receivedAt: receipt.receivedAt };
    },
  };

  const newsletter: NewsletterService = {
    subscribe: (input) => api.post<Receipt>("/subscribers", input),
  };

  const search: SearchService = {
    match: (query) => api.post<SearchMatch[]>("/search", query),
  };

  const concierge: ConciergeService = {
    answer: (question) => api.post<ConciergeAnswer>("/concierge", question),
  };

  return { catalog, inquiries, submissions, newsletter, search, concierge };
}

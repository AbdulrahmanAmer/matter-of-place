import { z } from "zod";
import {
  conciergeAnswerSchema,
  receiptSchema,
  searchMatchSchema,
  submissionReceiptSchema,
} from "../../domain/contracts";
import { marketSchema } from "../../domain/market";
import { propertySchema } from "../../domain/property";
import { storySchema } from "../../domain/story";
import { createApiClient } from "./client";
import {
  ServiceError,
  type CatalogService,
  type ConciergeService,
  type InquiryService,
  type NewsletterService,
  type SearchService,
  type SubmissionService,
} from "../types";

/**
 * HTTP adapters. Endpoint paths and payloads are the API contract documented
 * in docs/architecture/services.md; the backend implements them on Cloudflare
 * with Supabase behind an edge cache.
 */
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
    listProperties: () => api.get("/properties", z.array(propertySchema)),
    getProperty: (slug) =>
      nullOnNotFound(api.get(`/properties/${encodeURIComponent(slug)}`, propertySchema)),
    listMarkets: () => api.get("/markets", z.array(marketSchema)),
    getMarket: (slug) =>
      nullOnNotFound(api.get(`/markets/${encodeURIComponent(slug)}`, marketSchema)),
    listStories: () => api.get("/stories", z.array(storySchema)),
    getStory: (slug) =>
      nullOnNotFound(api.get(`/stories/${encodeURIComponent(slug)}`, storySchema)),
  };

  const inquiries: InquiryService = {
    send: (input) => api.post("/inquiries", input, receiptSchema),
  };

  const submissions: SubmissionService = {
    async send(input, files) {
      const receipt = await api.post("/submissions", input, submissionReceiptSchema);
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
    subscribe: (input) => api.post("/subscribers", input, receiptSchema),
  };

  const search: SearchService = {
    match: (query) => api.post("/search", query, z.array(searchMatchSchema)),
  };

  const concierge: ConciergeService = {
    answer: (question) => api.post("/concierge", question, conciergeAnswerSchema),
  };

  return { catalog, inquiries, submissions, newsletter, search, concierge };
}

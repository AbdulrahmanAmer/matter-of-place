import { z } from "zod";
import {
  conciergeAnswerSchema,
  propertyCardSchema,
  receiptSchema,
  searchMatchSchema,
  signedUploadsSchema,
  submissionReceiptSchema,
} from "../../domain/contracts";
import { marketSchema } from "../../domain/market";
import { propertySchema } from "../../domain/property";
import { prepareImage, type PreparedImage } from "../../lib/image-prep";
import { getTurnstileToken } from "../../lib/turnstile";
import { storySchema } from "../../domain/story";
import { createApiClient, type FetchImpl } from "./client";
import { apiFetch } from "../../lib/api-fetch.functions";
import { runUploadQueue } from "./upload-queue";
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

/**
 * A form write carries Turnstile's token, named for the route's bucket (G72, INT-02), when the browser has one, and
 * the honeypot field `website`, empty unless a bot filled it.
 */
async function guarded<T extends object>(action: string, input: T) {
  const token = await getTurnstileToken(action);
  return {
    body: { website: "", ...input },
    init: { headers: token === null ? {} : { "x-turnstile-token": token } },
  };
}

export function createHttpServices(baseUrl: string, fetchImpl?: FetchImpl) {
  const api = createApiClient(baseUrl, fetchImpl ?? apiFetch);

  const catalog: CatalogService = {
    listProperties: () => api.get("/properties", z.array(propertyCardSchema)),
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
    send: async (input) => {
      const { body, init } = await guarded("inquiries", input);
      return api.post("/inquiries", body, receiptSchema, init);
    },
  };

  const submissions: SubmissionService = {
    /**
     * Prepares the photographs one at a time (decoding forty at once would exhaust a phone's memory), posts once
     * and resolves as soon as the API has the submission; the files follow through the upload queue, so a failed
     * PUT never turns a received submission into a failed one (FE-04).
     */
    async send(input, files, onProgress) {
      const prepared: PreparedImage[] = [];
      const media: { name: string; size: number; type: string }[] = [];
      for (const file of files) {
        const image = await prepareImage(file);
        prepared.push(image);
        media.push({ name: file.name, size: image.original.size, type: image.type });
      }
      const { body, init } = await guarded("submissions", { ...input, media });
      const receipt = await api.post("/submissions", body, submissionReceiptSchema, init);
      const more = `/submissions/${encodeURIComponent(receipt.id)}/uploads`;
      void runUploadQueue({
        entries: receipt.uploads,
        files: prepared,
        fetchMore: async (mediaIds) => {
          const answer = await api.post(
            more,
            { media_ids: mediaIds, upload_token: receipt.upload_token },
            signedUploadsSchema,
          );
          return answer.uploads;
        },
        onProgress,
      });
      return { id: receipt.id, receivedAt: receipt.receivedAt };
    },
  };

  const newsletter: NewsletterService = {
    subscribe: async (input) => {
      const { body, init } = await guarded("subscribers", input);
      return api.post("/subscribers", body, receiptSchema, init);
    },
  };

  const search: SearchService = {
    match: (query) => api.post("/search", query, z.array(searchMatchSchema)),
  };

  const concierge: ConciergeService = {
    answer: (question) => api.post("/concierge", question, conciergeAnswerSchema),
  };

  return { catalog, inquiries, submissions, newsletter, search, concierge };
}
